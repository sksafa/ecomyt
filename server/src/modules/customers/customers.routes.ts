import { z } from "zod";
import ExcelJS from "exceljs";
import { createModule, idParam, pageMeta, pageQuery, withMeta } from "../../http/route.js";
import { prisma, Prisma } from "../../lib/prisma.js";
import { assertFound, conflict } from "../../lib/errors.js";
import { audit, diff } from "../../lib/audit.js";
import { normalizeBdPhone } from "../../lib/phone.js";
import { dhakaDate } from "../../lib/time.js";
import { requirePhone, recomputeCustomerStats } from "./customers.service.js";

export const customersModule = createModule("/customers", "Customers");
const { route } = customersModule;

/** Segment definitions are transparent rules on order history – no hidden scoring. */
export const SEGMENTS = {
  new: { label: "New (no delivered order yet)", where: { deliveredOrders: 0 } },
  first_time: { label: "One delivered order", where: { deliveredOrders: 1 } },
  repeat: { label: "Repeat buyers (2+ delivered)", where: { deliveredOrders: { gte: 2 } } },
  high_value: { label: "High value (lifetime ≥ ৳10,000)", where: { lifetimeValue: { gte: 10_000 } } },
  has_returns: { label: "Has returned orders", where: { returnedOrders: { gt: 0 } } },
  has_cancellations: { label: "Has cancelled orders", where: { cancelledOrders: { gt: 0 } } },
  inactive: { label: "No order in 90 days", where: { lastOrderAt: { lt: new Date(0) } } }, // replaced at query time
} satisfies Record<string, { label: string; where: Prisma.CustomerWhereInput }>;

const listQuery = pageQuery.extend({
  search: z.string().trim().max(100).optional(),
  segment: z.enum(Object.keys(SEGMENTS) as [keyof typeof SEGMENTS, ...(keyof typeof SEGMENTS)[]]).optional(),
  tag: z.string().optional(),
  sort: z.enum(["-lastOrderAt", "-lifetimeValue", "-totalOrders", "name", "-createdAt"]).default("-lastOrderAt"),
});

function customerWhere(q: z.infer<typeof listQuery>): Prisma.CustomerWhereInput {
  const and: Prisma.CustomerWhereInput[] = [{ deletedAt: null }];
  if (q.search) {
    const phone = normalizeBdPhone(q.search);
    and.push({
      OR: [
        ...(phone ? [{ phone }, { altPhone: phone }] : [{ phone: { contains: q.search.replace(/\D/g, "") || q.search } }]),
        { name: { contains: q.search, mode: "insensitive" } },
        { email: { contains: q.search, mode: "insensitive" } },
        { addresses: { some: { addressLine: { contains: q.search, mode: "insensitive" } } } },
      ],
    });
  }
  if (q.segment === "inactive") and.push({ lastOrderAt: { lt: new Date(Date.now() - 90 * 86_400_000) } });
  else if (q.segment) and.push(SEGMENTS[q.segment].where);
  if (q.tag) and.push({ tags: { has: q.tag } });
  return { AND: and };
}

const sortBy = (s: z.infer<typeof listQuery>["sort"]): Prisma.CustomerOrderByWithRelationInput =>
  ({ [s.replace("-", "")]: s.startsWith("-") ? { sort: "desc", nulls: "last" } : "asc" }) as Prisma.CustomerOrderByWithRelationInput;

route({
  method: "get",
  path: "/",
  summary: "Search customers (phone, name, email, address) with segments",
  access: "customers.view",
  query: listQuery,
  handler: async ({ query }) => {
    const where = customerWhere(query);
    const [rows, total] = await Promise.all([
      prisma.customer.findMany({ where, orderBy: sortBy(query.sort), skip: (query.page - 1) * query.pageSize, take: query.pageSize, include: { addresses: { where: { isDefault: true }, take: 1 } } }),
      prisma.customer.count({ where }),
    ]);
    return withMeta(rows, pageMeta(query.page, query.pageSize, total));
  },
});

route({
  method: "get",
  path: "/segments",
  summary: "Segment definitions and counts",
  access: "customers.view",
  handler: async () =>
    Promise.all(
      Object.entries(SEGMENTS).map(async ([key, s]) => ({
        key,
        label: s.label,
        count: await prisma.customer.count({
          where: { deletedAt: null, ...(key === "inactive" ? { lastOrderAt: { lt: new Date(Date.now() - 90 * 86_400_000) } } : s.where) },
        }),
      })),
    ),
});

route({
  method: "get",
  path: "/duplicates",
  summary: "Possible duplicate customer profiles (shared alternate phone, email, or same name + address)",
  access: "customers.view",
  handler: async () => {
    const byAltPhone = await prisma.$queryRaw<{ a: string; b: string; reason: string }[]>`
      SELECT a.id AS a, b.id AS b, 'Phone of one is the alternate phone of the other' AS reason
      FROM "Customer" a JOIN "Customer" b ON a."altPhone" = b.phone AND a.id <> b.id
      WHERE a."deletedAt" IS NULL AND b."deletedAt" IS NULL`;
    const byEmail = await prisma.$queryRaw<{ a: string; b: string; reason: string }[]>`
      SELECT a.id AS a, b.id AS b, 'Same email address' AS reason
      FROM "Customer" a JOIN "Customer" b ON lower(a.email) = lower(b.email) AND a.id < b.id
      WHERE a.email IS NOT NULL AND a."deletedAt" IS NULL AND b."deletedAt" IS NULL`;
    const byNameAddress = await prisma.$queryRaw<{ a: string; b: string; reason: string }[]>`
      SELECT DISTINCT ca."customerId" AS a, cb."customerId" AS b, 'Same name and address' AS reason
      FROM "CustomerAddress" ca
      JOIN "CustomerAddress" cb ON lower(ca."addressLine") = lower(cb."addressLine") AND ca."customerId" < cb."customerId"
      JOIN "Customer" x ON x.id = ca."customerId" JOIN "Customer" y ON y.id = cb."customerId"
      WHERE lower(x.name) = lower(y.name) AND x."deletedAt" IS NULL AND y."deletedAt" IS NULL
      LIMIT 500`;
    const pairs = [...byAltPhone, ...byEmail, ...byNameAddress];
    const ids = [...new Set(pairs.flatMap((p) => [p.a, p.b]))];
    const customers = new Map((await prisma.customer.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, phone: true, email: true, totalOrders: true } })).map((c) => [c.id, c]));
    return pairs.map((p) => ({ reason: p.reason, customers: [customers.get(p.a), customers.get(p.b)] }));
  },
});

route({
  method: "get",
  path: "/export",
  summary: "Export customers (CSV/XLSX)",
  access: ["customers.view", "customers.export"],
  raw: true,
  query: listQuery.extend({ format: z.enum(["csv", "xlsx"]).default("csv") }),
  handler: async ({ query, res, user, ip }) => {
    const rows = await prisma.customer.findMany({ where: customerWhere(query), orderBy: sortBy(query.sort), take: 50_000, include: { addresses: { where: { isDefault: true }, take: 1 } } });
    await audit(prisma, { userId: user.id, action: "customer.exported", entityType: "Customer", after: { count: rows.length, segment: query.segment ?? null }, ip });
    const header = ["Name", "Phone", "Alt phone", "Email", "Address", "District", "Orders", "Delivered", "Cancelled", "Returned", "Lifetime value", "First order", "Last order", "Tags"];
    const data = rows.map((c) => [
      c.name, c.phone, c.altPhone ?? "", c.email ?? "", c.addresses[0]?.addressLine ?? "", c.addresses[0]?.districtName ?? "",
      c.totalOrders, c.deliveredOrders, c.cancelledOrders, c.returnedOrders, c.lifetimeValue.toFixed(2),
      c.firstOrderAt ? dhakaDate(c.firstOrderAt) : "", c.lastOrderAt ? dhakaDate(c.lastOrderAt) : "", c.tags.join("|"),
    ]);
    const filename = `customers-${dhakaDate()}.${query.format}`;
    if (query.format === "csv") {
      const esc = (v: unknown) => {
        const s = String(v ?? "");
        const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
        return /[",\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
      };
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send("﻿" + [header, ...data].map((r) => r.map(esc).join(",")).join("\n"));
      return;
    }
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Customers");
    ws.addRow(header).font = { bold: true };
    data.forEach((r) => ws.addRow(r));
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    await wb.xlsx.write(res);
    res.end();
  },
});

route({
  method: "get",
  path: "/by-phone/:phone",
  summary: "Look up a customer by phone (any BD format)",
  access: "customers.view",
  params: z.object({ phone: z.string() }),
  handler: async ({ params }) => {
    const phone = requirePhone(params.phone);
    return prisma.customer.findFirst({ where: { OR: [{ phone }, { altPhone: phone }], deletedAt: null }, include: { addresses: true } });
  },
});

route({
  method: "get",
  path: "/:id",
  summary: "Customer profile with orders and communication history",
  access: "customers.view",
  params: idParam,
  handler: async ({ params }) => {
    const c = assertFound(
      await prisma.customer.findUnique({
        where: { id: params.id },
        include: {
          addresses: { orderBy: { isDefault: "desc" } },
          orders: {
            orderBy: { createdAt: "desc" }, take: 100,
            select: { id: true, orderNumber: true, status: true, total: true, paidAmount: true, createdAt: true, channel: true, paymentStatus: true, items: { select: { productName: true, quantity: true } } },
          },
          communications: { orderBy: { createdAt: "desc" }, take: 100, include: { user: { select: { id: true, name: true } } } },
        },
      }),
      "Customer",
    );
    const finished = c.deliveredOrders + c.returnedOrders;
    return {
      ...c,
      indicators: {
        isRepeat: c.deliveredOrders >= 2,
        deliverySuccessRate: finished ? Math.round((c.deliveredOrders / finished) * 100) : null,
        returnRate: finished ? Math.round((c.returnedOrders / finished) * 100) : null,
      },
    };
  },
});

route({
  method: "patch",
  path: "/:id",
  summary: "Correct customer details, tags and notes",
  access: "customers.edit",
  params: idParam,
  body: z.object({
    name: z.string().trim().min(2).max(100).optional(),
    phone: z.string().optional(),
    altPhone: z.string().nullable().optional(),
    email: z.string().email().nullable().optional(),
    notes: z.string().max(5000).nullable().optional(),
    tags: z.array(z.string().trim().min(1).max(40)).max(30).optional(),
  }),
  handler: async ({ params, body, user, ip }) => {
    const c = assertFound(await prisma.customer.findUnique({ where: { id: params.id } }), "Customer");
    const data = {
      ...body,
      ...(body.phone ? { phone: requirePhone(body.phone) } : {}),
      ...(body.altPhone ? { altPhone: requirePhone(body.altPhone) } : {}),
    };
    if (data.phone && data.phone !== c.phone && (await prisma.customer.findUnique({ where: { phone: data.phone } }))) {
      throw conflict("Another customer already uses this phone – use merge instead");
    }
    const updated = await prisma.customer.update({ where: { id: c.id }, data });
    const d = diff({ name: c.name, phone: c.phone, altPhone: c.altPhone, email: c.email, notes: c.notes, tags: c.tags }, data);
    if (d.changed) await audit(prisma, { userId: user.id, action: "customer.updated", entityType: "Customer", entityId: c.id, before: d.before, after: d.after, ip });
    return updated;
  },
});

route({
  method: "post",
  path: "/:id/communications",
  summary: "Log a call / message / note with the customer",
  access: "customers.edit",
  status: 201,
  params: idParam,
  body: z.object({
    channel: z.enum(["CALL", "SMS", "WHATSAPP", "EMAIL", "MESSENGER", "NOTE"]),
    direction: z.enum(["INBOUND", "OUTBOUND"]).default("OUTBOUND"),
    summary: z.string().trim().min(1).max(2000),
    outcome: z.string().max(100).optional(),
    orderId: z.string().optional(),
  }),
  handler: async ({ params, body, user }) => {
    assertFound(await prisma.customer.findUnique({ where: { id: params.id }, select: { id: true } }), "Customer");
    return prisma.communicationLog.create({ data: { ...body, customerId: params.id, userId: user.id }, include: { user: { select: { id: true, name: true } } } });
  },
});

route({
  method: "post",
  path: "/:id/merge",
  summary: "Merge a duplicate profile into this customer (orders, addresses and history move over)",
  access: "customers.edit",
  params: idParam,
  body: z.object({ duplicateId: z.string(), reason: z.string().trim().min(3).max(300) }),
  handler: async ({ params, body, user, ip }) => {
    if (params.id === body.duplicateId) throw conflict("Cannot merge a customer into itself");
    const [keep, dup] = await Promise.all([
      prisma.customer.findUnique({ where: { id: params.id } }),
      prisma.customer.findUnique({ where: { id: body.duplicateId } }),
    ]);
    assertFound(keep, "Customer");
    assertFound(dup, "Duplicate customer");
    await prisma.$transaction(async (tx) => {
      await tx.order.updateMany({ where: { customerId: dup!.id }, data: { customerId: keep!.id } });
      await tx.customerAddress.updateMany({ where: { customerId: dup!.id }, data: { customerId: keep!.id, isDefault: false } });
      await tx.communicationLog.updateMany({ where: { customerId: dup!.id }, data: { customerId: keep!.id } });
      await tx.customer.update({
        where: { id: keep!.id },
        data: { altPhone: keep!.altPhone ?? dup!.phone, tags: [...new Set([...keep!.tags, ...dup!.tags])], notes: [keep!.notes, dup!.notes].filter(Boolean).join("\n") || null },
      });
      await tx.customer.update({ where: { id: dup!.id }, data: { deletedAt: new Date(), phone: `merged:${dup!.id}`, notes: `Merged into ${keep!.id}` } });
      await recomputeCustomerStats(tx, keep!.id);
      await audit(tx, { userId: user.id, action: "customer.merged", entityType: "Customer", entityId: keep!.id, before: { duplicateId: dup!.id, duplicatePhone: dup!.phone }, reason: body.reason, ip });
    });
    return { mergedInto: keep!.id };
  },
});

route({
  method: "delete",
  path: "/:id",
  summary: "Erase a customer",
  description: "Customers without orders are deleted. Customers with orders are anonymised: personal data is removed, orders keep only what accounting requires.",
  access: "customers.delete",
  params: idParam,
  body: z.object({ reason: z.string().trim().min(3).max(300) }),
  handler: async ({ params, body, user, ip }) => {
    const c = assertFound(await prisma.customer.findUnique({ where: { id: params.id }, include: { _count: { select: { orders: true } } } }), "Customer");
    if (c._count.orders === 0) {
      await prisma.customer.delete({ where: { id: c.id } });
      await audit(prisma, { userId: user.id, action: "customer.deleted", entityType: "Customer", entityId: c.id, reason: body.reason, ip });
      return { result: "deleted" };
    }
    await prisma.$transaction(async (tx) => {
      const anon = `Erased customer ${c.id.slice(-6)}`;
      await tx.customer.update({ where: { id: c.id }, data: { name: anon, phone: `erased:${c.id}`, altPhone: null, email: null, notes: null, tags: [], anonymizedAt: new Date(), deletedAt: new Date() } });
      await tx.customerAddress.deleteMany({ where: { customerId: c.id } });
      await tx.communicationLog.deleteMany({ where: { customerId: c.id } });
      await tx.order.updateMany({ where: { customerId: c.id }, data: { shippingName: anon, shippingPhone: "00000000000", shippingAddress: "[erased]", deliveryNote: null } });
      await tx.marketingAttribution.updateMany({ where: { order: { customerId: c.id } }, data: { fbc: null, fbp: null, fbclid: null, referrer: null, clientIpAddress: null, clientUserAgent: null } });
      await audit(tx, { userId: user.id, action: "customer.anonymized", entityType: "Customer", entityId: c.id, reason: body.reason, ip });
    });
    return { result: "anonymized" };
  },
});
