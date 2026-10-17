import type { Db, Tx } from "../../lib/prisma.js";
import { money, sum, ZERO, type Decimal, type MoneyInput } from "../../lib/money.js";
import { getSetting } from "../../lib/settings.js";
import type { EntryType } from "../../generated/prisma/enums.js";

export interface EntryInput {
  type: EntryType;
  amount: MoneyInput; // signed
  date: Date;
  description: string;
  key: string; // idempotency key – same key never posts twice
  isCash?: boolean;
  accountId?: string | null;
  orderId?: string | null;
  shipmentId?: string | null;
  expenseId?: string | null;
  refundId?: string | null;
  paymentId?: string | null;
  settlementId?: string | null;
  createdById?: string | null;
}

/** Append entries; duplicates (same key) are silently skipped so retries/webhooks are safe. */
export async function postEntries(db: Db, entries: EntryInput[]) {
  const rows = entries
    .filter((e) => !money(e.amount).isZero())
    .map((e) => ({
      type: e.type,
      amount: money(e.amount),
      date: e.date,
      description: e.description,
      idempotencyKey: e.key,
      isCash: e.isCash ?? false,
      accountId: e.accountId ?? null,
      orderId: e.orderId ?? null,
      shipmentId: e.shipmentId ?? null,
      expenseId: e.expenseId ?? null,
      refundId: e.refundId ?? null,
      paymentId: e.paymentId ?? null,
      settlementId: e.settlementId ?? null,
      createdById: e.createdById ?? null,
    }));
  if (!rows.length) return { count: 0 };
  return db.financialEntry.createMany({ data: rows, skipDuplicates: true });
}

type OrderForLedger = {
  id: string;
  orderNumber: string;
  subtotal: Decimal;
  discountTotal: Decimal;
  deliveryCharge: Decimal;
  productCostTotal: Decimal;
  packagingCost: Decimal;
};

/**
 * Revenue is recognised when the customer receives the goods (DELIVERED), not when the order is placed.
 * Customer-paid delivery is booked as SHIPPING_REVENUE, separately from the courier's fee (an expense).
 */
export async function recognizeDelivery(tx: Tx, order: OrderForLedger, deliveredAt: Date, userId?: string | null) {
  const base = { orderId: order.id, date: deliveredAt, createdById: userId ?? null };
  await postEntries(tx, [
    { ...base, type: "SALES_REVENUE", amount: money(order.subtotal).minus(order.discountTotal), description: `Sales ${order.orderNumber}`, key: `order:${order.id}:sales` },
    { ...base, type: "SHIPPING_REVENUE", amount: order.deliveryCharge, description: `Delivery charge ${order.orderNumber}`, key: `order:${order.id}:shipping` },
    { ...base, type: "COGS", amount: money(order.productCostTotal).negated(), description: `Cost of goods ${order.orderNumber}`, key: `order:${order.id}:cogs` },
    { ...base, type: "PACKAGING_COST", amount: money(order.packagingCost).negated(), description: `Packaging ${order.orderNumber}`, key: `order:${order.id}:packaging` },
  ]);
}

/** Packaging is spent even when a parcel comes back undelivered. */
export async function recognizeRtoPackaging(tx: Tx, order: OrderForLedger, date: Date) {
  await postEntries(tx, [
    { type: "PACKAGING_COST", amount: money(order.packagingCost).negated(), date, orderId: order.id, description: `Packaging (RTO) ${order.orderNumber}`, key: `order:${order.id}:packaging` },
  ]);
}

// ───────────── Per-order profit model ─────────────

export interface ProfitLine {
  amount: string;
  estimated: boolean;
}

export interface OrderProfit {
  productRevenue: ProfitLine;
  shippingRevenue: ProfitLine;
  productCost: ProfitLine;
  grossMargin: ProfitLine; // product revenue − product cost
  packagingCost: ProfitLine;
  courierFee: ProfitLine;
  codFee: ProfitLine;
  returnFee: ProfitLine;
  refunds: ProfitLine;
  adCost: ProfitLine;
  netProfit: ProfitLine;
  status: "ESTIMATED" | "RECONCILED";
  basis: "NOT_SHIPPED" | "IN_FLIGHT" | "DELIVERED" | "RTO" | "RETURNED_AFTER_DELIVERY";
}

type OrderForProfit = OrderForLedger & {
  status: string;
  codAmount: Decimal;
  refundedAmount: Decimal;
  financeStatus: string;
  zone?: { code: string } | null;
  shipments?: { isReturn: boolean; status: string; deliveryFee: Decimal | null; codCharge: Decimal | null; returnFee: Decimal | null }[];
};

const line = (amount: MoneyInput, estimated: boolean): ProfitLine => ({ amount: money(amount).toFixed(2), estimated });

/**
 * Estimated vs. actual profit of a single order. Courier fees use the courier-reported value when
 * known, otherwise the configured estimate. Advertising cost is an allocation passed in by the caller.
 */
export async function computeOrderProfit(db: Db, order: OrderForProfit, adCost: Decimal = ZERO): Promise<OrderProfit> {
  const fin = await getSetting("finance", db);
  const status = order.status;
  const notShipped = ["PENDING", "CONFIRMATION_REQUIRED", "CONFIRMED", "PROCESSING", "READY_TO_SHIP", "ON_HOLD", "CANCELLED"].includes(status);
  const shipment = order.shipments?.find((s) => !s.isReturn && !["CANCELLED", "FAILED"].includes(s.status));
  const delivered = ["DELIVERED", "RETURN_REQUESTED", "EXCHANGE_REQUESTED", "EXCHANGED"].includes(status);
  const returnedAfterDelivery = status === "RETURNED" && order.refundedAmount.greaterThan(0);
  const rto = (status === "RETURNED" || status === "RETURN_IN_TRANSIT") && !returnedAfterDelivery;

  if (notShipped) {
    const zero = line(0, false);
    const rev = status === "CANCELLED" ? zero : line(money(order.subtotal).minus(order.discountTotal), true);
    const cost = status === "CANCELLED" ? zero : line(order.productCostTotal, true);
    const gm = status === "CANCELLED" ? zero : line(money(order.subtotal).minus(order.discountTotal).minus(order.productCostTotal), true);
    return {
      productRevenue: rev, shippingRevenue: status === "CANCELLED" ? zero : line(order.deliveryCharge, true), productCost: cost, grossMargin: gm,
      packagingCost: zero, courierFee: zero, codFee: zero, returnFee: zero, refunds: zero, adCost: line(adCost, true),
      netProfit: status === "CANCELLED" ? line(money(adCost).negated(), true) : line(money(gm.amount).plus(order.deliveryCharge).minus(adCost), true),
      status: "ESTIMATED", basis: "NOT_SHIPPED",
    };
  }

  const zoneFee = money(fin.estimatedCourierFee[order.zone?.code ?? "OUTSIDE_DHAKA"] ?? fin.estimatedCourierFee.OUTSIDE_DHAKA);
  const courierFee = shipment?.deliveryFee != null ? line(shipment.deliveryFee, false) : line(zoneFee, true);
  const codFee = shipment?.codCharge != null
    ? line(shipment.codCharge, false)
    : line(rto ? 0 : money(order.codAmount).times(money(fin.codChargePercent)).dividedBy(100), true);
  const returnFee = rto || returnedAfterDelivery
    ? shipment?.returnFee != null ? line(shipment.returnFee, false) : line(money(courierFee.amount).times(fin.estimatedReturnFeeRatio), true)
    : line(0, false);

  const revenueCounts = delivered || returnedAfterDelivery;
  const productRevenue = line(revenueCounts ? money(order.subtotal).minus(order.discountTotal) : 0, !delivered && !returnedAfterDelivery);
  const shippingRevenue = line(revenueCounts ? order.deliveryCharge : 0, false);
  const productCost = line(revenueCounts ? order.productCostTotal : 0, false);
  const grossMargin = line(money(productRevenue.amount).minus(productCost.amount), productRevenue.estimated);
  const refunds = line(order.refundedAmount, false);
  const packaging = line(order.packagingCost, false);

  const net = sum([productRevenue.amount, shippingRevenue.amount])
    .minus(sum([productCost.amount, packaging.amount, courierFee.amount, codFee.amount, returnFee.amount, refunds.amount, adCost]));

  const anyEstimate = [courierFee, codFee, returnFee].some((l) => l.estimated) || status === "SHIPPED" || status === "COURIER_BOOKED";
  return {
    productRevenue, shippingRevenue, productCost, grossMargin, packagingCost: packaging, courierFee, codFee, returnFee, refunds,
    adCost: line(adCost, true),
    netProfit: line(net, true),
    status: order.financeStatus === "RECONCILED" && !anyEstimate ? "RECONCILED" : "ESTIMATED",
    basis: delivered ? "DELIVERED" : rto ? "RTO" : returnedAfterDelivery ? "RETURNED_AFTER_DELIVERY" : "IN_FLIGHT",
  };
}
