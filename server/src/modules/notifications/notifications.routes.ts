import { z } from "zod";
import { createModule, dateRangeQuery, idParam, pageMeta, pageQuery, withMeta } from "../../http/route.js";
import { prisma, Prisma } from "../../lib/prisma.js";
import { audit } from "../../lib/audit.js";
import { assertFound, badRequest, conflict } from "../../lib/errors.js";
import { dhakaRange } from "../../lib/time.js";
import { DEFAULT_TEMPLATES, renderTemplate } from "./templates.js";
import { normalizeRecipient } from "./outbound.service.js";

export const notificationsModule = createModule("/notifications", "Notifications");
const { route } = notificationsModule;

const channelEnum = z.enum(["IN_APP", "EMAIL", "SMS", "WHATSAPP"]);
const outboundChannel = z.enum(["EMAIL", "SMS", "WHATSAPP"]);
const statusEnum = z.enum(["PENDING", "SENT", "FAILED", "SKIPPED"]);

// ───────────── own in-app notifications ─────────────

route({
  method: "get",
  path: "/",
  summary: "My in-app notifications (unread first, newest first)",
  access: "auth",
  query: pageQuery.extend({ unreadOnly: z.enum(["true", "false"]).optional() }),
  handler: async ({ query, user }) => {
    const where: Prisma.NotificationWhereInput = {
      userId: user.id,
      channel: "IN_APP",
      ...(query.unreadOnly === "true" ? { readAt: null } : {}),
    };
    const [rows, total, unread] = await Promise.all([
      prisma.notification.findMany({
        where,
        orderBy: [{ readAt: { sort: "asc", nulls: "first" } }, { createdAt: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: { id: true, type: true, title: true, body: true, link: true, readAt: true, createdAt: true },
      }),
      prisma.notification.count({ where }),
      prisma.notification.count({ where: { userId: user.id, channel: "IN_APP", readAt: null } }),
    ]);
    return withMeta(rows, { ...pageMeta(query.page, query.pageSize, total), unread });
  },
});

route({
  method: "get",
  path: "/unread-count",
  summary: "Number of my unread in-app notifications",
  access: "auth",
  handler: async ({ user }) => ({ count: await prisma.notification.count({ where: { userId: user.id, channel: "IN_APP", readAt: null } }) }),
});

route({
  method: "post",
  path: "/read-all",
  summary: "Mark all my in-app notifications as read",
  access: "auth",
  handler: async ({ user }) => {
    const r = await prisma.notification.updateMany({ where: { userId: user.id, channel: "IN_APP", readAt: null }, data: { readAt: new Date() } });
    return { updated: r.count };
  },
});

// ───────────── admin: outbound log ─────────────

route({
  method: "get",
  path: "/log",
  summary: "Outbound notification log (email / SMS / WhatsApp) with delivery status",
  access: "notifications.manage",
  query: pageQuery.extend(dateRangeQuery.shape).extend({
    channel: channelEnum.optional(),
    status: statusEnum.optional(),
    type: z.string().max(100).optional(),
    recipient: z.string().max(200).optional(),
  }),
  handler: async ({ query }) => {
    const range = dhakaRange(query.from, query.to);
    const where: Prisma.NotificationWhereInput = {
      channel: query.channel ?? { not: "IN_APP" },
      ...(query.status ? { status: query.status } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.recipient ? { recipient: { contains: query.recipient.trim().toLowerCase() } } : {}),
      ...(range.gte || range.lt ? { createdAt: range } : {}),
    };
    const [rows, total, byStatus] = await Promise.all([
      prisma.notification.findMany({ where, orderBy: { createdAt: "desc" }, skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
      prisma.notification.count({ where }),
      prisma.notification.groupBy({ by: ["status"], where, _count: { _all: true } }),
    ]);
    return withMeta(rows, {
      ...pageMeta(query.page, query.pageSize, total),
      byStatus: Object.fromEntries(byStatus.map((s) => [s.status, s._count._all])),
    });
  },
});

// ───────────── admin: templates ─────────────

const templateKey = z.string().trim().min(1).max(100).regex(/^[a-z0-9_.-]+$/i, "Use letters, digits, dot, dash or underscore");
const templateBody = z.object({
  key: templateKey,
  channel: channelEnum,
  subject: z.string().max(300).nullish(),
  body: z.string().min(1).max(5000),
  isActive: z.boolean().optional(),
});

route({
  method: "get",
  path: "/templates",
  summary: "Notification templates (stored overrides plus built-in English/Bengali defaults)",
  description: "Bengali variants use the key suffix `.bn` (e.g. `order.confirmed.bn`). Variables use `{{name}}`.",
  access: "notifications.manage",
  handler: async () => {
    const rows = await prisma.notificationTemplate.findMany({ orderBy: [{ key: "asc" }, { channel: "asc" }] });
    const defaults = Object.entries(DEFAULT_TEMPLATES).map(([key, t]) => ({ key, subject: t.subject, body: t.body, variables: t.vars }));
    return { templates: rows, defaults };
  },
});

route({
  method: "post",
  path: "/templates",
  summary: "Create a template override for (key, channel)",
  access: "notifications.manage",
  status: 201,
  body: templateBody,
  handler: async ({ body, user, ip }) => {
    const exists = await prisma.notificationTemplate.findUnique({ where: { key_channel: { key: body.key, channel: body.channel } } });
    if (exists) throw conflict("A template for this key and channel already exists", { id: exists.id });
    const t = await prisma.notificationTemplate.create({
      data: { key: body.key, channel: body.channel, subject: body.subject ?? null, body: body.body, isActive: body.isActive ?? true },
    });
    await audit(prisma, { userId: user.id, action: "notification_template.created", entityType: "NotificationTemplate", entityId: t.id, after: t, ip });
    return t;
  },
});

route({
  method: "put",
  path: "/templates/:id",
  summary: "Update a template",
  access: "notifications.manage",
  params: idParam,
  body: templateBody.partial(),
  handler: async ({ params, body, user, ip }) => {
    const before = assertFound(await prisma.notificationTemplate.findUnique({ where: { id: params.id } }), "Template");
    const t = await prisma.notificationTemplate.update({
      where: { id: params.id },
      data: {
        ...(body.key !== undefined ? { key: body.key } : {}),
        ...(body.channel !== undefined ? { channel: body.channel } : {}),
        ...(body.subject !== undefined ? { subject: body.subject ?? null } : {}),
        ...(body.body !== undefined ? { body: body.body } : {}),
        ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
      },
    });
    await audit(prisma, { userId: user.id, action: "notification_template.updated", entityType: "NotificationTemplate", entityId: t.id, before, after: t, ip });
    return t;
  },
});

route({
  method: "delete",
  path: "/templates/:id",
  summary: "Delete a template override (the built-in default is used again)",
  access: "notifications.manage",
  params: idParam,
  handler: async ({ params, user, ip }) => {
    const before = assertFound(await prisma.notificationTemplate.findUnique({ where: { id: params.id } }), "Template");
    await prisma.notificationTemplate.delete({ where: { id: params.id } });
    await audit(prisma, { userId: user.id, action: "notification_template.deleted", entityType: "NotificationTemplate", entityId: params.id, before, ip });
    return { deleted: true };
  },
});

route({
  method: "post",
  path: "/templates/preview",
  summary: "Render a template with sample variables",
  access: "notifications.manage",
  body: z.object({ key: templateKey, channel: channelEnum, lang: z.enum(["en", "bn"]).default("en"), vars: z.record(z.string(), z.union([z.string(), z.number()])).default({}) }),
  handler: async ({ body }) => {
    try {
      return await renderTemplate(body.key, body.channel, body.vars, body.lang);
    } catch (err) {
      throw badRequest((err as Error).message);
    }
  },
});

// ───────────── admin: opt-outs ─────────────

route({
  method: "get",
  path: "/opt-outs",
  summary: "Recipients who opted out of a channel",
  access: "notifications.manage",
  query: pageQuery.extend({ channel: outboundChannel.optional(), q: z.string().max(200).optional() }),
  handler: async ({ query }) => {
    const where: Prisma.NotificationOptOutWhereInput = {
      ...(query.channel ? { channel: query.channel } : {}),
      ...(query.q ? { recipient: { contains: query.q.trim().toLowerCase() } } : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.notificationOptOut.findMany({ where, orderBy: { createdAt: "desc" }, skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
      prisma.notificationOptOut.count({ where }),
    ]);
    return withMeta(rows, pageMeta(query.page, query.pageSize, total));
  },
});

route({
  method: "post",
  path: "/opt-outs",
  summary: "Record that a recipient opted out of a channel (e.g. replied STOP)",
  access: "notifications.manage",
  status: 201,
  body: z.object({ channel: outboundChannel, recipient: z.string().trim().min(3).max(200), reason: z.string().max(500).nullish() }),
  handler: async ({ body, user, ip }) => {
    const recipient = normalizeRecipient(body.channel, body.recipient);
    if (!recipient) throw badRequest(body.channel === "EMAIL" ? "Invalid email address" : "Invalid Bangladeshi mobile number");
    const row = await prisma.notificationOptOut.upsert({
      where: { channel_recipient: { channel: body.channel, recipient } },
      create: { channel: body.channel, recipient, reason: body.reason ?? null },
      update: { reason: body.reason ?? undefined },
    });
    await audit(prisma, { userId: user.id, action: "notification_opt_out.created", entityType: "NotificationOptOut", entityId: row.id, after: row, ip });
    return row;
  },
});

route({
  method: "delete",
  path: "/opt-outs/:id",
  summary: "Remove an opt-out (recipient opted back in)",
  access: "notifications.manage",
  params: idParam,
  handler: async ({ params, user, ip }) => {
    const before = assertFound(await prisma.notificationOptOut.findUnique({ where: { id: params.id } }), "Opt-out");
    await prisma.notificationOptOut.delete({ where: { id: params.id } });
    await audit(prisma, { userId: user.id, action: "notification_opt_out.deleted", entityType: "NotificationOptOut", entityId: params.id, before, ip });
    return { deleted: true };
  },
});

// ───────────── own notification by id (registered last: /:id) ─────────────

route({
  method: "post",
  path: "/:id/read",
  summary: "Mark one of my in-app notifications as read",
  access: "auth",
  params: idParam,
  handler: async ({ params, user }) => {
    const n = assertFound(await prisma.notification.findFirst({ where: { id: params.id, userId: user.id, channel: "IN_APP" } }), "Notification");
    if (n.readAt) return n;
    return prisma.notification.update({ where: { id: n.id }, data: { readAt: new Date() } });
  },
});
