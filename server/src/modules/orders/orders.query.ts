import { z } from "zod";
import { prisma, Prisma } from "../../lib/prisma.js";
import { dhakaRange } from "../../lib/time.js";
import { csvList, dateRangeQuery, pageQuery } from "../../http/route.js";
import { normalizeBdPhone } from "../../lib/phone.js";
import { money } from "../../lib/money.js";
import type { AuthUser } from "../../middleware/auth.js";
import { RISK_FLAG_TEXT } from "../customers/customers.service.js";

const ORDER_STATUSES = [
  "PENDING", "CONFIRMATION_REQUIRED", "CONFIRMED", "PROCESSING", "READY_TO_SHIP", "COURIER_BOOKED", "SHIPPED", "DELIVERED",
  "CANCELLED", "RETURN_REQUESTED", "RETURN_IN_TRANSIT", "RETURNED", "EXCHANGE_REQUESTED", "EXCHANGED", "ON_HOLD",
] as const;

export const orderFilterSchema = pageQuery.merge(dateRangeQuery).extend({
  q: z.string().trim().max(100).optional(),
  status: csvList,
  paymentStatus: csvList,
  paymentMethod: csvList,
  channel: csvList,
  assignedToId: z.string().optional(), // "none" = unassigned
  providerId: z.string().optional(),
  booked: z.enum(["yes", "no"]).optional(),
  district: z.string().optional(),
  productId: z.string().optional(),
  flagged: z.enum(["true", "false"]).optional(),
  duplicates: z.enum(["true", "false"]).optional(),
  preorder: z.enum(["true", "false"]).optional(),
  sort: z.enum(["createdAt", "-createdAt", "total", "-total", "riskScore", "-riskScore", "orderNumber", "-orderNumber"]).default("-createdAt"),
});
export type OrderFilters = z.infer<typeof orderFilterSchema>;

export function buildOrderWhere(f: Omit<OrderFilters, "page" | "pageSize" | "sort">, opts: { ignoreStatus?: boolean } = {}): Prisma.OrderWhereInput {
  const and: Prisma.OrderWhereInput[] = [];
  if (f.q) {
    const q = f.q;
    const phone = normalizeBdPhone(q);
    const digits = q.replace(/\D/g, "");
    and.push({
      OR: [
        { orderNumber: { equals: q.toUpperCase() } },
        { orderNumber: { contains: q.toUpperCase() } },
        ...(phone ? [{ shippingPhone: phone }, { customer: { phone } }, { customer: { altPhone: phone } }] : []),
        ...(digits.length >= 5 ? [{ shippingPhone: { contains: digits } }] : []),
        { shippingName: { contains: q, mode: "insensitive" } },
        { customer: { name: { contains: q, mode: "insensitive" } } },
        { shippingAddress: { contains: q, mode: "insensitive" } },
        { shipments: { some: { OR: [{ trackingCode: q }, { consignmentId: q }] } } },
        { items: { some: { sku: { equals: q, mode: "insensitive" } } } },
      ],
    });
  }
  if (!opts.ignoreStatus && f.status?.length) and.push({ status: { in: f.status as never } });
  if (f.paymentStatus?.length) and.push({ paymentStatus: { in: f.paymentStatus as never } });
  if (f.paymentMethod?.length) and.push({ paymentMethod: { in: f.paymentMethod as never } });
  if (f.channel?.length) and.push({ channel: { in: f.channel as never } });
  if (f.assignedToId) and.push({ assignedToId: f.assignedToId === "none" ? null : f.assignedToId });
  if (f.providerId) and.push({ shipments: { some: { providerId: f.providerId, isReturn: false, status: { notIn: ["CANCELLED", "FAILED"] } } } });
  if (f.booked === "yes") and.push({ shipments: { some: { isReturn: false, status: { notIn: ["CANCELLED", "FAILED"] } } } });
  if (f.booked === "no") and.push({ shipments: { none: { isReturn: false, status: { notIn: ["CANCELLED", "FAILED"] } } } });
  if (f.district) and.push({ districtName: { equals: f.district, mode: "insensitive" } });
  if (f.productId) and.push({ items: { some: { productId: f.productId } } });
  if (f.flagged === "true") and.push({ riskScore: { gt: 0 } });
  if (f.duplicates === "true") and.push({ riskFlags: { has: "POSSIBLE_DUPLICATE" } });
  if (f.preorder) and.push({ isPreorder: f.preorder === "true" });
  const range = dhakaRange(f.from, f.to);
  if (range.gte || range.lt) and.push({ createdAt: range });
  return and.length ? { AND: and } : {};
}

export const orderListInclude = {
  customer: { select: { id: true, name: true, phone: true, totalOrders: true, deliveredOrders: true, returnedOrders: true, cancelledOrders: true } },
  items: { orderBy: { id: "asc" } },
  assignedTo: { select: { id: true, name: true } },
  shipments: {
    where: { isReturn: false },
    orderBy: { createdAt: "desc" },
    take: 1,
    include: { provider: { select: { id: true, code: true, name: true } } },
  },
  attribution: { select: { lastSource: true, lastCampaign: true, lastMedium: true } },
} satisfies Prisma.OrderInclude;

type ListOrder = Prisma.OrderGetPayload<{ include: typeof orderListInclude }>;

/** Strip cost / margin fields for users without finance.view. */
export function serializeOrder(o: ListOrder, user: AuthUser) {
  const finance = user.permissions.has("finance.view");
  const due = money(o.total).minus(o.paidAmount).minus(0);
  const productRevenue = money(o.subtotal).minus(o.discountTotal);
  return {
    id: o.id,
    orderNumber: o.orderNumber,
    status: o.status,
    paymentStatus: o.paymentStatus,
    paymentMethod: o.paymentMethod,
    channel: o.channel,
    createdAt: o.createdAt,
    scheduledFor: o.scheduledFor,
    isPreorder: o.isPreorder,
    customer: o.customer,
    shipping: {
      name: o.shippingName, phone: o.shippingPhone, address: o.shippingAddress, district: o.districtName, area: o.areaName, division: o.divisionName, note: o.deliveryNote,
    },
    items: o.items.map((i) => ({
      id: i.id, productId: i.productId, variantId: i.variantId, productName: i.productName, variantName: i.variantName, sku: i.sku,
      color: i.color, size: i.size, imageUrl: i.imageUrl, quantity: i.quantity, unitPrice: i.unitPrice, discount: i.discount, lineTotal: i.lineTotal,
      ...(finance ? { unitCost: i.unitCost, costTotal: i.costTotal } : {}),
    })),
    amounts: {
      subtotal: o.subtotal, discount: o.discountTotal, deliveryCharge: o.deliveryCharge, total: o.total, paid: o.paidAmount,
      due: due.isNegative() ? "0.00" : due.toFixed(2), cod: o.codAmount, refunded: o.refundedAmount,
      ...(finance ? { productCost: o.productCostTotal, productMargin: productRevenue.minus(o.productCostTotal).toFixed(2), packagingCost: o.packagingCost } : {}),
    },
    risk: {
      score: o.riskScore,
      flags: o.riskFlags.map((code) => ({ code, ...(RISK_FLAG_TEXT[code] ?? { en: code, bn: code }) })),
    },
    assignedTo: o.assignedTo,
    shipment: o.shipments[0]
      ? {
          id: o.shipments[0].id, status: o.shipments[0].status, trackingCode: o.shipments[0].trackingCode, consignmentId: o.shipments[0].consignmentId,
          provider: o.shipments[0].provider, lastError: o.shipments[0].lastError,
        }
      : null,
    attribution: o.attribution,
  };
}

export function orderBy(sort: OrderFilters["sort"]): Prisma.OrderOrderByWithRelationInput {
  const desc = sort.startsWith("-");
  const field = sort.replace("-", "") as "createdAt" | "total" | "riskScore" | "orderNumber";
  return { [field]: desc ? "desc" : "asc" };
}

export async function listOrders(f: OrderFilters, user: AuthUser) {
  const where = buildOrderWhere(f);
  const [rows, total, counts] = await Promise.all([
    prisma.order.findMany({ where, include: orderListInclude, orderBy: [orderBy(f.sort), { id: "desc" }], skip: (f.page - 1) * f.pageSize, take: f.pageSize }),
    prisma.order.count({ where }),
    prisma.order.groupBy({ by: ["status"], where: buildOrderWhere(f, { ignoreStatus: true }), _count: { _all: true } }),
  ]);
  const statusCounts: Record<string, number> = Object.fromEntries(ORDER_STATUSES.map((s) => [s, 0]));
  for (const c of counts) statusCounts[c.status] = c._count._all;
  statusCounts.ALL = Object.values(statusCounts).reduce((a, b) => a + b, 0);
  return { rows: rows.map((o) => serializeOrder(o, user)), total, statusCounts };
}
