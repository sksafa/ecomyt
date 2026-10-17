import { prisma, Prisma } from "../../lib/prisma.js";
import { money, sum, ZERO } from "../../lib/money.js";
import { dhakaDate, dhakaRange } from "../../lib/time.js";
import { profitAndLoss } from "../finance/reports.service.js";
import type { AuthUser } from "../../middleware/auth.js";
import {
  bucketKeys, bucketLabel, bucketSql, canSeeFinance, cost, DELIVERED_STATES, fixed, inRange, isFiltered, orderSqlFilter, orderWhere,
  pct, ratio, RETURNED_STATES, TZ, type Granularity, type OrderFilter, type ResolvedRange,
} from "./common.js";

const ORDER_STATUSES = [
  "PENDING", "CONFIRMATION_REQUIRED", "CONFIRMED", "PROCESSING", "READY_TO_SHIP", "COURIER_BOOKED", "SHIPPED", "DELIVERED",
  "CANCELLED", "RETURN_REQUESTED", "RETURN_IN_TRANSIT", "RETURNED", "EXCHANGE_REQUESTED", "EXCHANGED", "ON_HOLD",
] as const;

type LedgerTotals = Record<string, Prisma.Decimal>;

/** Ledger totals by entry type in the range; with an order filter only entries linked to matching orders count. */
async function ledgerByType(r: ResolvedRange, f: OrderFilter = {}): Promise<LedgerTotals> {
  const filtered = isFiltered(f);
  const rows = await prisma.$queryRaw<{ type: string; total: string }[]>`
    SELECT fe.type::text AS type, SUM(fe.amount)::text AS total
    FROM "FinancialEntry" fe
    ${filtered ? Prisma.sql`JOIN "Order" o ON o.id = fe."orderId"` : Prisma.empty}
    WHERE ${inRange(`fe."date"`, r)} ${filtered ? orderSqlFilter(f) : Prisma.empty}
    GROUP BY fe.type`;
  return Object.fromEntries(rows.map((x) => [x.type, money(x.total)]));
}
const L = (t: LedgerTotals, ...types: string[]) => sum(types.map((k) => t[k] ?? ZERO));

export const SUMMARY_DEFINITIONS: Record<string, string> = {
  scope: "Status counts are orders placed in the selected Dhaka date range, grouped by their current status.",
  totalOrders: "Orders placed (created) in the range, in any status including cancelled.",
  ordersToday: "Orders placed today (Asia/Dhaka), regardless of the selected range.",
  pending: "Orders placed in the range that are still Pending.",
  awaitingConfirmation: "Orders placed in the range currently waiting for a confirmation call (Needs confirmation).",
  confirmed: "Orders placed in the range currently in Confirmed status (not yet packed).",
  everConfirmed: "Orders placed in the range that were confirmed at some point (any later status, including cancelled after confirmation).",
  processing: "Orders placed in the range currently being packed (Processing or Ready to ship).",
  courierBooked: "Orders placed in the range with a courier booked but not yet picked up.",
  shipped: "Orders placed in the range currently in transit with the courier.",
  delivered: "Orders placed in the range whose current status is Delivered.",
  deliveredInRange: "Orders delivered during the range, regardless of when they were placed (this is what revenue is based on).",
  cancelled: "Orders placed in the range that are cancelled.",
  returned: "Orders placed in the range that came back or are coming back (Returned / RTO and Return in transit).",
  onHold: "Orders placed in the range currently on hold.",
  grossSales: "Total value (incl. delivery charge, after discount) of orders placed in the range, excluding cancelled. Not revenue yet.",
  deliveredSales: "Recognised revenue: product sales plus customer-paid delivery charges of orders delivered in the range (ledger).",
  collectedPayments: "Customer payments completed (verified) in the range: advances, online payments and recorded COD collections.",
  outstandingCod: "Cash on delivery collected by couriers for delivered parcels that no courier settlement has paid out yet (current balance, not date-filtered).",
  advertisingSpend: "Advertising-category expenses booked in the range (ledger). Imported ad-platform spend is analytics only and not included.",
  productCost: "Cost of goods of orders delivered in the range (ledger COGS).",
  courierExpenses: "Courier delivery fees, COD charges and return fees booked in the range.",
  returnCosts: "Return shipping fees plus revenue reversed for returns, minus cost recovered by restocking returned goods.",
  grossProfit: "Recognised revenue minus returns, minus cost of goods plus restock recovery (same as Profit & Loss).",
  estimatedNetProfit:
    "Gross profit minus courier, packaging, advertising and other expenses, plus adjustments (same as Profit & Loss). Estimated until courier settlements reconcile fees. Not available when a channel/product filter is applied.",
  filters: "Channel/product filters restrict counts and order-linked money (an order matches a product if it contains it). Advertising spend is always company-wide.",
};

export async function dashboardSummary(r: ResolvedRange, f: OrderFilter, user: AuthUser) {
  const base = orderWhere(f);
  const today = dhakaDate();
  const todayRange = dhakaRange(today, today);
  const placed: Prisma.OrderWhereInput = { ...base, createdAt: { gte: r.gte, lt: r.lt } };

  const [byStatus, ordersToday, everConfirmed, deliveredInRange] = await Promise.all([
    prisma.order.groupBy({ by: ["status"], where: placed, _count: { _all: true } }),
    prisma.order.count({ where: { ...base, createdAt: todayRange } }),
    prisma.order.count({ where: { ...placed, confirmedAt: { not: null } } }),
    prisma.order.count({ where: { ...base, deliveredAt: { gte: r.gte, lt: r.lt } } }),
  ]);
  const statusCounts: Record<string, number> = Object.fromEntries(ORDER_STATUSES.map((s) => [s, 0]));
  for (const g of byStatus) statusCounts[g.status] = g._count._all;
  const c = (...s: string[]) => s.reduce((n, k) => n + (statusCounts[k] ?? 0), 0);

  const counts = {
    totalOrders: Object.values(statusCounts).reduce((a, b) => a + b, 0),
    ordersToday,
    pending: c("PENDING"),
    awaitingConfirmation: c("CONFIRMATION_REQUIRED"),
    confirmed: c("CONFIRMED"),
    everConfirmed,
    processing: c("PROCESSING", "READY_TO_SHIP"),
    courierBooked: c("COURIER_BOOKED"),
    shipped: c("SHIPPED"),
    delivered: c("DELIVERED"),
    deliveredInRange,
    cancelled: c("CANCELLED"),
    returned: c(...RETURNED_STATES),
    onHold: c("ON_HOLD"),
  };

  const result: Record<string, unknown> = {
    range: { from: r.from, to: r.to, today, timezone: TZ },
    filters: { channel: f.channel ?? null, productId: f.productId ?? null },
    financeVisible: canSeeFinance(user),
    ...counts,
    statusCounts,
  };

  if (canSeeFinance(user)) {
    const filtered = isFiltered(f);
    const [gross, ledger, companyLedger, payments, cod, pnl] = await Promise.all([
      prisma.order.aggregate({ where: { ...placed, status: { not: "CANCELLED" } }, _sum: { total: true } }),
      ledgerByType(r, f),
      filtered ? ledgerByType(r) : Promise.resolve(null),
      prisma.payment.aggregate({
        where: {
          status: "COMPLETED",
          OR: [{ verifiedAt: { gte: r.gte, lt: r.lt } }, { verifiedAt: null, createdAt: { gte: r.gte, lt: r.lt } }],
          ...(filtered ? { order: base } : {}),
        },
        _sum: { amount: true },
      }),
      prisma.$queryRaw<{ total: string; n: number }[]>`
        SELECT COALESCE(SUM(COALESCE(s."collectedAmount", s."codAmount")), 0)::text AS total, COUNT(*)::int AS n
        FROM "Shipment" s
        JOIN "Order" o ON o.id = s."orderId"
        LEFT JOIN "CourierSettlementItem" si ON si."shipmentId" = s.id
        WHERE s."isReturn" = false AND si.id IS NULL AND s.status::text IN ('DELIVERED', 'PARTIALLY_DELIVERED') ${orderSqlFilter(f)}`,
      filtered ? Promise.resolve(null) : profitAndLoss(r.from, r.to),
    ]);
    const ad = (companyLedger ?? ledger).AD_SPEND ?? ZERO;
    const filteredGross = L(ledger, "SALES_REVENUE", "SHIPPING_REVENUE", "RETURN_REVERSAL", "COGS", "RESTOCK_RECOVERY");
    Object.assign(result, {
      grossSales: fixed(gross._sum.total),
      deliveredSales: fixed(L(ledger, "SALES_REVENUE", "SHIPPING_REVENUE")),
      collectedPayments: fixed(payments._sum.amount),
      outstandingCod: fixed(cod[0]?.total),
      outstandingCodShipments: cod[0]?.n ?? 0,
      advertisingSpend: cost(ad),
      productCost: cost(L(ledger, "COGS")),
      courierExpenses: cost(L(ledger, "COURIER_FEE", "COD_FEE", "RETURN_FEE")),
      returnCosts: cost(L(ledger, "RETURN_FEE", "RETURN_REVERSAL", "RESTOCK_RECOVERY")),
      refundsPaid: cost(L(ledger, "REFUND")),
      grossProfit: pnl ? pnl.grossProfit : fixed(filteredGross),
      estimatedNetProfit: pnl ? pnl.netProfit : null,
      grossMarginPct: pnl ? pnl.grossMarginPct : null,
      netMarginPct: pnl ? pnl.netMarginPct : null,
    });
  }

  const definitions = { ...SUMMARY_DEFINITIONS };
  if (!canSeeFinance(user)) {
    for (const k of ["grossSales", "deliveredSales", "collectedPayments", "outstandingCod", "advertisingSpend", "productCost", "courierExpenses", "returnCosts", "grossProfit", "estimatedNetProfit"]) delete definitions[k];
  }
  result.definitions = definitions;
  return result;
}

// ───────────── charts ─────────────

type BucketRow = { bucket: string; n: number; total: string | null };

export const CHART_DEFINITIONS: Record<string, string> = {
  ordersOverTime: "Per bucket: orders placed (by creation time) and orders delivered (by delivery time), Asia/Dhaka buckets.",
  salesOverTime: "Per bucket: value of non-cancelled orders placed, and recognised delivered revenue (product + shipping, ledger).",
  ordersByStatus: "Orders placed in the range grouped by current status.",
  ordersByChannel: "Orders placed in the range by sales channel.",
  revenueByProduct: "Top 10 products by line totals (after line discount) of orders delivered in the range.",
  revenueByChannel: "Recognised delivered revenue (ledger) in the range by the order's sales channel.",
  revenueByCourier: "Recognised delivered revenue (ledger) in the range by the courier that carried the order.",
  deliverySuccess: "Courier shipments finished in the range: delivered ÷ (delivered + returned/RTO).",
  returnRate: "Orders placed in the range now returned/RTO ÷ (those delivered + those returned).",
  cancellationRate: "Orders placed in the range now cancelled ÷ all orders placed in the range.",
  averageOrderValue: "Placed: gross sales ÷ non-cancelled orders placed. Delivered: recognised revenue ÷ orders delivered in range.",
  adCostPerDeliveredOrder: "Advertising expenses (ledger) ÷ orders delivered in the range.",
  customerAcquisitionCost: "Advertising expenses (ledger) ÷ customers whose first order was placed in the range.",
  productProfitability: "Per product for orders delivered in the range: line revenue − snapshot product cost.",
  salesVsExpenses: "Per bucket from the ledger: revenue (sales + shipping − return reversals) vs costs (COGS, courier, packaging, ads, expenses).",
  bestSelling: "Products with the most units in non-cancelled orders placed in the range.",
  slowMoving: "Active variants with stock on hand that sold at most 1 unit (non-cancelled orders placed in range).",
};

export async function dashboardCharts(r: ResolvedRange, g: Granularity, f: OrderFilter, user: AuthUser) {
  const finance = canSeeFinance(user);
  const keys = bucketKeys(r.from, r.to, g);
  const of = orderSqlFilter(f);
  const base = orderWhere(f);
  const placed: Prisma.OrderWhereInput = { ...base, createdAt: { gte: r.gte, lt: r.lt } };

  const [placedBuckets, deliveredBuckets, byStatus, byChannel, shipments, bestSelling, slowMoving, newCustomers, deliveredCount] = await Promise.all([
    prisma.$queryRaw<BucketRow[]>`
      SELECT ${bucketSql(`o."createdAt"`, g)} AS bucket, COUNT(*)::int AS n,
             SUM(o.total) FILTER (WHERE o.status::text <> 'CANCELLED')::text AS total
      FROM "Order" o WHERE ${inRange(`o."createdAt"`, r)} ${of} GROUP BY 1`,
    prisma.$queryRaw<BucketRow[]>`
      SELECT ${bucketSql(`o."deliveredAt"`, g)} AS bucket, COUNT(*)::int AS n, NULL::text AS total
      FROM "Order" o WHERE ${inRange(`o."deliveredAt"`, r)} ${of} GROUP BY 1`,
    prisma.order.groupBy({ by: ["status"], where: placed, _count: { _all: true } }),
    prisma.order.groupBy({ by: ["channel"], where: placed, _count: { _all: true }, _sum: { total: true } }),
    prisma.$queryRaw<{ providerId: string; name: string; delivered: number; returned: number }[]>`
      SELECT s."providerId", p.name,
        COUNT(*) FILTER (WHERE s.status::text IN ('DELIVERED','PARTIALLY_DELIVERED'))::int AS delivered,
        COUNT(*) FILTER (WHERE s.status::text IN ('RETURNED','RETURNING'))::int AS returned
      FROM "Shipment" s JOIN "CourierProvider" p ON p.id = s."providerId" JOIN "Order" o ON o.id = s."orderId"
      WHERE s."isReturn" = false AND (
        (s.status::text IN ('DELIVERED','PARTIALLY_DELIVERED') AND ${inRange(`COALESCE(s."deliveredAt", s."updatedAt")`, r)})
        OR (s.status::text IN ('RETURNED','RETURNING') AND ${inRange(`COALESCE(s."returnedAt", s."updatedAt")`, r)})
      ) ${of}
      GROUP BY s."providerId", p.name`,
    prisma.$queryRaw<{ productId: string | null; name: string; units: number; revenue: string }[]>`
      SELECT oi."productId", MAX(oi."productName") AS name, SUM(oi.quantity)::int AS units, SUM(oi."lineTotal")::text AS revenue
      FROM "OrderItem" oi JOIN "Order" o ON o.id = oi."orderId"
      WHERE o.status::text <> 'CANCELLED' AND ${inRange(`o."createdAt"`, r)} ${of}
      GROUP BY oi."productId", CASE WHEN oi."productId" IS NULL THEN oi.sku END
      ORDER BY units DESC, name ASC LIMIT 10`,
    prisma.$queryRaw<{ variantId: string; sku: string; product: string; variant: string; available: number; unitsSold: number; lastSoldAt: Date | null }[]>`
      SELECT v.id AS "variantId", v.sku, p.name AS product, v.name AS variant, il.available,
        COALESCE(sold.units, 0)::int AS "unitsSold", last.at AS "lastSoldAt"
      FROM "ProductVariant" v
      JOIN "Product" p ON p.id = v."productId"
      JOIN "InventoryLevel" il ON il."variantId" = v.id
      LEFT JOIN (
        SELECT oi."variantId", SUM(oi.quantity) AS units FROM "OrderItem" oi JOIN "Order" o ON o.id = oi."orderId"
        WHERE o.status::text <> 'CANCELLED' AND ${inRange(`o."createdAt"`, r)} GROUP BY oi."variantId"
      ) sold ON sold."variantId" = v.id
      LEFT JOIN LATERAL (
        SELECT MAX(o."createdAt") AS at FROM "OrderItem" oi JOIN "Order" o ON o.id = oi."orderId"
        WHERE oi."variantId" = v.id AND o.status::text <> 'CANCELLED'
      ) last ON true
      WHERE v."isActive" = true AND p.status::text = 'ACTIVE' AND p."archivedAt" IS NULL AND il.available > 0 AND COALESCE(sold.units, 0) <= 1
      ${f.productId ? Prisma.sql`AND p.id = ${f.productId}` : Prisma.empty}
      ORDER BY il.available DESC, v.sku ASC LIMIT 50`,
    prisma.customer.count({ where: { firstOrderAt: { gte: r.gte, lt: r.lt }, deletedAt: null } }),
    prisma.order.count({ where: { ...base, deliveredAt: { gte: r.gte, lt: r.lt } } }),
  ]);

  const placedMap = new Map(placedBuckets.map((b) => [b.bucket, b]));
  const deliveredMap = new Map(deliveredBuckets.map((b) => [b.bucket, b]));
  const statusCounts: Record<string, number> = Object.fromEntries(ORDER_STATUSES.map((s) => [s, 0]));
  for (const s of byStatus) statusCounts[s.status] = s._count._all;
  const totalPlaced = Object.values(statusCounts).reduce((a, b) => a + b, 0);
  const deliveredKept = DELIVERED_STATES.reduce((n, s) => n + statusCounts[s], 0);
  const returned = RETURNED_STATES.reduce((n, s) => n + statusCounts[s], 0);
  const totDelivered = shipments.reduce((n, s) => n + s.delivered, 0);
  const totReturned = shipments.reduce((n, s) => n + s.returned, 0);

  const series: Record<string, unknown> = {
    ordersOverTime: keys.map((k) => ({ bucket: bucketLabel(k, g), start: k, placed: placedMap.get(k)?.n ?? 0, delivered: deliveredMap.get(k)?.n ?? 0 })),
    ordersByStatus: ORDER_STATUSES.map((s) => ({ status: s, count: statusCounts[s] })),
    ordersByChannel: byChannel.map((c) => ({ channel: c.channel, orders: c._count._all })).sort((a, b) => b.orders - a.orders),
    deliverySuccess: {
      delivered: totDelivered,
      returned: totReturned,
      successRatePct: pct(totDelivered, totDelivered + totReturned),
      byCourier: shipments.map((s) => ({ providerId: s.providerId, courier: s.name, delivered: s.delivered, returned: s.returned, successRatePct: pct(s.delivered, s.delivered + s.returned) })),
    },
    returnRate: { returned, delivered: deliveredKept, ratePct: pct(returned, deliveredKept + returned) },
    cancellationRate: { cancelled: statusCounts.CANCELLED, placed: totalPlaced, ratePct: pct(statusCounts.CANCELLED, totalPlaced) },
    bestSelling: bestSelling.map((b) => ({ productId: b.productId, name: b.name, units: b.units, ...(finance ? { revenue: fixed(b.revenue) } : {}) })),
    slowMoving,
  };

  if (finance) {
    const [deliveredRevenue, ledgerBuckets, byProduct, revenueByChannel, revenueByCourier, ledger] = await Promise.all([
      prisma.$queryRaw<BucketRow[]>`
        SELECT ${bucketSql(`fe."date"`, g)} AS bucket, 0 AS n, SUM(fe.amount)::text AS total
        FROM "FinancialEntry" fe ${isFiltered(f) ? Prisma.sql`JOIN "Order" o ON o.id = fe."orderId"` : Prisma.empty}
        WHERE fe.type::text IN ('SALES_REVENUE','SHIPPING_REVENUE') AND ${inRange(`fe."date"`, r)} ${isFiltered(f) ? of : Prisma.empty}
        GROUP BY 1`,
      prisma.$queryRaw<{ bucket: string; revenue: string; costs: string }[]>`
        SELECT ${bucketSql(`fe."date"`, g)} AS bucket,
          COALESCE(SUM(fe.amount) FILTER (WHERE fe.type::text IN ('SALES_REVENUE','SHIPPING_REVENUE','RETURN_REVERSAL')), 0)::text AS revenue,
          COALESCE(-SUM(fe.amount) FILTER (WHERE fe.type::text IN ('COGS','COURIER_FEE','COD_FEE','RETURN_FEE','PACKAGING_COST','EXPENSE','AD_SPEND','RESTOCK_RECOVERY','ADJUSTMENT')), 0)::text AS costs
        FROM "FinancialEntry" fe
        WHERE ${inRange(`fe."date"`, r)} AND fe.type::text IN ('SALES_REVENUE','SHIPPING_REVENUE','RETURN_REVERSAL','COGS','COURIER_FEE','COD_FEE','RETURN_FEE','PACKAGING_COST','EXPENSE','AD_SPEND','RESTOCK_RECOVERY','ADJUSTMENT')
        GROUP BY 1`,
      prisma.$queryRaw<{ productId: string | null; name: string; units: number; revenue: string; cost: string }[]>`
        SELECT oi."productId", MAX(oi."productName") AS name, SUM(oi.quantity)::int AS units,
          SUM(oi."lineTotal")::text AS revenue, SUM(oi."costTotal")::text AS cost
        FROM "OrderItem" oi JOIN "Order" o ON o.id = oi."orderId"
        WHERE ${inRange(`o."deliveredAt"`, r)} ${of}
        GROUP BY oi."productId", CASE WHEN oi."productId" IS NULL THEN oi.sku END
        ORDER BY SUM(oi."lineTotal") DESC`,
      prisma.$queryRaw<{ channel: string; revenue: string; orders: number }[]>`
        SELECT o.channel::text AS channel, SUM(fe.amount)::text AS revenue, COUNT(DISTINCT o.id)::int AS orders
        FROM "FinancialEntry" fe JOIN "Order" o ON o.id = fe."orderId"
        WHERE fe.type::text IN ('SALES_REVENUE','SHIPPING_REVENUE') AND ${inRange(`fe."date"`, r)} ${of}
        GROUP BY o.channel ORDER BY SUM(fe.amount) DESC`,
      prisma.$queryRaw<{ courier: string | null; revenue: string; orders: number }[]>`
        SELECT sp.name AS courier, SUM(fe.amount)::text AS revenue, COUNT(DISTINCT o.id)::int AS orders
        FROM "FinancialEntry" fe JOIN "Order" o ON o.id = fe."orderId"
        LEFT JOIN LATERAL (
          SELECT p.name FROM "Shipment" s JOIN "CourierProvider" p ON p.id = s."providerId"
          WHERE s."orderId" = o.id AND s."isReturn" = false AND s.status::text NOT IN ('CANCELLED','FAILED')
          ORDER BY s."createdAt" DESC LIMIT 1
        ) sp ON true
        WHERE fe.type::text IN ('SALES_REVENUE','SHIPPING_REVENUE') AND ${inRange(`fe."date"`, r)} ${of}
        GROUP BY sp.name ORDER BY SUM(fe.amount) DESC`,
      ledgerByType(r),
    ]);
    const revMap = new Map(deliveredRevenue.map((b) => [b.bucket, b.total]));
    const lbMap = new Map(ledgerBuckets.map((b) => [b.bucket, b]));
    const adSpend = money(ledger.AD_SPEND).negated();
    const nonCancelled = totalPlaced - statusCounts.CANCELLED;
    const grossSales = sum(placedBuckets.map((b) => b.total));
    const deliveredRev = sum(deliveredRevenue.map((b) => b.total));

    Object.assign(series, {
      salesOverTime: keys.map((k) => ({ bucket: bucketLabel(k, g), start: k, placedValue: fixed(placedMap.get(k)?.total), deliveredRevenue: fixed(revMap.get(k)) })),
      salesVsExpenses: keys.map((k) => {
        const row = lbMap.get(k);
        const rev = money(row?.revenue);
        const costs = money(row?.costs);
        return { bucket: bucketLabel(k, g), start: k, revenue: rev.toFixed(2), expenses: costs.toFixed(2), net: rev.minus(costs).toFixed(2) };
      }),
      revenueByProduct: byProduct.slice(0, 10).map((p) => ({ productId: p.productId, name: p.name, units: p.units, revenue: fixed(p.revenue) })),
      revenueByChannel: revenueByChannel.map((c) => ({ channel: c.channel, orders: c.orders, revenue: fixed(c.revenue) })),
      revenueByCourier: revenueByCourier.map((c) => ({ courier: c.courier ?? "(no courier)", orders: c.orders, revenue: fixed(c.revenue) })),
      averageOrderValue: { placed: ratio(grossSales, nonCancelled), delivered: ratio(deliveredRev, deliveredCount) },
      adCostPerDeliveredOrder: { adSpend: adSpend.toFixed(2), deliveredOrders: deliveredCount, value: ratio(adSpend, deliveredCount) },
      customerAcquisitionCost: { adSpend: adSpend.toFixed(2), newCustomers, value: ratio(adSpend, newCustomers) },
      productProfitability: byProduct
        .map((p) => {
          const rev = money(p.revenue);
          const profit = rev.minus(money(p.cost));
          return { productId: p.productId, name: p.name, units: p.units, revenue: rev.toFixed(2), cost: fixed(p.cost), profit: profit.toFixed(2), marginPct: rev.greaterThan(0) ? profit.dividedBy(rev).times(100).toFixed(1) : null };
        })
        .sort((a, b) => money(b.profit).comparedTo(money(a.profit)))
        .slice(0, 50),
    });
  }

  const definitions = Object.fromEntries(Object.entries(CHART_DEFINITIONS).filter(([k]) => k in series));
  return { range: { from: r.from, to: r.to, timezone: TZ, granularity: g }, financeVisible: finance, series, definitions };
}
