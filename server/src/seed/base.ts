import type { PrismaClient } from "../generated/prisma/client.js";
import { ALL_PERMISSIONS, DEFAULT_ROLES, PERMISSIONS, permissionModule } from "../rbac/permissions.js";
import { DELIVERY_ZONES, DHAKA_AREAS, DISTRICT_ZONE, DIVISIONS } from "./geo.js";
import { hashPassword, passwordPolicy } from "../modules/auth/auth.service.js";

/**
 * Idempotent reference data needed by every environment (including production).
 * Never creates business records such as orders or customers.
 */
export async function seedBase(prisma: PrismaClient, opts: { isProduction: boolean }) {
  // Permissions
  for (const key of ALL_PERMISSIONS) {
    await prisma.permission.upsert({
      where: { key },
      create: { key, module: permissionModule(key), description: PERMISSIONS[key] },
      update: { module: permissionModule(key), description: PERMISSIONS[key] },
    });
  }
  const perms = await prisma.permission.findMany();
  const permId = new Map(perms.map((p) => [p.key, p.id]));

  // Built-in roles. Existing roles keep admin edits, except super_admin which always gets everything.
  for (const [key, def] of Object.entries(DEFAULT_ROLES)) {
    const existing = await prisma.role.findUnique({ where: { key } });
    const role = existing ?? (await prisma.role.create({ data: { key, name: def.name, description: def.description, isSystem: true } }));
    if (!existing || key === "super_admin") {
      await prisma.rolePermission.createMany({
        data: def.permissions.map((p) => ({ roleId: role.id, permissionId: permId.get(p)! })),
        skipDuplicates: true,
      });
    }
  }

  // Geography and delivery zones
  const zones = new Map<string, string>();
  for (const z of DELIVERY_ZONES) {
    const row = await prisma.deliveryZone.upsert({ where: { code: z.code }, create: z, update: {} });
    zones.set(z.code, row.id);
  }
  for (const [division, info] of Object.entries(DIVISIONS)) {
    const div = await prisma.division.upsert({ where: { name: division }, create: { name: division, nameBn: info.bn }, update: {} });
    for (const [name, bn] of info.districts) {
      await prisma.district.upsert({
        where: { name },
        create: { name, nameBn: bn, divisionId: div.id, zoneId: zones.get(DISTRICT_ZONE[name] ?? "OUTSIDE_DHAKA") },
        update: {},
      });
    }
  }
  const dhaka = await prisma.district.findUniqueOrThrow({ where: { name: "Dhaka" } });
  for (const [name, zone] of DHAKA_AREAS) {
    await prisma.area.upsert({
      where: { districtId_name: { districtId: dhaka.id, name } },
      create: { districtId: dhaka.id, name, zoneId: zone ? zones.get(zone) : null },
      update: {},
    });
  }

  // Finance reference data
  const categories: [string, string][] = [
    ["Facebook Ads", "ADVERTISING"], ["Google Ads", "ADVERTISING"], ["Courier Charges", "COURIER"],
    ["Packaging", "PACKAGING"], ["Fabric & Materials", "PRODUCTION"], ["Embroidery Labor", "PRODUCTION"],
    ["Salaries", "SALARY"], ["Rent", "RENT"], ["Utilities", "UTILITIES"], ["Software & Tools", "SOFTWARE"],
    ["Miscellaneous", "OTHER"],
  ];
  for (const [name, type] of categories) {
    await prisma.expenseCategory.upsert({ where: { name }, create: { name, type: type as never }, update: {} });
  }
  const accounts: [string, string][] = [["Cash in Hand", "CASH"], ["Bank Account", "BANK"], ["bKash Merchant", "MOBILE_WALLET"], ["Nagad Merchant", "MOBILE_WALLET"]];
  for (const [name, type] of accounts) {
    await prisma.account.upsert({ where: { name }, create: { name, type: type as never }, update: {} });
  }

  // Courier providers. Real providers start disabled until credentials are configured.
  const providers: [string, string][] = [
    ["STEADFAST", "Steadfast Courier"], ["PATHAO", "Pathao Courier"], ["REDX", "RedX"],
    ["ECOURIER", "eCourier"], ["PAPERFLY", "Paperfly"],
  ];
  for (const [code, name] of providers) {
    await prisma.courierProvider.upsert({ where: { code }, create: { code, name, isEnabled: false }, update: {} });
  }
  if (!opts.isProduction) {
    await prisma.courierProvider.upsert({
      where: { code: "MOCK" },
      create: { code: "MOCK", name: "Sandbox Courier (mock)", isEnabled: true, isDefault: true, sandbox: true },
      update: {},
    });
  }
}

/** Creates the first Super Admin from env vars if no user has that email. Password must be supplied. */
export async function seedAdmin(prisma: PrismaClient, input: { email?: string; password?: string; name?: string }) {
  const email = input.email?.trim().toLowerCase();
  if (!email || !input.password) {
    return { created: false, reason: "SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD not set – skipped admin creation" };
  }
  if (await prisma.user.findUnique({ where: { email } })) return { created: false, reason: `${email} already exists` };
  passwordPolicy(input.password);
  const role = await prisma.role.findUniqueOrThrow({ where: { key: "super_admin" } });
  await prisma.user.create({
    data: {
      email,
      name: input.name || "Admin User",
      passwordHash: await hashPassword(input.password),
      roles: { create: [{ roleId: role.id }] },
    },
  });
  return { created: true, reason: `Super Admin ${email} created` };
}
