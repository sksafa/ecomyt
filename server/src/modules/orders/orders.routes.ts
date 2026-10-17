import { z } from "zod";
import ExcelJS from "exceljs";
import { createModule, idParam, moneySchema, pageMeta, withMeta } from "../../http/route.js";
import { prisma } from "../../lib/prisma.js";
import { assertFound, badRequest } from "../../lib/errors.js";
import { audit } from "../../lib/audit.js";
import { money } from "../../lib/money.js";
import { dhakaDate } from "../../lib/time.js";
import type { AuthUser } from "../../middleware/auth.js";
import { computeOrderProfit } from "../finance/ledger.service.js";
import { assessRisk, RISK_FLAG_TEXT } from "../customers/customers.service.js";
import * as orders from "./orders.service.js";
import { buildOrderWhere, listOrders, orderBy, orderFilterSchema, orderListInclude, serializeOrder } from "./orders.query.js";
import { STATUS_LABELS, TRANSITIONS, isSystemOnly, permissionFor } from "./order-status.js";

export const ordersModule = createModule("/orders", "Orders");
const { route } = ordersModule;

const actorOf = (user: AuthUser, ip: string): orders.Actor => ({ userId: user.id, permissions: user.permissions, source: "USER", ip });

const statusEnum = z.enum(Object.keys(TRANSITIONS) as [string, ...string[]]);
const methodEnum = z.enum(["COD", "BKASH", "NAGAD", "ROCKET", "SSLCOMMERZ", "CARD", "BANK_TRANSFER", "CASH"]);
const channelEnum = z.enum(["WEBSITE", "FACEBOOK", "INSTAGRAM", "WHATSAPP", "PHONE", "MANUAL", "OTHER"]);

const itemSchema = z.object({
  variantId: z.string().min(1),
  quantity: z.number().int().min(1).max(999),
  unitPrice: moneySchema.optional(),
  discount: moneySchema.optional(),
});
const shippingSchema = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  phone: z.string().max(20).optional(),
  addressLine: z.string().trim().min(5).max(500),
  districtId: z.string().nullish(),
  areaId: z.string().nullish(),
  districtName: z.string().max(80).nullish(),
  areaName: z.string().max(80).nullish(),
  note: z.string().max(500).nullish(),
});

route({
  method: "get",
  path: "/",
  summary: "List / search / filter orders",
  description: "Server-side pagination. `meta.statusCounts` gives per-status totals for the current filters (for tabs).",
  access: "orders.view",
  query: orderFilterSchema,
  handler: async ({ query, user }) => {
    const { rows, total, statusCounts } = await listOrders(query, user);
    return withMeta(rows, { ...pageMeta(query.page, query.pageSize, total), statusCounts });
  },
});

route({
  method: "get",
  path: "/meta/statuses",
  summary: "Status labels (EN/BN) and allowed transitions",
  access: "orders.view",
  handler: () =>
    Object.fromEntries(
      Object.entries(TRANSITIONS).map(([s, next]) => [
        s,
        { ...STATUS_LABELS[s as keyof typeof STATUS_LABELS], next: next.map((to) => ({ to, systemOnly: isSystemOnly(s as never, to), permission: permissionFor(to) })) },
      ]),
    ),
});

route({
  method: "post",
  path: "/",
  summary: "Create an order manually",
  description: "Customer is matched by phone. Stock is reserved immediately. Send an Idempotency-Key header to make retries safe.",
  access: "orders.create",
  status: 201,
  idempotent: true,
  body: z.object({
    customer: z.object({ name: z.string().trim().min(2).max(100), phone: z.string().min(10).max(20), email: z.string().email().nullish() }),
    shipping: shippingSchema,
    items: z.array(itemSchema).min(1).max(50),
    discount: moneySchema.optional(),
    deliveryCharge: moneySchema.optional(),
    paymentMethod: methodEnum.optional(),
    channel: channelEnum.optional(),
    isPreorder: z.boolean().optional(),
    scheduledFor: z.string().datetime().nullish(),
    assignedToId: z.string().nullish(),
    note: z.string().max(2000).nullish(),
  }),
  handler: async ({ body, user, ip, req }) => {
    const { order } = await orders.createOrder(
      { ...body, idempotencyKey: req.header("idempotency-key") ? `staff:${user.id}:${req.header("idempotency-key")}` : null },
      actorOf(user, ip),
    );
    return { id: order.id, orderNumber: order.orderNumber, status: order.status };
  },
});

route({
  method: "post",
  path: "/risk-check",
  summary: "Preview risk indicators for a phone/address before creating an order",
  access: "orders.view",
  body: z.object({ phone: z.string(), addressLine: z.string().default(""), total: moneySchema.default("0"), paymentMethod: methodEnum.default("COD") }),
  handler: async ({ body }) => {
    const { normalizeBdPhone } = await import("../../lib/phone.js");
    const phone = normalizeBdPhone(body.phone);
    if (!phone) throw badRequest("Invalid phone number");
    const customer = await prisma.customer.findUnique({ where: { phone } });
    const risk = await assessRisk(prisma, { phone, customerId: customer?.id, addressLine: body.addressLine || "x".repeat(20), total: money(body.total), paymentMethod: body.paymentMethod });
    return {
      ...risk,
      customer: customer
        ? { id: customer.id, name: customer.name, totalOrders: customer.totalOrders, deliveredOrders: customer.deliveredOrders, returnedOrders: customer.returnedOrders, cancelledOrders: customer.cancelledOrders }
        : null,
    };
  },
});

route({
  method: "get",
  path: "/export",
  summary: "Export filtered (or selected) orders as CSV or XLSX",
  access: ["orders.view", "orders.export"],
  raw: true,
  query: orderFilterSchema.extend({ format: z.enum(["csv", "xlsx"]).default("csv"), ids: z.string().optional() }),
  handler: async ({ query, user, res, ip }) => {
    const where = query.ids ? { id: { in: query.ids.split(",") } } : buildOrderWhere(query);
    const rows = await prisma.order.findMany({ where, include: orderListInclude, orderBy: orderBy(query.sort), take: 20_000 });
    const finance = user.permissions.has("finance.view");
    const header = [
      "Order", "Created (Dhaka)", "Status", "Channel", "Customer", "Phone", "Address", "Area", "District", "Items", "Quantity",
      "Subtotal", "Discount", "Delivery", "Total", "Paid", "Due", "Payment method", "Payment status", "Courier", "Tracking", "Assigned to",
      ...(finance ? ["Product cost", "Product margin"] : []),
    ];
    const data = rows.map((o) => {
      const s = serializeOrder(o, user);
      return [
        o.orderNumber, `${dhakaDate(o.createdAt)} ${new Date(o.createdAt.getTime() + 6 * 3600_000).toISOString().slice(11, 16)}`, o.status, o.channel,
        o.shippingName, o.shippingPhone, o.shippingAddress, o.areaName ?? "", o.districtName ?? "",
        o.items.map((i) => `${i.productName}${i.variantName ? ` (${i.variantName})` : ""} x${i.quantity}`).join("; "),
        o.items.reduce((n, i) => n + i.quantity, 0),
        o.subtotal.toFixed(2), o.discountTotal.toFixed(2), o.deliveryCharge.toFixed(2), o.total.toFixed(2), o.paidAmount.toFixed(2), s.amounts.due,
        o.paymentMethod, o.paymentStatus, o.shipments[0]?.provider.name ?? "", o.shipments[0]?.trackingCode ?? "", o.assignedTo?.name ?? "",
        ...(finance ? [o.productCostTotal.toFixed(2), s.amounts.productMargin ?? ""] : []),
      ];
    });
    await audit(prisma, { userId: user.id, action: "order.exported", entityType: "Order", after: { count: rows.length, format: query.format }, ip });

    const filename = `orders-${dhakaDate()}.${query.format}`;
    if (query.format === "csv") {
      const esc = (v: unknown) => {
        const s = String(v ?? "");
        // neutralise spreadsheet formula injection
        const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
        return /[",\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
      };
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send("﻿" + [header, ...data].map((r) => r.map(esc).join(",")).join("\n"));
      return;
    }
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Orders");
    ws.addRow(header).font = { bold: true };
    data.forEach((r) => ws.addRow(r));
    ws.columns.forEach((c) => (c.width = 16));
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    await wb.xlsx.write(res);
    res.end();
  },
});

route({
  method: "post",
  path: "/print",
  summary: "Data for printing invoices, packing slips or labels for one or many orders",
  access: "orders.view",
  body: z.object({ ids: z.array(z.string()).min(1).max(200) }),
  handler: async ({ body, user }) => {
    const rows = await prisma.order.findMany({ where: { id: { in: body.ids } }, include: orderListInclude, orderBy: { createdAt: "asc" } });
    const store = (await import("../../lib/settings.js")).getSetting("store");
    return { store: await store, orders: rows.map((o) => serializeOrder(o, user)) };
  },
});

route({
  method: "post",
  path: "/bulk/status",
  summary: "Change status of many orders (reports per-order failures)",
  access: ["orders.view", "orders.bulk"],
  body: z.object({ ids: z.array(z.string()).min(1).max(500), status: statusEnum, reason: z.string().max(500).optional() }),
  handler: ({ body, user, ip }) => orders.bulkChangeStatus(body.ids, body.status as never, actorOf(user, ip), body.reason),
});

route({
  method: "post",
  path: "/bulk/assign",
  summary: "Assign (or unassign) orders to a staff member",
  access: "orders.assign",
  body: z.object({ ids: z.array(z.string()).min(1).max(500), assigneeId: z.string().nullable() }),
  handler: ({ body, user, ip }) => orders.assignOrders(body.ids, body.assigneeId, actorOf(user, ip)),
});

route({
  method: "get",
  path: "/:id",
  summary: "Order details with history, notes, payments, shipments and profit breakdown",
  access: "orders.view",
  params: idParam,
  handler: async ({ params, user }) => {
    const o = assertFound(
      await prisma.order.findUnique({
        where: { id: params.id },
        include: {
          ...orderListInclude,
          shipments: { orderBy: { createdAt: "desc" }, include: { provider: { select: { id: true, code: true, name: true } } } },
          zone: { select: { code: true, name: true } },
          statusHistory: { orderBy: { createdAt: "asc" }, include: { user: { select: { id: true, name: true } } } },
          notes: { orderBy: { createdAt: "desc" }, include: { user: { select: { id: true, name: true } } } },
          communications: { orderBy: { createdAt: "desc" }, include: { user: { select: { id: true, name: true } } } },
          payments: { orderBy: { createdAt: "asc" } },
          refunds: { orderBy: { createdAt: "asc" } },
          returns: { select: { id: true, returnNumber: true, type: true, status: true, isRto: true, createdAt: true } },
          attribution: true,
          createdBy: { select: { id: true, name: true } },
          sourceOrder: { select: { id: true, orderNumber: true } },
        },
      }),
      "Order",
    );
    const base = serializeOrder({ ...o, shipments: o.shipments.filter((s) => !s.isReturn).slice(0, 1) }, user);
    const finance = user.permissions.has("finance.view");
    return {
      ...base,
      zone: o.zone,
      shipments: o.shipments,
      statusHistory: o.statusHistory,
      notes: o.notes,
      communications: o.communications,
      payments: o.payments,
      refunds: o.refunds,
      returns: o.returns,
      attribution: o.attribution,
      createdBy: o.createdBy,
      sourceOrder: o.sourceOrder,
      timestamps: { confirmedAt: o.confirmedAt, shippedAt: o.shippedAt, deliveredAt: o.deliveredAt, cancelledAt: o.cancelledAt, returnedAt: o.returnedAt },
      cancelReason: o.cancelReason,
      stock: { reserved: o.stockReserved, deducted: o.stockDeducted },
      nextStatuses: TRANSITIONS[o.status].map((to) => ({ to, systemOnly: isSystemOnly(o.status, to), allowed: !isSystemOnly(o.status, to) && user.permissions.has(permissionFor(to)) })),
      ...(finance ? { profit: await computeOrderProfit(prisma, o), financeStatus: o.financeStatus } : {}),
    };
  },
});

route({
  method: "patch",
  path: "/:id",
  summary: "Edit order details, address or items (before shipping)",
  description: "Item changes re-reserve stock. Price overrides need orders.edit; delivery override needs orders.override_delivery.",
  access: "orders.edit",
  params: idParam,
  body: z.object({
    customerName: z.string().trim().min(2).max(100).optional(),
    shipping: shippingSchema.partial().optional(),
    items: z.array(itemSchema).min(1).max(50).optional(),
    discount: moneySchema.optional(),
    deliveryCharge: moneySchema.optional(),
    paymentMethod: methodEnum.optional(),
    channel: channelEnum.optional(),
    scheduledFor: z.string().datetime().nullish(),
    packagingCost: moneySchema.optional(),
    reason: z.string().max(500).optional(),
  }),
  handler: async ({ params, body, user, ip }) => {
    const o = await orders.updateOrder(params.id, body, actorOf(user, ip));
    return { id: o.id, status: o.status, total: o.total };
  },
});

route({
  method: "post",
  path: "/:id/status",
  summary: "Move an order to another status (validated transition)",
  access: "orders.view",
  params: idParam,
  body: z.object({ status: statusEnum, reason: z.string().max(500).optional() }),
  handler: async ({ params, body, user, ip }) => {
    const { order } = await orders.changeStatus(params.id, body.status as never, actorOf(user, ip), { reason: body.reason });
    return { id: order.id, status: order.status };
  },
});

route({
  method: "post",
  path: "/:id/notes",
  summary: "Add an internal note",
  access: "orders.view",
  status: 201,
  params: idParam,
  body: z.object({ body: z.string().trim().min(1).max(2000) }),
  handler: async ({ params, body, user }) => {
    assertFound(await prisma.order.findUnique({ where: { id: params.id }, select: { id: true } }), "Order");
    return prisma.orderNote.create({ data: { orderId: params.id, userId: user.id, body: body.body }, include: { user: { select: { id: true, name: true } } } });
  },
});

route({
  method: "post",
  path: "/:id/communications",
  summary: "Log a call / message with the customer about this order",
  access: "orders.view",
  status: 201,
  params: idParam,
  body: z.object({
    channel: z.enum(["CALL", "SMS", "WHATSAPP", "EMAIL", "MESSENGER", "NOTE"]),
    direction: z.enum(["INBOUND", "OUTBOUND"]).default("OUTBOUND"),
    summary: z.string().trim().min(1).max(2000),
    outcome: z.string().max(100).optional(),
  }),
  handler: async ({ params, body, user }) => {
    const order = assertFound(await prisma.order.findUnique({ where: { id: params.id }, select: { id: true, customerId: true } }), "Order");
    return prisma.communicationLog.create({
      data: { ...body, orderId: order.id, customerId: order.customerId, userId: user.id },
      include: { user: { select: { id: true, name: true } } },
    });
  },
});

route({
  method: "post",
  path: "/:id/duplicate",
  summary: "Create a new pending order from this one (re-priced, stock re-reserved)",
  access: "orders.create",
  status: 201,
  params: idParam,
  body: z.object({ reason: z.string().trim().min(3).max(300) }),
  handler: async ({ params, body, user, ip }) => {
    const o = await orders.duplicateOrder(params.id, actorOf(user, ip), body.reason);
    return { id: o.id, orderNumber: o.orderNumber, status: o.status };
  },
});

route({
  method: "get",
  path: "/:id/risk",
  summary: "Explain the order's risk indicators",
  access: "orders.view",
  params: idParam,
  handler: async ({ params }) => {
    const o = assertFound(await prisma.order.findUnique({ where: { id: params.id } }), "Order");
    const live = await assessRisk(prisma, { phone: o.shippingPhone, customerId: o.customerId, addressLine: o.shippingAddress, total: money(o.total), paymentMethod: o.paymentMethod, excludeOrderId: o.id });
    return { atCreation: { score: o.riskScore, flags: o.riskFlags.map((code) => ({ code, ...RISK_FLAG_TEXT[code] })) }, current: live };
  },
});
