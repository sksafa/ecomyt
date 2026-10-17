import { prisma, Prisma } from "../../lib/prisma.js";
import { money, sum, ZERO } from "../../lib/money.js";
import { dateOnly, dhakaDate } from "../../lib/time.js";
import { forbidden, notFound } from "../../lib/errors.js";
import type { Permission } from "../../rbac/permissions.js";
import type { AuthUser } from "../../middleware/auth.js";
import { profitAndLoss } from "../finance/reports.service.js";
import { canSeeFinance, DELIVERED_STATES, fixed, inRange, orderSqlFilter, orderWhere, pct, RETURNED_STATES, TZ, type ResolvedRange } from "./common.js";

export interface Column {
  key: string;
  label: string;
  /** Money column – removed for users without finance.view. */
  money?: boolean;
}

type Cell = string | number | null;
type Row = Record<string, Cell>;

export interface ReportResult {
  columns: Column[];
  rows: Row[];
  totals: Record<string, unknown>;
  /** Keys of `totals` that are money (stripped without finance.view). */
  moneyTotals?: string[];
  /** Total row count when the report is paginated. */
  total?: number;
  notes?: string[];
}

export interface ReportFilters {
  status?: string[];
  channel?: string[];
  productId?: string;
  providerId?: string;
}

export interface ReportCtx {
  r: ResolvedRange;
  page: number;
  pageSize: number;
  f: ReportFilters;
  user: AuthUser;
}

interface ReportDef {
  title: string;
  description: string;
  /** Extra permissions on top of reports.view (and reports.export for exports). */
  requires?: Permission[];
  paginated: boolean;
  run: (ctx: ReportCtx) => Promise<ReportResult>;
}

const dt = (d: Date | null | undefined) => (d ? `${dhakaDate(d)} ${new Date(d.getTime() + 6 * 3600_000).toISOString().slice(11, 16)}` : null);
const day = (d: Date | null | undefined) => (d ? dhakaDate(d) : null);
const skip = (c: ReportCtx) => (c.page - 1) * c.pageSize;
const statusIn = (c: ReportCtx) => (c.f.status?.length ? { status: { in: c.f.status as never } } : {});
const range = (c: ReportCtx) => ({ gte: c.r.gte, lt: c.r.lt });
const DELIVERED = [...DELIVERED_STATES] as string[];
const RETURNED = [...RETURNED_STATES] as string[];

// ───────────── orders ─────────────

async function ordersReport(c: ReportCtx): Promise<ReportResult> {
  const where: Prisma.OrderWhereInput = { ...orderWhere(c.f), ...statusIn(c), createdAt: range(c) };
  const [orders, total, agg, byStatus] = await Promise.all([
    prisma.order.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: skip(c),
      take: c.pageSize,
      select: {
        orderNumber: true, createdAt: true, status: true, paymentStatus: true, paymentMethod: true, channel: true, districtName: true,
        total: true, paidAmount: true, codAmount: true, productCostTotal: true, deliveredAt: true,
        customer: { select: { name: true, phone: true } },
        items: { select: { quantity: true } },
        shipments: { where: { isReturn: false }, orderBy: { createdAt: "desc" }, take: 1, select: { provider: { select: { name: true } } } },
      },
    }),
    prisma.order.count({ where }),
    prisma.order.aggregate({ where, _sum: { total: true, paidAmount: true, codAmount: true, productCostTotal: true } }),
    prisma.order.groupBy({ by: ["status"], where, _count: { _all: true } }),
  ]);
  const nonCancelled = await prisma.order.aggregate({ where: { AND: [where, { status: { not: "CANCELLED" } }] }, _sum: { total: true }, _count: { _all: true } });
  return {
    columns: [
      { key: "orderNumber", label: "Order" }, { key: "placedAt", label: "Placed (Dhaka)" }, { key: "status", label: "Status" },
      { key: "paymentStatus", label: "Payment status" }, { key: "paymentMethod", label: "Payment method" }, { key: "channel", label: "Channel" },
      { key: "customer", label: "Customer" }, { key: "phone", label: "Phone" }, { key: "district", label: "District" },
      { key: "units", label: "Units" }, { key: "courier", label: "Courier" }, { key: "deliveredAt", label: "Delivered (Dhaka)" },
      { key: "total", label: "Order total", money: true }, { key: "paid", label: "Paid", money: true }, { key: "cod", label: "COD", money: true },
      { key: "productCost", label: "Product cost", money: true },
    ],
    rows: orders.map((o) => ({
      orderNumber: o.orderNumber, placedAt: dt(o.createdAt), status: o.status, paymentStatus: o.paymentStatus, paymentMethod: o.paymentMethod,
      channel: o.channel, customer: o.customer.name, phone: o.customer.phone, district: o.districtName, units: o.items.reduce((n, i) => n + i.quantity, 0),
      courier: o.shipments[0]?.provider.name ?? null, deliveredAt: dt(o.deliveredAt),
      total: fixed(o.total), paid: fixed(o.paidAmount), cod: fixed(o.codAmount), productCost: fixed(o.productCostTotal),
    })),
    total,
    totals: {
      orders: total,
      nonCancelledOrders: nonCancelled._count._all,
      byStatus: Object.fromEntries(byStatus.map((s) => [s.status, s._count._all])),
      orderValue: fixed(agg._sum.total),
      grossSales: fixed(nonCancelled._sum.total),
      paid: fixed(agg._sum.paidAmount),
      cod: fixed(agg._sum.codAmount),
      productCost: fixed(agg._sum.productCostTotal),
    },
    moneyTotals: ["orderValue", "grossSales", "paid", "cod", "productCost"],
    notes: ["Orders placed (created) in the date range, any status. Gross sales excludes cancelled orders; it is not recognised revenue."],
  };
}

// ───────────── delivered sales ─────────────

async function deliveredSalesReport(c: ReportCtx): Promise<ReportResult> {
  const where: Prisma.OrderWhereInput = { ...orderWhere(c.f), ...statusIn(c), deliveredAt: range(c) };
  const [orders, total, agg] = await Promise.all([
    prisma.order.findMany({
      where,
      orderBy: [{ deliveredAt: "desc" }, { id: "desc" }],
      skip: skip(c),
      take: c.pageSize,
      select: {
        orderNumber: true, createdAt: true, deliveredAt: true, status: true, channel: true, paymentMethod: true,
        subtotal: true, discountTotal: true, deliveryCharge: true, productCostTotal: true, packagingCost: true, refundedAmount: true,
        customer: { select: { name: true } },
      },
    }),
    prisma.order.count({ where }),
    prisma.order.aggregate({ where, _sum: { subtotal: true, discountTotal: true, deliveryCharge: true, productCostTotal: true, packagingCost: true, refundedAmount: true } }),
  ]);
  const productRevenue = money(agg._sum.subtotal).minus(money(agg._sum.discountTotal));
  return {
    columns: [
      { key: "orderNumber", label: "Order" }, { key: "deliveredAt", label: "Delivered (Dhaka)" }, { key: "placedAt", label: "Placed (Dhaka)" },
      { key: "currentStatus", label: "Current status" }, { key: "channel", label: "Channel" }, { key: "paymentMethod", label: "Payment method" },
      { key: "customer", label: "Customer" },
      { key: "productRevenue", label: "Product revenue", money: true }, { key: "shippingRevenue", label: "Shipping revenue", money: true },
      { key: "productCost", label: "Product cost", money: true }, { key: "packagingCost", label: "Packaging", money: true },
      { key: "grossMargin", label: "Gross margin", money: true }, { key: "refunded", label: "Refunded", money: true },
    ],
    rows: orders.map((o) => {
      const rev = money(o.subtotal).minus(o.discountTotal);
      return {
        orderNumber: o.orderNumber, deliveredAt: dt(o.deliveredAt), placedAt: dt(o.createdAt), currentStatus: o.status, channel: o.channel,
        paymentMethod: o.paymentMethod, customer: o.customer.name,
        productRevenue: rev.toFixed(2), shippingRevenue: fixed(o.deliveryCharge), productCost: fixed(o.productCostTotal), packagingCost: fixed(o.packagingCost),
        grossMargin: rev.minus(o.productCostTotal).toFixed(2), refunded: fixed(o.refundedAmount),
      };
    }),
    total,
    totals: {
      deliveredOrders: total,
      productRevenue: productRevenue.toFixed(2),
      shippingRevenue: fixed(agg._sum.deliveryCharge),
      deliveredRevenue: productRevenue.plus(money(agg._sum.deliveryCharge)).toFixed(2),
      productCost: fixed(agg._sum.productCostTotal),
      packagingCost: fixed(agg._sum.packagingCost),
      grossMargin: productRevenue.minus(money(agg._sum.productCostTotal)).toFixed(2),
      refunded: fixed(agg._sum.refundedAmount),
    },
    moneyTotals: ["productRevenue", "shippingRevenue", "deliveredRevenue", "productCost", "packagingCost", "grossMargin", "refunded"],
    notes: ["Orders delivered in the date range (revenue is recognised on delivery). Later returns are reversed in the returns report / P&L, not here."],
  };
}

// ───────────── returns ─────────────

async function returnsReport(c: ReportCtx): Promise<ReportResult> {
  const where: Prisma.ReturnRequestWhereInput = {
    createdAt: range(c),
    ...(c.f.status?.length ? { status: { in: c.f.status as never } } : {}),
    ...(c.f.channel?.length || c.f.productId ? { order: orderWhere(c.f) } : {}),
  };
  const [returns, total, agg, byType, rto, units] = await Promise.all([
    prisma.returnRequest.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: skip(c),
      take: c.pageSize,
      include: { order: { select: { orderNumber: true } }, items: { select: { quantity: true } } },
    }),
    prisma.returnRequest.count({ where }),
    prisma.returnRequest.aggregate({ where, _sum: { refundAmount: true, returnShippingCost: true, additionalCollection: true } }),
    prisma.returnRequest.groupBy({ by: ["type", "status"], where, _count: { _all: true } }),
    prisma.returnRequest.count({ where: { ...where, isRto: true } }),
    prisma.returnItem.aggregate({ where: { return: where }, _sum: { quantity: true } }),
  ]);
  return {
    columns: [
      { key: "returnNumber", label: "Return" }, { key: "createdAt", label: "Opened (Dhaka)" }, { key: "orderNumber", label: "Order" },
      { key: "type", label: "Type" }, { key: "status", label: "Status" }, { key: "rto", label: "RTO" }, { key: "reason", label: "Reason" },
      { key: "units", label: "Units" }, { key: "completedAt", label: "Completed (Dhaka)" },
      { key: "refundAmount", label: "Refund", money: true }, { key: "returnShippingCost", label: "Return shipping", money: true },
      { key: "additionalCollection", label: "Additional collection", money: true },
    ],
    rows: returns.map((x) => ({
      returnNumber: x.returnNumber, createdAt: dt(x.createdAt), orderNumber: x.order.orderNumber, type: x.type, status: x.status,
      rto: x.isRto ? "Yes" : "No", reason: x.reason, units: x.items.reduce((n, i) => n + i.quantity, 0), completedAt: dt(x.completedAt),
      refundAmount: fixed(x.refundAmount), returnShippingCost: fixed(x.returnShippingCost), additionalCollection: fixed(x.additionalCollection),
    })),
    total,
    totals: {
      returns: total,
      rto,
      byTypeAndStatus: byType.map((b) => ({ type: b.type, status: b.status, count: b._count._all })),
      units: units._sum.quantity ?? 0,
      refundAmount: fixed(agg._sum.refundAmount),
      returnShippingCost: fixed(agg._sum.returnShippingCost),
      additionalCollection: fixed(agg._sum.additionalCollection),
    },
    moneyTotals: ["refundAmount", "returnShippingCost", "additionalCollection"],
    notes: ["Return and exchange requests opened in the date range, including RTO (undelivered parcels coming back)."],
  };
}

// ───────────── courier performance ─────────────

async function courierPerformanceReport(c: ReportCtx): Promise<ReportResult> {
  const rows = await prisma.$queryRaw<{
    courier: string; code: string; shipments: number; delivered: number; returned: number; inFlight: number; cancelled: number; failed: number;
    avgDeliveryDays: string | null; deliveryFees: string; codCharges: string; returnFees: string; codCollected: string;
  }[]>`
    SELECT p.name AS courier, p.code, COUNT(*)::int AS shipments,
      COUNT(*) FILTER (WHERE s.status::text IN ('DELIVERED','PARTIALLY_DELIVERED'))::int AS delivered,
      COUNT(*) FILTER (WHERE s.status::text IN ('RETURNED','RETURNING'))::int AS returned,
      COUNT(*) FILTER (WHERE s.status::text IN ('PENDING','BOOKED','PICKED_UP','IN_TRANSIT'))::int AS "inFlight",
      COUNT(*) FILTER (WHERE s.status::text = 'CANCELLED')::int AS cancelled,
      COUNT(*) FILTER (WHERE s.status::text = 'FAILED')::int AS failed,
      ROUND(AVG(EXTRACT(EPOCH FROM (s."deliveredAt" - COALESCE(s."bookedAt", s."createdAt"))) / 86400.0)
        FILTER (WHERE s."deliveredAt" IS NOT NULL)::numeric, 1)::text AS "avgDeliveryDays",
      COALESCE(SUM(s."deliveryFee"), 0)::text AS "deliveryFees",
      COALESCE(SUM(s."codCharge"), 0)::text AS "codCharges",
      COALESCE(SUM(s."returnFee") FILTER (WHERE s.status::text IN ('RETURNED','RETURNING')), 0)::text AS "returnFees",
      COALESCE(SUM(COALESCE(s."collectedAmount", s."codAmount")) FILTER (WHERE s.status::text IN ('DELIVERED','PARTIALLY_DELIVERED')), 0)::text AS "codCollected"
    FROM "Shipment" s JOIN "CourierProvider" p ON p.id = s."providerId" JOIN "Order" o ON o.id = s."orderId"
    WHERE s."isReturn" = false AND ${inRange(`s."createdAt"`, c.r)} ${orderSqlFilter(c.f)}
      ${c.f.providerId ? Prisma.sql`AND s."providerId" = ${c.f.providerId}` : Prisma.empty}
    GROUP BY p.id, p.name, p.code ORDER BY shipments DESC`;
  const t = (k: "shipments" | "delivered" | "returned" | "inFlight" | "cancelled" | "failed") => rows.reduce((n, x) => n + x[k], 0);
  const m = (k: "deliveryFees" | "codCharges" | "returnFees" | "codCollected") => sum(rows.map((x) => x[k])).toFixed(2);
  return {
    columns: [
      { key: "courier", label: "Courier" }, { key: "shipments", label: "Shipments" }, { key: "delivered", label: "Delivered" },
      { key: "returned", label: "Returned / RTO" }, { key: "inFlight", label: "In flight" }, { key: "cancelled", label: "Cancelled" },
      { key: "failed", label: "Failed bookings" }, { key: "successRatePct", label: "Success rate %" }, { key: "avgDeliveryDays", label: "Avg delivery days" },
      { key: "deliveryFees", label: "Delivery fees", money: true }, { key: "codCharges", label: "COD charges", money: true },
      { key: "returnFees", label: "Return fees", money: true }, { key: "codCollected", label: "COD collected", money: true },
      { key: "costPerDelivered", label: "Cost per delivered", money: true },
    ],
    rows: rows.map((x) => {
      const fees = sum([x.deliveryFees, x.codCharges, x.returnFees]);
      return {
        courier: x.courier, shipments: x.shipments, delivered: x.delivered, returned: x.returned, inFlight: x.inFlight, cancelled: x.cancelled,
        failed: x.failed, successRatePct: pct(x.delivered, x.delivered + x.returned), avgDeliveryDays: x.avgDeliveryDays,
        deliveryFees: fixed(x.deliveryFees), codCharges: fixed(x.codCharges), returnFees: fixed(x.returnFees), codCollected: fixed(x.codCollected),
        costPerDelivered: x.delivered ? fees.dividedBy(x.delivered).toFixed(2) : null,
      };
    }),
    totals: {
      shipments: t("shipments"), delivered: t("delivered"), returned: t("returned"), inFlight: t("inFlight"), cancelled: t("cancelled"), failed: t("failed"),
      successRatePct: pct(t("delivered"), t("delivered") + t("returned")),
      deliveryFees: m("deliveryFees"), codCharges: m("codCharges"), returnFees: m("returnFees"), codCollected: m("codCollected"),
    },
    moneyTotals: ["deliveryFees", "codCharges", "returnFees", "codCollected"],
    notes: ["Outbound shipments booked (created) in the date range. Success rate = delivered ÷ (delivered + returned/RTO); in-flight parcels are excluded."],
  };
}

// ───────────── COD settlement ─────────────

async function codSettlementReport(c: ReportCtx): Promise<ReportResult> {
  const where: Prisma.CourierSettlementWhereInput = { createdAt: range(c), ...(c.f.providerId ? { providerId: c.f.providerId } : {}) };
  const [settlements, total, agg, outstanding] = await Promise.all([
    prisma.courierSettlement.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: skip(c),
      take: c.pageSize,
      include: { provider: { select: { name: true } }, account: { select: { name: true } }, _count: { select: { items: true } } },
    }),
    prisma.courierSettlement.count({ where }),
    prisma.courierSettlement.aggregate({ where, _sum: { totalCollected: true, totalFees: true, netPayable: true, receivedAmount: true } }),
    prisma.$queryRaw<{ courier: string; shipments: number; collected: string; fees: string }[]>`
      SELECT p.name AS courier, COUNT(*)::int AS shipments,
        COALESCE(SUM(COALESCE(s."collectedAmount", s."codAmount")) FILTER (WHERE s.status::text <> 'RETURNED'), 0)::text AS collected,
        COALESCE(SUM(COALESCE(s."deliveryFee", 0) + COALESCE(s."codCharge", 0) + CASE WHEN s.status::text = 'RETURNED' THEN COALESCE(s."returnFee", 0) ELSE 0 END), 0)::text AS fees
      FROM "Shipment" s JOIN "CourierProvider" p ON p.id = s."providerId"
      LEFT JOIN "CourierSettlementItem" si ON si."shipmentId" = s.id
      WHERE s."isReturn" = false AND si.id IS NULL AND s.status::text IN ('DELIVERED','PARTIALLY_DELIVERED','RETURNED')
        ${c.f.providerId ? Prisma.sql`AND s."providerId" = ${c.f.providerId}` : Prisma.empty}
      GROUP BY p.name ORDER BY p.name`,
  ]);
  const outCollected = sum(outstanding.map((o) => o.collected));
  const outFees = sum(outstanding.map((o) => o.fees));
  return {
    columns: [
      { key: "reference", label: "Reference" }, { key: "courier", label: "Courier" }, { key: "status", label: "Status" },
      { key: "createdAt", label: "Recorded (Dhaka)" }, { key: "periodStart", label: "Period start" }, { key: "periodEnd", label: "Period end" },
      { key: "shipments", label: "Shipments" }, { key: "account", label: "Account" }, { key: "receivedAt", label: "Received (Dhaka)" },
      { key: "totalCollected", label: "COD collected", money: true }, { key: "totalFees", label: "Courier fees", money: true },
      { key: "netPayable", label: "Net payable", money: true }, { key: "receivedAmount", label: "Received", money: true },
    ],
    rows: settlements.map((s) => ({
      reference: s.reference, courier: s.provider.name, status: s.status, createdAt: dt(s.createdAt), periodStart: day(s.periodStart), periodEnd: day(s.periodEnd),
      shipments: s._count.items, account: s.account?.name ?? null, receivedAt: dt(s.receivedAt),
      totalCollected: fixed(s.totalCollected), totalFees: fixed(s.totalFees), netPayable: fixed(s.netPayable), receivedAmount: fixed(s.receivedAmount),
    })),
    total,
    totals: {
      settlements: total,
      totalCollected: fixed(agg._sum.totalCollected),
      totalFees: fixed(agg._sum.totalFees),
      netPayable: fixed(agg._sum.netPayable),
      receivedAmount: fixed(agg._sum.receivedAmount),
      outstanding: {
        asOf: dhakaDate(),
        unsettledShipments: outstanding.reduce((n, o) => n + o.shipments, 0),
        codCollected: outCollected.toFixed(2),
        knownFees: outFees.toFixed(2),
        expectedPayout: outCollected.minus(outFees).toFixed(2),
        byCourier: outstanding.map((o) => ({ courier: o.courier, shipments: o.shipments, codCollected: fixed(o.collected), knownFees: fixed(o.fees), expectedPayout: money(o.collected).minus(money(o.fees)).toFixed(2) })),
      },
    },
    moneyTotals: ["totalCollected", "totalFees", "netPayable", "receivedAmount", "outstanding"],
    notes: ["Courier settlements recorded in the date range. `outstanding` is the current balance of delivered/returned parcels not yet in any settlement (not date-filtered)."],
  };
}

// ───────────── customers ─────────────

async function customersReport(c: ReportCtx): Promise<ReportResult> {
  const where = Prisma.sql`${inRange(`o."createdAt"`, c.r)} ${orderSqlFilter(c.f)}`;
  const [rows, totals] = await Promise.all([
    prisma.$queryRaw<{
      name: string; phone: string; firstOrderAt: Date | null; orders: number; delivered: number; cancelled: number; returned: number;
      placedValue: string; deliveredValue: string; lifetimeValue: string; isNew: boolean;
    }[]>`
      SELECT c.name, c.phone, c."firstOrderAt", COUNT(*)::int AS orders,
        COUNT(*) FILTER (WHERE o.status::text = ANY(${DELIVERED}))::int AS delivered,
        COUNT(*) FILTER (WHERE o.status::text = 'CANCELLED')::int AS cancelled,
        COUNT(*) FILTER (WHERE o.status::text = ANY(${RETURNED}))::int AS returned,
        COALESCE(SUM(o.total) FILTER (WHERE o.status::text <> 'CANCELLED'), 0)::text AS "placedValue",
        COALESCE(SUM(o.total) FILTER (WHERE o.status::text = ANY(${DELIVERED})), 0)::text AS "deliveredValue",
        c."lifetimeValue"::text AS "lifetimeValue",
        (c."firstOrderAt" IS NOT NULL AND ${inRange(`c."firstOrderAt"`, c.r)}) AS "isNew"
      FROM "Order" o JOIN "Customer" c ON c.id = o."customerId"
      WHERE ${where}
      GROUP BY c.id
      ORDER BY COUNT(*) DESC, SUM(o.total) FILTER (WHERE o.status::text = ANY(${DELIVERED})) DESC NULLS LAST, c.id
      LIMIT ${c.pageSize} OFFSET ${skip(c)}`,
    prisma.$queryRaw<{ customers: number; newCustomers: number; orders: number; placedValue: string; deliveredValue: string }[]>`
      SELECT COUNT(DISTINCT o."customerId")::int AS customers,
        COUNT(DISTINCT o."customerId") FILTER (WHERE ${inRange(`c."firstOrderAt"`, c.r)})::int AS "newCustomers",
        COUNT(*)::int AS orders,
        COALESCE(SUM(o.total) FILTER (WHERE o.status::text <> 'CANCELLED'), 0)::text AS "placedValue",
        COALESCE(SUM(o.total) FILTER (WHERE o.status::text = ANY(${DELIVERED})), 0)::text AS "deliveredValue"
      FROM "Order" o JOIN "Customer" c ON c.id = o."customerId"
      WHERE ${where}`,
  ]);
  const t = totals[0];
  return {
    columns: [
      { key: "name", label: "Customer" }, { key: "phone", label: "Phone" }, { key: "newCustomer", label: "New in range" },
      { key: "firstOrderAt", label: "First order" }, { key: "orders", label: "Orders" }, { key: "delivered", label: "Delivered" },
      { key: "cancelled", label: "Cancelled" }, { key: "returned", label: "Returned" },
      { key: "placedValue", label: "Placed value", money: true }, { key: "deliveredValue", label: "Delivered value", money: true },
      { key: "lifetimeValue", label: "Lifetime value", money: true },
    ],
    rows: rows.map((x) => ({
      name: x.name, phone: x.phone, newCustomer: x.isNew ? "Yes" : "No", firstOrderAt: day(x.firstOrderAt), orders: x.orders, delivered: x.delivered,
      cancelled: x.cancelled, returned: x.returned, placedValue: fixed(x.placedValue), deliveredValue: fixed(x.deliveredValue), lifetimeValue: fixed(x.lifetimeValue),
    })),
    total: t.customers,
    totals: { customers: t.customers, newCustomers: t.newCustomers, orders: t.orders, placedValue: fixed(t.placedValue), deliveredValue: fixed(t.deliveredValue) },
    moneyTotals: ["placedValue", "deliveredValue"],
    notes: ["Customers who placed orders in the date range; counts are for those orders by current status. New = first ever order placed in the range."],
  };
}

// ───────────── product sales ─────────────

async function productSalesReport(c: ReportCtx): Promise<ReportResult> {
  const placed = inRange(`o."createdAt"`, c.r);
  const delivered = inRange(`o."deliveredAt"`, c.r);
  const rows = await prisma.$queryRaw<{
    productId: string | null; product: string; sku: string | null; unitsOrdered: number; orderedValue: string; unitsDelivered: number;
    deliveredRevenue: string; deliveredCost: string;
  }[]>`
    SELECT oi."productId", MAX(oi."productName") AS product, MAX(p.sku) AS sku,
      COALESCE(SUM(oi.quantity) FILTER (WHERE ${placed} AND o.status::text <> 'CANCELLED'), 0)::int AS "unitsOrdered",
      COALESCE(SUM(oi."lineTotal") FILTER (WHERE ${placed} AND o.status::text <> 'CANCELLED'), 0)::text AS "orderedValue",
      COALESCE(SUM(oi.quantity) FILTER (WHERE ${delivered}), 0)::int AS "unitsDelivered",
      COALESCE(SUM(oi."lineTotal") FILTER (WHERE ${delivered}), 0)::text AS "deliveredRevenue",
      COALESCE(SUM(oi."costTotal") FILTER (WHERE ${delivered}), 0)::text AS "deliveredCost"
    FROM "OrderItem" oi JOIN "Order" o ON o.id = oi."orderId" LEFT JOIN "Product" p ON p.id = oi."productId"
    WHERE ((${placed}) OR (${delivered})) ${orderSqlFilter(c.f)} ${c.f.productId ? Prisma.sql`AND oi."productId" = ${c.f.productId}` : Prisma.empty}
    GROUP BY oi."productId", CASE WHEN oi."productId" IS NULL THEN oi.sku END
    ORDER BY "unitsOrdered" DESC, "unitsDelivered" DESC, product ASC`;
  const all = rows.map((x) => {
    const profit = money(x.deliveredRevenue).minus(money(x.deliveredCost));
    return {
      product: x.product, sku: x.sku, unitsOrdered: x.unitsOrdered, unitsDelivered: x.unitsDelivered,
      orderedValue: fixed(x.orderedValue), deliveredRevenue: fixed(x.deliveredRevenue), deliveredCost: fixed(x.deliveredCost), deliveredProfit: profit.toFixed(2),
      marginPct: money(x.deliveredRevenue).greaterThan(0) ? profit.dividedBy(money(x.deliveredRevenue)).times(100).toFixed(1) : null,
    };
  });
  return {
    columns: [
      { key: "product", label: "Product" }, { key: "sku", label: "SKU" }, { key: "unitsOrdered", label: "Units ordered" },
      { key: "unitsDelivered", label: "Units delivered" }, { key: "orderedValue", label: "Ordered value", money: true },
      { key: "deliveredRevenue", label: "Delivered revenue", money: true }, { key: "deliveredCost", label: "Delivered cost", money: true },
      { key: "deliveredProfit", label: "Delivered profit", money: true }, { key: "marginPct", label: "Margin %", money: true },
    ],
    rows: all.slice(skip(c), skip(c) + c.pageSize),
    total: all.length,
    totals: {
      products: all.length,
      unitsOrdered: all.reduce((n, x) => n + x.unitsOrdered, 0),
      unitsDelivered: all.reduce((n, x) => n + x.unitsDelivered, 0),
      orderedValue: sum(all.map((x) => x.orderedValue)).toFixed(2),
      deliveredRevenue: sum(all.map((x) => x.deliveredRevenue)).toFixed(2),
      deliveredCost: sum(all.map((x) => x.deliveredCost)).toFixed(2),
      deliveredProfit: sum(all.map((x) => x.deliveredProfit)).toFixed(2),
    },
    moneyTotals: ["orderedValue", "deliveredRevenue", "deliveredCost", "deliveredProfit"],
    notes: ["Ordered = non-cancelled orders placed in the range. Delivered = orders delivered in the range (line totals after line discounts, cost snapshots at order time)."],
  };
}

// ───────────── inventory ─────────────

async function inventoryReport(c: ReportCtx): Promise<ReportResult> {
  const productFilter = c.f.productId ? Prisma.sql`AND p.id = ${c.f.productId}` : Prisma.empty;
  const movements = Prisma.sql`
    SELECT "variantId",
      SUM(quantity) FILTER (WHERE type::text = 'RECEIVE') AS received,
      SUM(quantity) FILTER (WHERE type::text = 'FULFILL') AS fulfilled,
      SUM(quantity) FILTER (WHERE type::text = 'RESTOCK') AS restocked,
      SUM(quantity) FILTER (WHERE type::text IN ('DAMAGE','DISPOSE')) AS damaged,
      SUM("availableDelta") FILTER (WHERE type::text = 'ADJUST') AS adjusted
    FROM "InventoryMovement" WHERE ${inRange(`"createdAt"`, c.r)} GROUP BY "variantId"`;
  const [rows, totals] = await Promise.all([
    prisma.$queryRaw<{
      sku: string; product: string; variant: string; active: boolean; available: number; reserved: number; damaged: number; returned: number;
      lowStockThreshold: number; unitCost: string; stockValue: string; received: number; fulfilled: number; restocked: number; damagedInRange: number; adjusted: number;
    }[]>`
      SELECT v.sku, p.name AS product, v.name AS variant, (v."isActive" AND p.status::text = 'ACTIVE') AS active,
        COALESCE(il.available, 0)::int AS available, COALESCE(il.reserved, 0)::int AS reserved, COALESCE(il.damaged, 0)::int AS damaged,
        COALESCE(il.returned, 0)::int AS returned, v."lowStockThreshold",
        COALESCE(v."costPrice", p."costPrice")::text AS "unitCost",
        (COALESCE(il.available, 0) * COALESCE(v."costPrice", p."costPrice"))::text AS "stockValue",
        COALESCE(m.received, 0)::int AS received, COALESCE(m.fulfilled, 0)::int AS fulfilled, COALESCE(m.restocked, 0)::int AS restocked,
        COALESCE(m.damaged, 0)::int AS "damagedInRange", COALESCE(m.adjusted, 0)::int AS adjusted
      FROM "ProductVariant" v JOIN "Product" p ON p.id = v."productId"
      LEFT JOIN "InventoryLevel" il ON il."variantId" = v.id
      LEFT JOIN (${movements}) m ON m."variantId" = v.id
      WHERE p."archivedAt" IS NULL ${productFilter}
      ORDER BY p.name, v.sku
      LIMIT ${c.pageSize} OFFSET ${skip(c)}`,
    prisma.$queryRaw<{ variants: number; available: number; reserved: number; damaged: number; lowStock: number; outOfStock: number; stockValue: string }[]>`
      SELECT COUNT(*)::int AS variants, COALESCE(SUM(il.available), 0)::int AS available, COALESCE(SUM(il.reserved), 0)::int AS reserved,
        COALESCE(SUM(il.damaged), 0)::int AS damaged,
        COUNT(*) FILTER (WHERE v."isActive" AND COALESCE(il.available, 0) > 0 AND COALESCE(il.available, 0) <= v."lowStockThreshold")::int AS "lowStock",
        COUNT(*) FILTER (WHERE v."isActive" AND COALESCE(il.available, 0) <= 0)::int AS "outOfStock",
        COALESCE(SUM(COALESCE(il.available, 0) * COALESCE(v."costPrice", p."costPrice")), 0)::text AS "stockValue"
      FROM "ProductVariant" v JOIN "Product" p ON p.id = v."productId" LEFT JOIN "InventoryLevel" il ON il."variantId" = v.id
      WHERE p."archivedAt" IS NULL ${productFilter}`,
  ]);
  const t = totals[0];
  return {
    columns: [
      { key: "sku", label: "SKU" }, { key: "product", label: "Product" }, { key: "variant", label: "Variant" }, { key: "active", label: "Active" },
      { key: "available", label: "Available" }, { key: "reserved", label: "Reserved" }, { key: "damaged", label: "Damaged" },
      { key: "returned", label: "Returned (awaiting inspection)" }, { key: "lowStock", label: "Low stock" },
      { key: "received", label: "Received in range" }, { key: "fulfilled", label: "Fulfilled in range" }, { key: "restocked", label: "Restocked in range" },
      { key: "damagedInRange", label: "Damaged/disposed in range" }, { key: "adjusted", label: "Net adjustments in range" },
      { key: "unitCost", label: "Unit cost", money: true }, { key: "stockValue", label: "Stock value (cost)", money: true },
    ],
    rows: rows.map((x) => ({
      sku: x.sku, product: x.product, variant: x.variant, active: x.active ? "Yes" : "No", available: x.available, reserved: x.reserved, damaged: x.damaged,
      returned: x.returned, lowStock: x.available <= x.lowStockThreshold ? "Yes" : "No", received: x.received, fulfilled: x.fulfilled, restocked: x.restocked,
      damagedInRange: x.damagedInRange, adjusted: x.adjusted, unitCost: fixed(x.unitCost), stockValue: fixed(x.stockValue),
    })),
    total: t.variants,
    totals: { variants: t.variants, available: t.available, reserved: t.reserved, damaged: t.damaged, lowStock: t.lowStock, outOfStock: t.outOfStock, stockValue: fixed(t.stockValue) },
    moneyTotals: ["stockValue"],
    notes: ["Stock levels are current (as of now); movement columns cover the date range. Stock value = available × current unit cost."],
  };
}

// ───────────── purchases ─────────────

async function purchasesReport(c: ReportCtx): Promise<ReportResult> {
  const where: Prisma.PurchaseOrderWhereInput = { createdAt: range(c), ...(c.f.status?.length ? { status: { in: c.f.status as never } } : {}) };
  const [pos, total, agg, byStatus] = await Promise.all([
    prisma.purchaseOrder.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: skip(c),
      take: c.pageSize,
      include: { supplier: { select: { name: true } }, _count: { select: { items: true } } },
    }),
    prisma.purchaseOrder.count({ where }),
    prisma.purchaseOrder.aggregate({ where: { ...where, status: c.f.status?.length ? { in: c.f.status as never } : { not: "CANCELLED" } }, _sum: { subtotal: true, shippingCost: true, otherCost: true, total: true, paidAmount: true } }),
    prisma.purchaseOrder.groupBy({ by: ["status"], where, _count: { _all: true } }),
  ]);
  return {
    columns: [
      { key: "number", label: "PO" }, { key: "supplier", label: "Supplier" }, { key: "status", label: "Status" }, { key: "createdAt", label: "Created (Dhaka)" },
      { key: "orderedAt", label: "Ordered" }, { key: "receivedAt", label: "Received" }, { key: "lines", label: "Lines" },
      { key: "subtotal", label: "Subtotal", money: true }, { key: "shippingCost", label: "Shipping", money: true }, { key: "otherCost", label: "Other", money: true },
      { key: "total", label: "Total", money: true }, { key: "paid", label: "Paid", money: true }, { key: "due", label: "Due", money: true },
    ],
    rows: pos.map((p) => ({
      number: p.number, supplier: p.supplier.name, status: p.status, createdAt: dt(p.createdAt), orderedAt: day(p.orderedAt), receivedAt: day(p.receivedAt),
      lines: p._count.items, subtotal: fixed(p.subtotal), shippingCost: fixed(p.shippingCost), otherCost: fixed(p.otherCost), total: fixed(p.total),
      paid: fixed(p.paidAmount), due: money(p.total).minus(p.paidAmount).toFixed(2),
    })),
    total,
    totals: {
      purchaseOrders: total,
      byStatus: Object.fromEntries(byStatus.map((s) => [s.status, s._count._all])),
      subtotal: fixed(agg._sum.subtotal), shippingCost: fixed(agg._sum.shippingCost), otherCost: fixed(agg._sum.otherCost),
      total: fixed(agg._sum.total), paid: fixed(agg._sum.paidAmount), due: money(agg._sum.total).minus(money(agg._sum.paidAmount)).toFixed(2),
    },
    moneyTotals: ["subtotal", "shippingCost", "otherCost", "total", "paid", "due"],
    notes: ["Purchase orders created in the date range. Money totals exclude cancelled POs unless filtered by status."],
  };
}

// ───────────── expenses ─────────────

async function expensesReport(c: ReportCtx): Promise<ReportResult> {
  const where: Prisma.ExpenseWhereInput = { deletedAt: null, date: { gte: dateOnly(c.r.from), lte: dateOnly(c.r.to) } };
  const [expenses, total, agg, byCategory] = await Promise.all([
    prisma.expense.findMany({
      where,
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      skip: skip(c),
      take: c.pageSize,
      include: { category: { select: { name: true, type: true } }, account: { select: { name: true } }, supplier: { select: { name: true } } },
    }),
    prisma.expense.count({ where }),
    prisma.expense.aggregate({ where, _sum: { amount: true } }),
    prisma.$queryRaw<{ category: string; type: string; count: number; total: string }[]>`
      SELECT ec.name AS category, ec.type::text AS type, COUNT(*)::int AS count, SUM(e.amount)::text AS total
      FROM "Expense" e JOIN "ExpenseCategory" ec ON ec.id = e."categoryId"
      WHERE e."deletedAt" IS NULL AND e.date >= ${c.r.from}::date AND e.date <= ${c.r.to}::date
      GROUP BY ec.name, ec.type ORDER BY SUM(e.amount) DESC`,
  ]);
  return {
    columns: [
      { key: "date", label: "Date" }, { key: "category", label: "Category" }, { key: "type", label: "Type" }, { key: "description", label: "Description" },
      { key: "supplier", label: "Supplier" }, { key: "account", label: "Paid from" }, { key: "reference", label: "Reference" },
      { key: "amount", label: "Amount", money: true },
    ],
    rows: expenses.map((e) => ({
      date: e.date.toISOString().slice(0, 10), category: e.category.name, type: e.category.type, description: e.description,
      supplier: e.supplier?.name ?? null, account: e.account?.name ?? null, reference: e.reference, amount: fixed(e.amount),
    })),
    total,
    totals: { expenses: total, amount: fixed(agg._sum.amount), byCategory: byCategory.map((b) => ({ ...b, total: fixed(b.total) })) },
    moneyTotals: ["amount", "byCategory"],
    notes: ["Recorded expenses dated in the range (not deleted). Advertising-category expenses are the advertising cost used in P&L."],
  };
}

// ───────────── profit & loss ─────────────

async function profitAndLossReport(c: ReportCtx): Promise<ReportResult> {
  const p = await profitAndLoss(c.r.from, c.r.to);
  const line = (section: string, label: string, amount: string) => ({ section, line: label, amount });
  return {
    columns: [{ key: "section", label: "Section" }, { key: "line", label: "Line" }, { key: "amount", label: "Amount (BDT)", money: true }],
    rows: [
      line("Revenue", "Product sales", p.revenue.productSales),
      line("Revenue", "Shipping charges", p.revenue.shippingCharges),
      line("Revenue", "Returns reversed", p.revenue.returnsAndRefunds),
      line("Revenue", "Total revenue", p.revenue.total),
      line("Cost of goods", "Cost of goods sold", p.costOfGoods.cogs),
      line("Cost of goods", "Restock recovery", p.costOfGoods.restockRecovery),
      line("Gross profit", "Gross profit", p.grossProfit),
      line("Operating costs", "Courier delivery fees", p.operatingCosts.courierDelivery),
      line("Operating costs", "Courier COD charges", p.operatingCosts.courierCod),
      line("Operating costs", "Return shipping", p.operatingCosts.returnShipping),
      line("Operating costs", "Packaging", p.operatingCosts.packaging),
      line("Operating costs", "Advertising", p.operatingCosts.advertising),
      line("Operating costs", "Other expenses", p.operatingCosts.otherExpenses),
      line("Operating costs", "Adjustments", p.operatingCosts.adjustments),
      line("Net profit", "Net profit (estimated)", p.netProfit),
    ],
    totals: {
      revenue: p.revenue.total, grossProfit: p.grossProfit, grossMarginPct: p.grossMarginPct, netProfit: p.netProfit, netMarginPct: p.netMarginPct,
      cash: p.cash, expensesByCategory: p.expensesByCategory,
    },
    moneyTotals: ["revenue", "grossProfit", "grossMarginPct", "netProfit", "netMarginPct", "cash", "expensesByCategory"],
    notes: p.notes,
  };
}

// ───────────── marketing ─────────────

async function marketingReport(c: ReportCtx): Promise<ReportResult> {
  const [groups, spend] = await Promise.all([
    prisma.$queryRaw<{
      source: string; campaign: string; campaignIds: string[]; orders: number; delivered: number; returned: number; cancelled: number; deliveredRevenue: string;
    }[]>`
      SELECT COALESCE(NULLIF(ma."lastSource", ''), '(direct / unknown)') AS source,
        COALESCE(NULLIF(ma."lastCampaign", ''), '(none)') AS campaign,
        ARRAY_REMOVE(ARRAY_AGG(DISTINCT NULLIF(ma."campaignId", '')), NULL) AS "campaignIds",
        COUNT(*)::int AS orders,
        COUNT(*) FILTER (WHERE o.status::text = ANY(${DELIVERED}))::int AS delivered,
        COUNT(*) FILTER (WHERE o.status::text = ANY(${RETURNED}))::int AS returned,
        COUNT(*) FILTER (WHERE o.status::text = 'CANCELLED')::int AS cancelled,
        COALESCE(SUM(o.subtotal - o."discountTotal" + o."deliveryCharge") FILTER (WHERE o.status::text = ANY(${DELIVERED})), 0)::text AS "deliveredRevenue"
      FROM "Order" o LEFT JOIN "MarketingAttribution" ma ON ma."orderId" = o.id
      WHERE ${inRange(`o."createdAt"`, c.r)} ${orderSqlFilter(c.f)}
      GROUP BY 1, 2
      ORDER BY orders DESC, source, campaign`,
    prisma.adSpendRecord.groupBy({
      by: ["platform", "campaignId", "campaignName"],
      where: { date: { gte: dateOnly(c.r.from), lte: dateOnly(c.r.to) } },
      _sum: { spend: true, clicks: true, impressions: true, reportedPurchases: true },
    }),
  ]);

  // Each ad-spend campaign is attributed to at most one row: by campaign id first, then by campaign name (or id) = utm_campaign.
  const spendByRow = new Map<number, Prisma.Decimal>();
  const platformsByRow = new Map<number, Set<string>>();
  const unmatched: typeof spend = [];
  const lc = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();
  for (const s of spend) {
    let idx = s.campaignId ? groups.findIndex((g) => g.campaignIds.includes(s.campaignId)) : -1;
    if (idx < 0) idx = groups.findIndex((g) => g.campaign !== "(none)" && ((s.campaignName && lc(g.campaign) === lc(s.campaignName)) || (s.campaignId && lc(g.campaign) === lc(s.campaignId))));
    if (idx < 0) {
      unmatched.push(s);
      continue;
    }
    spendByRow.set(idx, (spendByRow.get(idx) ?? ZERO).plus(money(s._sum.spend)));
    platformsByRow.set(idx, (platformsByRow.get(idx) ?? new Set()).add(s.platform));
  }

  const rows: Row[] = groups.map((g, i) => {
    const sp = spendByRow.get(i) ?? ZERO;
    const rev = money(g.deliveredRevenue);
    return {
      source: g.source, campaign: g.campaign, platforms: [...(platformsByRow.get(i) ?? [])].join(", ") || null,
      orders: g.orders, delivered: g.delivered, returned: g.returned, cancelled: g.cancelled,
      returnRatePct: pct(g.returned, g.delivered + g.returned),
      deliveredRevenue: rev.toFixed(2), adSpend: sp.toFixed(2),
      deliveredRoas: sp.greaterThan(0) ? rev.dividedBy(sp).toFixed(2) : null,
      costPerDeliveredOrder: sp.greaterThan(0) && g.delivered ? sp.dividedBy(g.delivered).toFixed(2) : null,
    };
  });
  for (const s of unmatched) {
    rows.push({
      source: "(unattributed ad spend)", campaign: s.campaignName || s.campaignId || "(unnamed)", platforms: s.platform,
      orders: 0, delivered: 0, returned: 0, cancelled: 0, returnRatePct: null, deliveredRevenue: "0.00", adSpend: fixed(s._sum.spend), deliveredRoas: null, costPerDeliveredOrder: null,
    });
  }
  const totalSpend = sum(spend.map((s) => s._sum.spend));
  const totalRev = sum(groups.map((g) => g.deliveredRevenue));
  const n = (k: "orders" | "delivered" | "returned" | "cancelled") => groups.reduce((a, g) => a + g[k], 0);
  return {
    columns: [
      { key: "source", label: "Source (last touch)" }, { key: "campaign", label: "Campaign (last touch)" }, { key: "platforms", label: "Ad platforms" },
      { key: "orders", label: "Orders placed" }, { key: "delivered", label: "Delivered" }, { key: "returned", label: "Returned / RTO" },
      { key: "cancelled", label: "Cancelled" }, { key: "returnRatePct", label: "Return rate %" },
      { key: "deliveredRevenue", label: "Delivered revenue", money: true }, { key: "adSpend", label: "Platform ad spend", money: true },
      { key: "deliveredRoas", label: "Delivered-order ROAS", money: true }, { key: "costPerDeliveredOrder", label: "Ad cost per delivered order", money: true },
    ],
    rows,
    totals: {
      orders: n("orders"), delivered: n("delivered"), returned: n("returned"), cancelled: n("cancelled"),
      returnRatePct: pct(n("returned"), n("delivered") + n("returned")),
      deliveredRevenue: totalRev.toFixed(2), adSpend: totalSpend.toFixed(2),
      unattributedSpend: sum(unmatched.map((s) => s._sum.spend)).toFixed(2),
      deliveredRoas: totalSpend.greaterThan(0) ? totalRev.dividedBy(totalSpend).toFixed(2) : null,
    },
    moneyTotals: ["deliveredRevenue", "adSpend", "unattributedSpend", "deliveredRoas"],
    notes: [
      "Orders placed in the date range grouped by last-touch UTM source / campaign; delivered / returned are their current outcome.",
      "Delivered revenue = product sales after discount + delivery charge of orders currently delivered (kept by the customer).",
      "Delivered-order ROAS = delivered revenue ÷ platform ad spend. It uses verified deliveries, not platform-reported purchases.",
      "Platform ad spend comes from imported ad-platform records (analytics only; P&L advertising uses advertising expenses). Spend is matched by campaign id, then by campaign name.",
    ],
  };
}

// ───────────── staff activity ─────────────

async function staffActivityReport(c: ReportCtx): Promise<ReportResult> {
  const [rows, actions] = await Promise.all([
    prisma.$queryRaw<{
      id: string; name: string; email: string; auditActions: number; statusChanges: number; confirmed: number; cancelled: number; shipped: number; delivered: number;
      ordersCreated: number; lastActivityAt: Date | null;
    }[]>`
      WITH a AS (
        SELECT "userId", COUNT(*) AS n, MAX("createdAt") AS last FROM "AuditLog"
        WHERE "userId" IS NOT NULL AND ${inRange(`"createdAt"`, c.r)} GROUP BY "userId"
      ), h AS (
        SELECT "userId", COUNT(*) AS n,
          COUNT(*) FILTER (WHERE "toStatus"::text = 'CONFIRMED') AS confirmed,
          COUNT(*) FILTER (WHERE "toStatus"::text = 'CANCELLED') AS cancelled,
          COUNT(*) FILTER (WHERE "toStatus"::text = 'SHIPPED') AS shipped,
          COUNT(*) FILTER (WHERE "toStatus"::text = 'DELIVERED') AS delivered,
          MAX("createdAt") AS last
        FROM "OrderStatusHistory" WHERE "userId" IS NOT NULL AND ${inRange(`"createdAt"`, c.r)} GROUP BY "userId"
      ), oc AS (
        SELECT "createdById" AS "userId", COUNT(*) AS n FROM "Order"
        WHERE "createdById" IS NOT NULL AND ${inRange(`"createdAt"`, c.r)} GROUP BY "createdById"
      )
      SELECT u.name, u.email, COALESCE(a.n, 0)::int AS "auditActions", COALESCE(h.n, 0)::int AS "statusChanges",
        COALESCE(h.confirmed, 0)::int AS confirmed, COALESCE(h.cancelled, 0)::int AS cancelled, COALESCE(h.shipped, 0)::int AS shipped,
        COALESCE(h.delivered, 0)::int AS delivered, COALESCE(oc.n, 0)::int AS "ordersCreated",
        GREATEST(a.last, h.last) AS "lastActivityAt", u.id
      FROM "User" u LEFT JOIN a ON a."userId" = u.id LEFT JOIN h ON h."userId" = u.id LEFT JOIN oc ON oc."userId" = u.id
      WHERE a."userId" IS NOT NULL OR h."userId" IS NOT NULL OR oc."userId" IS NOT NULL
      ORDER BY COALESCE(a.n, 0) + COALESCE(h.n, 0) DESC, u.name`,
    prisma.auditLog.groupBy({ by: ["userId", "action"], where: { userId: { not: null }, createdAt: range(c) }, _count: { _all: true } }),
  ]);
  const byUser = new Map<string, { action: string; n: number }[]>();
  for (const a of actions) byUser.set(a.userId!, [...(byUser.get(a.userId!) ?? []), { action: a.action, n: a._count._all }]);
  const out = rows.map((u) => ({
    name: u.name, email: u.email, auditActions: u.auditActions, statusChanges: u.statusChanges, ordersCreated: u.ordersCreated,
    confirmed: u.confirmed, cancelled: u.cancelled, shipped: u.shipped, delivered: u.delivered, lastActivityAt: dt(u.lastActivityAt),
    topActions: (byUser.get(u.id) ?? []).sort((a, b) => b.n - a.n).slice(0, 8).map((a) => `${a.action} ×${a.n}`).join("; "),
  }));
  const t = (k: "auditActions" | "statusChanges" | "ordersCreated" | "confirmed" | "cancelled") => out.reduce((n, x) => n + x[k], 0);
  return {
    columns: [
      { key: "name", label: "Staff" }, { key: "email", label: "Email" }, { key: "auditActions", label: "Audited actions" },
      { key: "statusChanges", label: "Order status changes" }, { key: "ordersCreated", label: "Orders created" }, { key: "confirmed", label: "Confirmed" },
      { key: "cancelled", label: "Cancelled" }, { key: "shipped", label: "Marked shipped" }, { key: "delivered", label: "Marked delivered" },
      { key: "lastActivityAt", label: "Last activity (Dhaka)" }, { key: "topActions", label: "Top actions" },
    ],
    rows: out,
    totals: { staff: out.length, auditActions: t("auditActions"), statusChanges: t("statusChanges"), ordersCreated: t("ordersCreated"), confirmed: t("confirmed"), cancelled: t("cancelled") },
    notes: ["Audit-log entries and order status changes made by each staff member in the date range (system/courier changes are excluded)."],
  };
}

// ───────────── registry ─────────────

export const REPORTS: Record<string, ReportDef> = {
  orders: { title: "Orders", description: "Orders placed in the range with status, payment and amounts.", paginated: true, run: ordersReport },
  "delivered-sales": { title: "Delivered sales", description: "Orders delivered in the range – recognised revenue, cost and margin.", paginated: true, run: deliveredSalesReport },
  returns: { title: "Returns & RTO", description: "Return, exchange and RTO requests opened in the range.", paginated: true, run: returnsReport },
  "courier-performance": { title: "Courier performance", description: "Delivery success, speed and cost per courier.", paginated: false, run: courierPerformanceReport },
  "cod-settlement": { title: "COD settlement", description: "Courier settlements recorded and COD still outstanding.", requires: ["finance.view"], paginated: true, run: codSettlementReport },
  customers: { title: "Customers", description: "Customers ordering in the range with outcomes and value.", paginated: true, run: customersReport },
  "product-sales": { title: "Product sales", description: "Units and revenue per product (ordered vs delivered).", paginated: true, run: productSalesReport },
  inventory: { title: "Inventory", description: "Current stock and stock value with movements in the range.", paginated: true, run: inventoryReport },
  purchases: { title: "Purchases", description: "Purchase orders created in the range.", paginated: true, run: purchasesReport },
  expenses: { title: "Expenses", description: "Expenses dated in the range by category.", requires: ["finance.view"], paginated: true, run: expensesReport },
  "profit-and-loss": { title: "Profit & loss", description: "Ledger-based P&L (revenue recognised on delivery).", requires: ["finance.view"], paginated: false, run: profitAndLossReport },
  marketing: { title: "Marketing attribution", description: "Orders, deliveries, returns and delivered-order ROAS per source / campaign.", paginated: false, run: marketingReport },
  "staff-activity": { title: "Staff activity", description: "Audit-log actions and order status changes per staff member.", requires: ["audit.view"], paginated: false, run: staffActivityReport },
};

export const REPORT_TYPES = Object.keys(REPORTS) as [string, ...string[]];

/** Runs a report with permission checks and strips money columns/totals for users without finance.view. */
export async function runReport(type: string, ctx: ReportCtx) {
  const def = REPORTS[type];
  if (!def) throw notFound("Report");
  for (const p of def.requires ?? []) if (!ctx.user.permissions.has(p)) throw forbidden(`This report requires the ${p} permission`);
  const result = await def.run(ctx);
  const finance = canSeeFinance(ctx.user);
  const columns = finance ? result.columns : result.columns.filter((c) => !c.money);
  const hidden = new Set(result.columns.filter((c) => c.money).map((c) => c.key));
  const rows = finance ? result.rows : result.rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !hidden.has(k))));
  const totals = Object.fromEntries(
    Object.entries(result.totals).filter(([k, v]) => v !== undefined && (finance || !(result.moneyTotals ?? []).includes(k))),
  );
  return {
    type,
    title: def.title,
    description: def.description,
    range: { from: ctx.r.from, to: ctx.r.to, timezone: TZ },
    financeVisible: finance,
    paginated: def.paginated,
    columns,
    rows,
    totals,
    total: result.total ?? rows.length,
    notes: result.notes ?? [],
  };
}
