import { z } from "zod";
import { createModule, idParam, pageMeta, pageQuery, withMeta } from "../../http/route.js";
import { prisma } from "../../lib/prisma.js";
import { assertFound, badRequest, conflict, forbidden } from "../../lib/errors.js";
import { audit, diff } from "../../lib/audit.js";
import { hashPassword, passwordPolicy } from "../auth/auth.service.js";
import { ALL_PERMISSIONS, PERMISSIONS, permissionModule } from "../../rbac/permissions.js";
import type { AuthUser } from "../../middleware/auth.js";

// ───────────── Staff accounts ─────────────
export const usersModule = createModule("/users", "Staff");

const userSelect = {
  id: true, email: true, name: true, phone: true, status: true, twoFactorEnabled: true,
  lastLoginAt: true, lockedUntil: true, createdAt: true,
  roles: { select: { role: { select: { id: true, key: true, name: true } } } },
} as const;

const shapeUser = <T extends { roles: { role: unknown }[] }>(u: T) => ({ ...u, roles: u.roles.map((r) => r.role) });

/** Only a super admin may grant or hold super-admin level access. */
async function assertCanAssignRoles(actor: AuthUser, roleIds: string[]) {
  const roles = await prisma.role.findMany({ where: { id: { in: roleIds } } });
  if (roles.length !== roleIds.length) throw badRequest("One or more roles do not exist");
  if (roles.some((r) => r.key === "super_admin") && !actor.roles.includes("super_admin")) {
    throw forbidden("Only a Super Admin can grant the Super Admin role");
  }
}

usersModule.route({
  method: "get",
  path: "/",
  summary: "List staff accounts",
  access: "users.view",
  query: pageQuery.extend({ search: z.string().optional(), status: z.enum(["ACTIVE", "DISABLED"]).optional() }),
  handler: async ({ query }) => {
    const where = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? { OR: [{ name: { contains: query.search, mode: "insensitive" as const } }, { email: { contains: query.search, mode: "insensitive" as const } }] }
        : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.user.findMany({ where, select: userSelect, orderBy: { createdAt: "asc" }, skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
      prisma.user.count({ where }),
    ]);
    return withMeta(rows.map(shapeUser), pageMeta(query.page, query.pageSize, total));
  },
});

usersModule.route({
  method: "get",
  path: "/options",
  summary: "Minimal list of active staff (for assignment pickers)",
  access: "orders.view",
  handler: () =>
    prisma.user.findMany({ where: { status: "ACTIVE" }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
});

const userBody = z.object({
  email: z.string().email(),
  name: z.string().min(2).max(100),
  phone: z.string().max(20).optional().nullable(),
  password: z.string().min(8).max(200),
  roleIds: z.array(z.string()).min(1),
});

usersModule.route({
  method: "post",
  path: "/",
  summary: "Create a staff account",
  access: "users.manage",
  status: 201,
  body: userBody,
  handler: async ({ body, user, ip }) => {
    passwordPolicy(body.password);
    await assertCanAssignRoles(user, body.roleIds);
    const email = body.email.toLowerCase();
    if (await prisma.user.findUnique({ where: { email } })) throw conflict("A user with this email already exists");
    const created = await prisma.$transaction(async (tx) => {
      const u = await tx.user.create({
        data: {
          email, name: body.name, phone: body.phone ?? null,
          passwordHash: await hashPassword(body.password),
          roles: { create: body.roleIds.map((roleId) => ({ roleId })) },
        },
        select: userSelect,
      });
      await audit(tx, { userId: user.id, action: "user.created", entityType: "User", entityId: u.id, after: { email, name: body.name, roleIds: body.roleIds }, ip });
      return u;
    });
    return shapeUser(created);
  },
});

usersModule.route({
  method: "get",
  path: "/:id",
  summary: "Get a staff account",
  access: "users.view",
  params: idParam,
  handler: async ({ params }) => shapeUser(assertFound(await prisma.user.findUnique({ where: { id: params.id }, select: userSelect }), "User")),
});

usersModule.route({
  method: "patch",
  path: "/:id",
  summary: "Update staff details, status or roles",
  description: "Disabling a user revokes all of their sessions.",
  access: "users.manage",
  params: idParam,
  body: z.object({
    name: z.string().min(2).max(100).optional(),
    phone: z.string().max(20).nullable().optional(),
    status: z.enum(["ACTIVE", "DISABLED"]).optional(),
    roleIds: z.array(z.string()).min(1).optional(),
    unlock: z.boolean().optional(),
  }),
  handler: async ({ params, body, user, ip }) => {
    const existing = assertFound(await prisma.user.findUnique({ where: { id: params.id }, select: userSelect }), "User");
    if (params.id === user.id && (body.status === "DISABLED" || body.roleIds)) {
      throw badRequest("You cannot disable yourself or change your own roles");
    }
    if (existing.roles.some((r) => r.role.key === "super_admin") && !user.roles.includes("super_admin")) {
      throw forbidden("Only a Super Admin can modify a Super Admin");
    }
    if (body.roleIds) await assertCanAssignRoles(user, body.roleIds);

    const updated = await prisma.$transaction(async (tx) => {
      if (body.roleIds) {
        await tx.userRole.deleteMany({ where: { userId: params.id } });
        await tx.userRole.createMany({ data: body.roleIds.map((roleId) => ({ userId: params.id, roleId })) });
      }
      const u = await tx.user.update({
        where: { id: params.id },
        data: {
          name: body.name, phone: body.phone, status: body.status,
          ...(body.unlock ? { lockedUntil: null, failedLoginCount: 0 } : {}),
        },
        select: userSelect,
      });
      if (body.status === "DISABLED") {
        await tx.session.updateMany({ where: { userId: params.id, revokedAt: null }, data: { revokedAt: new Date() } });
      }
      const d = diff(
        { name: existing.name, phone: existing.phone, status: existing.status, roles: existing.roles.map((r) => r.role.key).sort() },
        { name: u.name, phone: u.phone, status: u.status, roles: u.roles.map((r) => r.role.key).sort() },
      );
      if (d.changed || body.unlock) {
        await audit(tx, { userId: user.id, action: "user.updated", entityType: "User", entityId: params.id, before: d.before, after: { ...d.after, ...(body.unlock ? { unlocked: true } : {}) }, ip });
      }
      return u;
    });
    return shapeUser(updated);
  },
});

usersModule.route({
  method: "post",
  path: "/:id/reset-password",
  summary: "Set a new password for a staff member (revokes their sessions)",
  access: "users.manage",
  params: idParam,
  body: z.object({ password: z.string().min(8).max(200) }),
  handler: async ({ params, body, user, ip }) => {
    passwordPolicy(body.password);
    const target = assertFound(await prisma.user.findUnique({ where: { id: params.id }, select: userSelect }), "User");
    if (target.roles.some((r) => r.role.key === "super_admin") && !user.roles.includes("super_admin")) {
      throw forbidden("Only a Super Admin can reset a Super Admin password");
    }
    await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: params.id }, data: { passwordHash: await hashPassword(body.password), passwordChangedAt: new Date(), failedLoginCount: 0, lockedUntil: null } });
      await tx.session.updateMany({ where: { userId: params.id, revokedAt: null }, data: { revokedAt: new Date() } });
      await audit(tx, { userId: user.id, action: "user.password_reset_by_admin", entityType: "User", entityId: params.id, ip });
    });
    return { message: "Password updated and sessions revoked" };
  },
});

usersModule.route({
  method: "get",
  path: "/:id/sessions",
  summary: "Active sessions of a staff member",
  access: "users.manage",
  params: idParam,
  handler: ({ params }) =>
    prisma.session.findMany({
      where: { userId: params.id, revokedAt: null, expiresAt: { gt: new Date() } },
      select: { id: true, ip: true, userAgent: true, createdAt: true, lastSeenAt: true, expiresAt: true },
      orderBy: { lastSeenAt: "desc" },
    }),
});

usersModule.route({
  method: "post",
  path: "/:id/sessions/revoke-all",
  summary: "Sign a staff member out everywhere",
  access: "users.manage",
  params: idParam,
  handler: async ({ params, user, ip }) => {
    const r = await prisma.session.updateMany({ where: { userId: params.id, revokedAt: null }, data: { revokedAt: new Date() } });
    await audit(prisma, { userId: user.id, action: "user.sessions_revoked", entityType: "User", entityId: params.id, after: { count: r.count }, ip });
    return { revoked: r.count };
  },
});

usersModule.route({
  method: "get",
  path: "/:id/login-history",
  summary: "Sign-in history of a staff member",
  access: "audit.view",
  params: idParam,
  handler: ({ params }) =>
    prisma.loginHistory.findMany({ where: { userId: params.id }, orderBy: { createdAt: "desc" }, take: 100 }),
});

// ───────────── Roles & permissions ─────────────
export const rolesModule = createModule("/roles", "Roles & permissions");

const roleInclude = { permissions: { include: { permission: true } }, _count: { select: { users: true } } } as const;
const shapeRole = (r: { permissions: { permission: { key: string } }[]; _count: { users: number } } & Record<string, unknown>) => ({
  ...r,
  permissions: r.permissions.map((p) => p.permission.key).sort(),
  userCount: r._count.users,
  _count: undefined,
});

rolesModule.route({
  method: "get",
  path: "/",
  summary: "List roles with their permissions",
  access: "users.view",
  handler: async () => (await prisma.role.findMany({ include: roleInclude, orderBy: { createdAt: "asc" } })).map(shapeRole),
});

rolesModule.route({
  method: "get",
  path: "/permissions",
  summary: "Permission catalog grouped by module",
  access: "users.view",
  handler: () => {
    const groups: Record<string, { key: string; description: string }[]> = {};
    for (const key of ALL_PERMISSIONS) (groups[permissionModule(key)] ??= []).push({ key, description: PERMISSIONS[key] });
    return groups;
  },
});

const permissionKeys = z.array(z.enum(ALL_PERMISSIONS as [string, ...string[]]));

async function setRolePermissions(tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0], roleId: string, keys: string[]) {
  const perms = await tx.permission.findMany({ where: { key: { in: keys } } });
  await tx.rolePermission.deleteMany({ where: { roleId } });
  await tx.rolePermission.createMany({ data: perms.map((p) => ({ roleId, permissionId: p.id })) });
}

rolesModule.route({
  method: "post",
  path: "/",
  summary: "Create a custom role",
  access: "roles.manage",
  status: 201,
  body: z.object({
    key: z.string().regex(/^[a-z][a-z0-9_]{2,40}$/, "lowercase letters, digits and underscores"),
    name: z.string().min(2).max(60),
    description: z.string().max(300).optional(),
    permissions: permissionKeys,
  }),
  handler: async ({ body, user, ip }) =>
    prisma.$transaction(async (tx) => {
      const role = await tx.role.create({ data: { key: body.key, name: body.name, description: body.description } });
      await setRolePermissions(tx, role.id, body.permissions);
      await audit(tx, { userId: user.id, action: "role.created", entityType: "Role", entityId: role.id, after: body, ip });
      return shapeRole(await tx.role.findUniqueOrThrow({ where: { id: role.id }, include: roleInclude }));
    }),
});

rolesModule.route({
  method: "patch",
  path: "/:id",
  summary: "Update a role's name or permissions",
  description: "The Super Admin role always keeps every permission.",
  access: "roles.manage",
  params: idParam,
  body: z.object({ name: z.string().min(2).max(60).optional(), description: z.string().max(300).optional(), permissions: permissionKeys.optional() }),
  handler: async ({ params, body, user, ip }) => {
    const role = assertFound(await prisma.role.findUnique({ where: { id: params.id }, include: roleInclude }), "Role");
    if (role.key === "super_admin" && body.permissions) throw badRequest("Super Admin permissions cannot be changed");
    return prisma.$transaction(async (tx) => {
      await tx.role.update({ where: { id: role.id }, data: { name: body.name, description: body.description } });
      if (body.permissions) await setRolePermissions(tx, role.id, body.permissions);
      const after = await tx.role.findUniqueOrThrow({ where: { id: role.id }, include: roleInclude });
      await audit(tx, {
        userId: user.id, action: "role.updated", entityType: "Role", entityId: role.id,
        before: { name: role.name, permissions: shapeRole(role).permissions },
        after: { name: after.name, permissions: shapeRole(after).permissions }, ip,
      });
      return shapeRole(after);
    });
  },
});

rolesModule.route({
  method: "delete",
  path: "/:id",
  summary: "Delete a custom role (must have no users)",
  access: "roles.manage",
  params: idParam,
  handler: async ({ params, user, ip }) => {
    const role = assertFound(await prisma.role.findUnique({ where: { id: params.id }, include: roleInclude }), "Role");
    if (role.isSystem) throw badRequest("Built-in roles cannot be deleted");
    if (role._count.users > 0) throw conflict("Role is still assigned to users");
    await prisma.role.delete({ where: { id: role.id } });
    await audit(prisma, { userId: user.id, action: "role.deleted", entityType: "Role", entityId: role.id, before: { key: role.key }, ip });
    return { deleted: true };
  },
});

// ───────────── Audit log ─────────────
export const auditModule = createModule("/audit-logs", "Audit");

auditModule.route({
  method: "get",
  path: "/",
  summary: "Search the audit trail",
  access: "audit.view",
  query: pageQuery.extend({
    entityType: z.string().optional(),
    entityId: z.string().optional(),
    userId: z.string().optional(),
    action: z.string().optional(),
  }),
  handler: async ({ query }) => {
    const where = {
      ...(query.entityType ? { entityType: query.entityType } : {}),
      ...(query.entityId ? { entityId: query.entityId } : {}),
      ...(query.userId ? { userId: query.userId } : {}),
      ...(query.action ? { action: { startsWith: query.action } } : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.auditLog.findMany({
        where, orderBy: { createdAt: "desc" }, skip: (query.page - 1) * query.pageSize, take: query.pageSize,
        include: { user: { select: { id: true, name: true } } },
      }),
      prisma.auditLog.count({ where }),
    ]);
    return withMeta(rows, pageMeta(query.page, query.pageSize, total));
  },
});
