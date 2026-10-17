import { prisma, Prisma } from "../../lib/prisma.js";
import { money, sum, ZERO, type Decimal } from "../../lib/money.js";
import { getSetting } from "../../lib/settings.js";
import { addDays, dateOnly, dhakaDate, dhakaRange } from "../../lib/time.js";
import type { OrderStatus } from "../../generated/prisma/enums.js";

/**
 * Marketing reports. Verified numbers come only from our own orders; platform-reported numbers
 * (AdSpendRecord.reportedPurchases / reportedRevenue) are always returned in a separate `platform` block.
 *
 * Definitions (all dates Asia/Dhaka, inclusive):
 *  placed / confirmed / cancelled / returned – orders CREATED in the range (cohort)
 *  delivered / deliveredRevenue              – orders whose deliveredAt is in the range and that are still
 *                                              delivered (not RTO'd); revenue = total − refunded
 *  returnRate                                – returned ÷ shipped, within the placed cohort (percent)
 *  cpa                                       – spend ÷ delivered orders
 *  roas                                      – delivered revenue ÷ spend
 *  estimatedNetProfit                        – delivered revenue − product cost − packaging − courier
 *                                              (reported fee, else zone estimate + COD %) − spend. Estimate.
 */

export type AttributionModel = "first" | "last";
export const DIRECT = "(direct / unknown)";

const DELIVERED: OrderStatus[] = ["DELIVERED", "RETURN_REQUESTED", "EXCHANGE_REQUESTED", "EXCHANGED"];
const RETURNED: OrderStatus[] = ["RETURN_IN_TRANSIT", "RETURNED"];
const SHIPPED: OrderStatus[] = ["SHIPPED", ...DELIVERED, ...RETURNED];
const CONFIRMED_OR_LATER: OrderStatus[] = ["CONFIRMED", "PROCESSING", "READY_TO_SHIP", "COURIER_BOOKED", ...SHIPPED];

export function resolveRange(from?: string, to?: string) {
  const t = to ?? dhakaDate();
  const f = from ?? addDays(t, -29);
  return { from: f, to: t };
}

const pct = (num: number, den: number) => (den > 0 ? money(num).times(100).dividedBy(den).toFixed(2) : null);
const ratio = (num: Decimal, den: Decimal) => (den.greaterThan(0) ? num.dividedBy(den).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toFixed(2) : null);
const moneyDiv = (num: Decimal, den: number) => (den > 0 ? money(num.dividedBy(den)).toFixed(2) : null);

const orderSelect = {
  id: true, status: true, channel: true, createdAt: true, confirmedAt: true, shippedAt: true, deliveredAt: true, returnedAt: true,
  total: true, refundedAmount: true, productCostTotal: true, packagingCost: true, codAmount: true,
  zone: { select: { code: true } },
  shipments: { where: { isReturn: false, status: { notIn: ["CANCELLED", "FAILED"] } }, select: { deliveryFee: true, codCharge: true }, take: 1 },
  attribution: true,
} satisfies Prisma.OrderSelect;
type OrderRow = Prisma.OrderGetPayload<{ select: typeof orderSelect }>;

async function loadOrders(from: string, to: string) {
  const range = dhakaRange(from, to);
  return prisma.order.findMany({ where: { OR: [{ createdAt: range }, { deliveredAt: range }] }, select: orderSelect });
}

function touch(o: OrderRow, model: AttributionModel) {
  const a = o.attribution;
  if (!a) return { source: null, medium: null, campaign: null, campaignId: null };
  const pick = (first: string | null, last: string | null) => (model === "first" ? (first ?? last) : (last ?? first));
  const clean = (v: string | null) => (v && v.trim() ? v.trim() : null);
  return {
    source: clean(pick(a.firstSource, a.lastSource))?.toLowerCase() ?? null,
    medium: clean(pick(a.firstMedium, a.lastMedium))?.toLowerCase() ?? null,
    campaign: clean(pick(a.firstCampaign, a.lastCampaign)),
    campaignId: clean(a.campaignId),
  };
}

interface Bucket {
  key: string;
  source: string;
  medium: string | null;
  campaign: string | null;
  campaignIds: Set<string>;
  placed: number;
  placedValue: Decimal;
  nonCancelledPlaced: number;
  nonCancelledValue: Decimal;
  confirmed: number;
  cancelled: number;
  returned: number;
  shipped: number;
  deliveredInCohort: number;
  delivered: number;
  deliveredRevenue: Decimal;
  productCost: Decimal;
  packaging: Decimal;
  courier: Decimal;
  courierEstimated: boolean;
  spend: Decimal;
  impressions: number;
  clicks: number;
  reportedPurchases: number;
  reportedRevenue: Decimal;
}

const newBucket = (key: string, source: string, medium: string | null, campaign: string | null): Bucket => ({
  key, source, medium, campaign, campaignIds: new Set(), placed: 0, placedValue: ZERO, nonCancelledPlaced: 0, nonCancelledValue: ZERO,
  confirmed: 0, cancelled: 0, returned: 0, shipped: 0, deliveredInCohort: 0, delivered: 0, deliveredRevenue: ZERO, productCost: ZERO,
  packaging: ZERO, courier: ZERO, courierEstimated: false, spend: ZERO, impressions: 0, clicks: 0, reportedPurchases: 0, reportedRevenue: ZERO,
});

async function aggregate(from: string, to: string, model: AttributionModel, keyFn: (t: ReturnType<typeof touch>) => { key: string; source: string; medium: string | null; campaign: string | null }) {
  const [orders, fin, spendRows] = await Promise.all([
    loadOrders(from, to),
    getSetting("finance"),
    prisma.adSpendRecord.findMany({ where: { date: { gte: dateOnly(from), lte: dateOnly(to) } }, orderBy: [{ date: "asc" }, { id: "asc" }] }),
  ]);
  const range = dhakaRange(from, to);
  const inRange = (d: Date | null) => !!d && d >= range.gte! && d < range.lt!;
  const buckets = new Map<string, Bucket>();

  for (const o of orders) {
    const t = touch(o, model);
    const k = keyFn(t);
    let b = buckets.get(k.key);
    if (!b) buckets.set(k.key, (b = newBucket(k.key, k.source, k.medium, k.campaign)));
    if (t.campaignId) b.campaignIds.add(t.campaignId);

    if (inRange(o.createdAt)) {
      b.placed++;
      b.placedValue = b.placedValue.plus(o.total);
      if (o.status !== "CANCELLED") {
        b.nonCancelledPlaced++;
        b.nonCancelledValue = b.nonCancelledValue.plus(o.total);
      }
      if (o.confirmedAt || CONFIRMED_OR_LATER.includes(o.status)) b.confirmed++;
      if (o.status === "CANCELLED") b.cancelled++;
      if (RETURNED.includes(o.status)) b.returned++;
      if (o.shippedAt || SHIPPED.includes(o.status)) b.shipped++;
      if (DELIVERED.includes(o.status)) b.deliveredInCohort++;
    }
    if (inRange(o.deliveredAt) && DELIVERED.includes(o.status)) {
      b.delivered++;
      b.deliveredRevenue = b.deliveredRevenue.plus(money(o.total).minus(o.refundedAmount));
      b.productCost = b.productCost.plus(o.productCostTotal);
      b.packaging = b.packaging.plus(o.packagingCost);
      const s = o.shipments[0];
      const zoneFee = money(fin.estimatedCourierFee[o.zone?.code ?? "OUTSIDE_DHAKA"] ?? fin.estimatedCourierFee.OUTSIDE_DHAKA);
      const fee = s?.deliveryFee != null ? money(s.deliveryFee) : zoneFee;
      const cod = s?.codCharge != null ? money(s.codCharge) : money(money(o.codAmount).times(money(fin.codChargePercent)).dividedBy(100));
      if (s?.deliveryFee == null || s?.codCharge == null) b.courierEstimated = true;
      b.courier = b.courier.plus(fee).plus(cod);
    }
  }

  // allocate each spend record to exactly one bucket: campaign id match first, then campaign name
  const all = [...buckets.values()];
  const byId = new Map<string, Bucket>();
  const byName = new Map<string, Bucket>();
  for (const b of all) {
    for (const id of b.campaignIds) if (!byId.has(id)) byId.set(id, b);
    if (b.campaign && !byName.has(b.campaign.toLowerCase())) byName.set(b.campaign.toLowerCase(), b);
  }
  const unmatched = { spend: ZERO, records: 0, campaigns: new Set<string>(), reportedPurchases: 0, reportedRevenue: ZERO };
  for (const r of spendRows) {
    const b = (r.campaignId && byId.get(r.campaignId)) || (r.campaignName && byName.get(r.campaignName.trim().toLowerCase())) || null;
    if (!b) {
      unmatched.spend = unmatched.spend.plus(r.spend);
      unmatched.records++;
      unmatched.reportedPurchases += r.reportedPurchases;
      unmatched.reportedRevenue = unmatched.reportedRevenue.plus(r.reportedRevenue);
      unmatched.campaigns.add(r.campaignName || r.campaignId);
      continue;
    }
    b.spend = b.spend.plus(r.spend);
    b.impressions += r.impressions;
    b.clicks += r.clicks;
    b.reportedPurchases += r.reportedPurchases;
    b.reportedRevenue = b.reportedRevenue.plus(r.reportedRevenue);
  }
  return { buckets: all, unmatched, totalSpend: sum(spendRows.map((r) => r.spend)) };
}

function profitOf(b: Bucket) {
  const amount = b.deliveredRevenue.minus(b.productCost).minus(b.packaging).minus(b.courier).minus(b.spend);
  return {
    amount: money(amount).toFixed(2),
    estimated: true,
    components: {
      deliveredRevenue: money(b.deliveredRevenue).toFixed(2),
      productCost: money(b.productCost).toFixed(2),
      packaging: money(b.packaging).toFixed(2),
      courier: money(b.courier).toFixed(2),
      courierEstimated: b.courierEstimated,
      adSpend: money(b.spend).toFixed(2),
    },
  };
}

const platformBlock = (b: Pick<Bucket, "spend" | "impressions" | "clicks" | "reportedPurchases" | "reportedRevenue">) => ({
  spend: money(b.spend).toFixed(2),
  impressions: b.impressions,
  clicks: b.clicks,
  reportedPurchases: b.reportedPurchases,
  reportedRevenue: money(b.reportedRevenue).toFixed(2),
  note: "Platform-reported figures, not verified",
});

function totalsOf(buckets: Bucket[]) {
  const t = newBucket("total", "total", null, null);
  for (const b of buckets) {
    t.placed += b.placed; t.confirmed += b.confirmed; t.cancelled += b.cancelled; t.returned += b.returned; t.shipped += b.shipped;
    t.delivered += b.delivered; t.deliveredInCohort += b.deliveredInCohort; t.nonCancelledPlaced += b.nonCancelledPlaced;
    t.nonCancelledValue = t.nonCancelledValue.plus(b.nonCancelledValue);
    t.deliveredRevenue = t.deliveredRevenue.plus(b.deliveredRevenue); t.productCost = t.productCost.plus(b.productCost);
    t.packaging = t.packaging.plus(b.packaging); t.courier = t.courier.plus(b.courier); t.courierEstimated ||= b.courierEstimated;
    t.spend = t.spend.plus(b.spend); t.impressions += b.impressions; t.clicks += b.clicks; t.reportedPurchases += b.reportedPurchases;
    t.reportedRevenue = t.reportedRevenue.plus(b.reportedRevenue);
  }
  return t;
}

function attributionRow(b: Bucket) {
  return {
    source: b.source,
    medium: b.medium,
    campaign: b.campaign,
    campaignIds: [...b.campaignIds],
    placed: b.placed,
    confirmed: b.confirmed,
    delivered: b.delivered,
    cancelled: b.cancelled,
    returned: b.returned,
    deliveredRevenue: money(b.deliveredRevenue).toFixed(2),
    returnRate: pct(b.returned, b.shipped),
    platform: platformBlock(b),
    cpa: moneyDiv(b.spend, b.delivered),
    roas: ratio(b.deliveredRevenue, b.spend),
    estimatedNetProfit: profitOf(b),
  };
}

export async function attributionReport(params: { from?: string; to?: string; model?: AttributionModel }) {
  const { from, to } = resolveRange(params.from, params.to);
  const model = params.model ?? "last";
  const { buckets, unmatched } = await aggregate(from, to, model, (t) => {
    if (!t.source && !t.medium && !t.campaign && !t.campaignId) return { key: DIRECT, source: DIRECT, medium: null, campaign: null };
    const source = t.source ?? "(not set)";
    return { key: `${source}|${t.medium ?? ""}|${t.campaign ?? t.campaignId ?? ""}`, source, medium: t.medium, campaign: t.campaign ?? t.campaignId };
  });
  const rows = buckets
    .filter((b) => b.placed > 0 || b.delivered > 0 || b.spend.greaterThan(0))
    .sort((a, b) => b.deliveredRevenue.comparedTo(a.deliveredRevenue) || b.placed - a.placed)
    .map(attributionRow);
  const total = totalsOf(buckets);
  total.spend = total.spend.plus(unmatched.spend);
  return {
    from, to, model, currency: "BDT",
    rows,
    totals: attributionRow(total),
    unattributedSpend: {
      spend: money(unmatched.spend).toFixed(2),
      records: unmatched.records,
      campaigns: [...unmatched.campaigns],
      reportedPurchases: unmatched.reportedPurchases,
      reportedRevenue: money(unmatched.reportedRevenue).toFixed(2),
      note: "Imported spend whose campaign matched no attributed order in the range",
    },
    definitions: {
      cohort: "placed/confirmed/cancelled/returned count orders created in the range",
      delivered: "orders delivered (deliveredAt) in the range that were not returned; revenue = total − refunds",
      returnRate: "returned ÷ shipped within the placed cohort, percent",
      cpa: "ad spend ÷ delivered orders",
      roas: "delivered revenue ÷ ad spend",
      estimatedNetProfit: "delivered revenue − product cost − packaging − courier (reported or estimated) − ad spend; an estimate",
    },
  };
}

export async function campaignReport(params: { from?: string; to?: string; model?: AttributionModel }) {
  const { from, to } = resolveRange(params.from, params.to);
  const model = params.model ?? "last";
  const { buckets, unmatched } = await aggregate(from, to, model, (t) => {
    const c = t.campaign ?? t.campaignId;
    return c ? { key: c.toLowerCase(), source: t.source ?? "(not set)", medium: t.medium, campaign: c } : { key: DIRECT, source: DIRECT, medium: null, campaign: null };
  });
  const rows = buckets
    .filter((b) => b.placed > 0 || b.delivered > 0 || b.spend.greaterThan(0))
    .map((b) => ({
      campaign: b.campaign ?? DIRECT,
      campaignIds: [...b.campaignIds],
      placed: b.placed,
      deliveredOfPlaced: b.deliveredInCohort,
      cancelled: b.cancelled,
      returned: b.returned,
      deliveryRate: pct(b.deliveredInCohort, b.placed),
      cancellationRate: pct(b.cancelled, b.placed),
      returnRate: pct(b.returned, b.shipped),
      avgOrderValue: moneyDiv(b.nonCancelledValue, b.nonCancelledPlaced),
      deliveredInRange: b.delivered,
      deliveredRevenue: money(b.deliveredRevenue).toFixed(2),
      spend: money(b.spend).toFixed(2),
      cpa: moneyDiv(b.spend, b.delivered),
      roas: ratio(b.deliveredRevenue, b.spend),
    }))
    .sort((a, b) => b.placed - a.placed);
  return {
    from, to, model, rows,
    unattributedSpend: money(unmatched.spend).toFixed(2),
    definitions: {
      deliveryRate: "orders placed in the range that are now delivered ÷ orders placed, percent",
      returnRate: "returned ÷ shipped within the placed cohort, percent",
      avgOrderValue: "mean order total of non-cancelled orders placed in the range",
    },
  };
}

/**
 * Platform-reported vs verified results per imported campaign, and recorded ADVERTISING expenses vs
 * imported spend, so double entry or missing ad bills stand out.
 */
export async function reconciliationReport(params: { from?: string; to?: string }) {
  const { from, to } = resolveRange(params.from, params.to);
  const range = dhakaRange(from, to);
  const [spendRows, orders, expenses] = await Promise.all([
    prisma.adSpendRecord.findMany({ where: { date: { gte: dateOnly(from), lte: dateOnly(to) } } }),
    prisma.order.findMany({
      where: { createdAt: range, attribution: { isNot: null } },
      select: { id: true, status: true, total: true, refundedAmount: true, attribution: { select: { campaignId: true, lastCampaign: true, firstCampaign: true } } },
    }),
    prisma.expense.findMany({
      where: { deletedAt: null, date: { gte: dateOnly(from), lte: dateOnly(to) }, category: { type: "ADVERTISING" } },
      select: { amount: true, category: { select: { name: true } } },
    }),
  ]);

  interface Camp { platform: string; campaignId: string; campaignName: string | null; spend: Decimal; reportedPurchases: number; reportedRevenue: Decimal; orderIds: Set<string> }
  const camps = new Map<string, Camp>();
  for (const r of spendRows) {
    const key = `${r.platform}|${r.campaignId || (r.campaignName ?? "").toLowerCase()}`;
    let c = camps.get(key);
    if (!c) camps.set(key, (c = { platform: r.platform, campaignId: r.campaignId, campaignName: r.campaignName, spend: ZERO, reportedPurchases: 0, reportedRevenue: ZERO, orderIds: new Set() }));
    c.spend = c.spend.plus(r.spend);
    c.reportedPurchases += r.reportedPurchases;
    c.reportedRevenue = c.reportedRevenue.plus(r.reportedRevenue);
    if (!c.campaignName && r.campaignName) c.campaignName = r.campaignName;
  }
  const matched = new Set<string>();
  for (const o of orders) {
    const a = o.attribution!;
    const names = [a.lastCampaign, a.firstCampaign].filter(Boolean).map((n) => n!.trim().toLowerCase());
    const c = [...camps.values()].find((c) => (a.campaignId && c.campaignId === a.campaignId))
      ?? [...camps.values()].find((c) => c.campaignName && names.includes(c.campaignName.trim().toLowerCase()));
    if (c) {
      c.orderIds.add(o.id);
      matched.add(o.id);
    }
  }
  const byId = new Map(orders.map((o) => [o.id, o]));
  const rows = [...camps.values()].map((c) => {
    const os = [...c.orderIds].map((id) => byId.get(id)!);
    const delivered = os.filter((o) => DELIVERED.includes(o.status));
    const placedValue = sum(os.filter((o) => o.status !== "CANCELLED").map((o) => o.total));
    const deliveredRevenue = sum(delivered.map((o) => money(o.total).minus(o.refundedAmount)));
    return {
      platform: c.platform,
      campaignId: c.campaignId || null,
      campaignName: c.campaignName,
      spend: money(c.spend).toFixed(2),
      platformReported: { purchases: c.reportedPurchases, revenue: money(c.reportedRevenue).toFixed(2) },
      verified: {
        placedOrders: os.length,
        placedValue: placedValue.toFixed(2),
        cancelledOrders: os.filter((o) => o.status === "CANCELLED").length,
        deliveredOrders: delivered.length,
        deliveredRevenue: deliveredRevenue.toFixed(2),
      },
      reportedVsPlaced: c.reportedPurchases - os.length,
      reportedVsDelivered: c.reportedPurchases - delivered.length,
      deliveredRoas: ratio(deliveredRevenue, c.spend),
      reportedRoas: ratio(money(c.reportedRevenue), c.spend),
    };
  }).sort((a, b) => money(b.spend).comparedTo(money(a.spend)));

  const importedSpend = sum(spendRows.map((r) => r.spend));
  const expenseTotal = sum(expenses.map((e) => e.amount));
  const byCategory = new Map<string, Decimal>();
  for (const e of expenses) byCategory.set(e.category.name, (byCategory.get(e.category.name) ?? ZERO).plus(e.amount));
  const byPlatform = new Map<string, Decimal>();
  for (const r of spendRows) byPlatform.set(r.platform, (byPlatform.get(r.platform) ?? ZERO).plus(r.spend));

  const diff = expenseTotal.minus(importedSpend);
  const tolerance = Prisma.Decimal.max(money(importedSpend.times("0.05")), money(1));
  let status: "MATCHED" | "NO_EXPENSES" | "NO_IMPORTED_SPEND" | "EXPENSES_HIGHER" | "SPEND_HIGHER" | "NO_DATA";
  let message: string;
  if (expenseTotal.isZero() && importedSpend.isZero()) { status = "NO_DATA"; message = "No advertising expenses or imported spend in this period."; }
  else if (expenseTotal.isZero()) { status = "NO_EXPENSES"; message = "Ad spend was imported but no ADVERTISING expense is recorded – record the ad bills as expenses so advertising reaches the P&L."; }
  else if (importedSpend.isZero()) { status = "NO_IMPORTED_SPEND"; message = "Advertising expenses are recorded but no platform spend was imported – import the Ads Manager report to see CPA / ROAS."; }
  else if (diff.abs().lessThanOrEqualTo(tolerance)) { status = "MATCHED"; message = "Recorded advertising expenses match imported spend (within 5%)."; }
  else if (diff.greaterThan(0)) { status = "EXPENSES_HIGHER"; message = "Recorded advertising expenses exceed imported spend – check for double entry, VAT/FX differences or missing imports."; }
  else { status = "SPEND_HIGHER"; message = "Imported spend exceeds recorded advertising expenses – some ad bills may not have been recorded."; }

  return {
    from, to, currency: "BDT",
    campaigns: rows,
    totals: {
      spend: importedSpend.toFixed(2),
      reportedPurchases: rows.reduce((n, r) => n + r.platformReported.purchases, 0),
      reportedRevenue: sum(spendRows.map((r) => r.reportedRevenue)).toFixed(2),
      verifiedPlacedOrders: matched.size,
      verifiedDeliveredOrders: rows.reduce((n, r) => n + r.verified.deliveredOrders, 0),
      verifiedDeliveredRevenue: sum(rows.map((r) => r.verified.deliveredRevenue)).toFixed(2),
      attributedOrdersWithoutSpendRecord: orders.length - matched.size,
    },
    expenses: {
      recordedAdvertisingExpenses: expenseTotal.toFixed(2),
      byCategory: Object.fromEntries([...byCategory].map(([k, v]) => [k, money(v).toFixed(2)])),
      importedSpend: importedSpend.toFixed(2),
      importedSpendByPlatform: Object.fromEntries([...byPlatform].map(([k, v]) => [k, money(v).toFixed(2)])),
      difference: money(diff).toFixed(2),
      status,
      message,
      note: "Imported ad spend is analytics only and never posts to the ledger; the P&L uses recorded expenses.",
    },
  };
}
