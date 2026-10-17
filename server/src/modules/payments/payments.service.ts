import { prisma, type Tx } from "../../lib/prisma.js";
import { assertFound, badRequest, conflict, unprocessable } from "../../lib/errors.js";
import { money } from "../../lib/money.js";
import { audit } from "../../lib/audit.js";
import { postEntries } from "../finance/ledger.service.js";
import { recomputeCustomerStats } from "../customers/customers.service.js";
import type { PaymentMethod } from "../../generated/prisma/enums.js";
import type { Actor } from "../orders/orders.service.js";

const OPEN_FOR_PAYMENT = ["PENDING", "CONFIRMATION_REQUIRED", "CONFIRMED", "PROCESSING", "READY_TO_SHIP", "ON_HOLD"];

export function paymentStatusFor(total: ReturnType<typeof money>, paid: ReturnType<typeof money>, refunded: ReturnType<typeof money>) {
  if (refunded.greaterThan(0)) return refunded.greaterThanOrEqualTo(paid) ? "REFUNDED" : "PARTIALLY_REFUNDED";
  if (paid.greaterThanOrEqualTo(total) && total.greaterThan(0)) return "PAID";
  return paid.greaterThan(0) ? "PARTIALLY_PAID" : "UNPAID";
}

export interface RecordPaymentInput {
  orderId: string;
  method: PaymentMethod;
  amount: string;
  transactionId?: string | null;
  senderNumber?: string | null;
  accountId?: string | null;
  note?: string | null;
  provider?: string;
  /** record as already verified (requires payments.record) */
  verified?: boolean;
}

/**
 * Advance / manual payment. Unverified payments are PENDING and do not change what the customer owes
 * until someone with payments.record verifies them. (method, transactionId) is unique, so the same
 * bKash/Nagad transaction can never be counted twice.
 */
export async function recordPayment(input: RecordPaymentInput, actor: Actor) {
  const amount = money(input.amount);
  if (!amount.greaterThan(0)) throw badRequest("Amount must be positive");
  if (input.method !== "CASH" && input.method !== "COD" && !input.transactionId) {
    throw badRequest("A transaction id is required for digital payments");
  }
  const order = assertFound(await prisma.order.findUnique({ where: { id: input.orderId }, include: { shipments: true } }), "Order");
  if (!OPEN_FOR_PAYMENT.includes(order.status)) {
    throw unprocessable("ORDER_NOT_PAYABLE", `Advance payments cannot be recorded for orders in ${order.status}`);
  }
  if (input.transactionId) {
    const dup = await prisma.payment.findUnique({ where: { method_transactionId: { method: input.method, transactionId: input.transactionId } }, include: { order: { select: { orderNumber: true } } } });
    if (dup) throw conflict(`Transaction ${input.transactionId} is already recorded on order ${dup.order.orderNumber}`);
  }

  const payment = await prisma.payment.create({
    data: {
      orderId: order.id, method: input.method, kind: "ADVANCE", provider: input.provider ?? "manual", amount,
      status: "PENDING", transactionId: input.transactionId ?? null, senderNumber: input.senderNumber ?? null,
      accountId: input.accountId ?? null, note: input.note ?? null,
    },
  });
  await audit(prisma, { userId: actor.userId, action: "payment.recorded", entityType: "Order", entityId: order.id, after: { paymentId: payment.id, method: input.method, amount: amount.toFixed(2), transactionId: input.transactionId ?? null }, ip: actor.ip });
  if (input.verified) return verifyPayment(payment.id, input.accountId ?? null, actor);
  return payment;
}

/** Mark a pending payment as received: reduces COD due, books cash into the account. */
export async function verifyPayment(paymentId: string, accountId: string | null, actor: Actor, tx?: Tx) {
  const run = async (db: Tx) => {
    await db.$queryRaw`SELECT id FROM "Payment" WHERE id = ${paymentId} FOR UPDATE`;
    const p = assertFound(await db.payment.findUnique({ where: { id: paymentId } }), "Payment");
    if (p.status === "COMPLETED") return p; // idempotent (IPN + redirect both verifying)
    if (p.status !== "PENDING") throw conflict(`Payment is ${p.status}`);
    await db.$queryRaw`SELECT id FROM "Order" WHERE id = ${p.orderId} FOR UPDATE`;
    const order = await db.order.findUniqueOrThrow({ where: { id: p.orderId }, include: { shipments: true } });
    const paid = money(order.paidAmount).plus(p.amount);
    if (paid.greaterThan(order.total)) throw conflict(`Payment would exceed the order total (due ${money(order.total).minus(order.paidAmount).toFixed(2)})`);
    const activeShipment = order.shipments.find((s) => !s.isReturn && !["CANCELLED", "FAILED", "PENDING"].includes(s.status));
    if (activeShipment) throw unprocessable("SHIPMENT_ACTIVE", "The courier already has the COD amount; cancel and re-book the shipment before taking an advance");

    const account = accountId ?? p.accountId;
    const updated = await db.payment.update({ where: { id: p.id }, data: { status: "COMPLETED", verifiedAt: new Date(), verifiedById: actor.userId, accountId: account } });
    await db.order.update({
      where: { id: order.id },
      data: {
        paidAmount: paid,
        codAmount: money(order.total).minus(paid),
        paymentStatus: paymentStatusFor(money(order.total), paid, money(order.refundedAmount)),
      },
    });
    await postEntries(db, [
      { type: "PAYMENT_RECEIVED", amount: p.amount, date: new Date(), isCash: true, accountId: account, orderId: order.id, paymentId: p.id, description: `${p.method} payment ${order.orderNumber}${p.transactionId ? ` (${p.transactionId})` : ""}`, key: `payment:${p.id}:received`, createdById: actor.userId },
    ]);
    await audit(db, { userId: actor.userId, action: "payment.verified", entityType: "Order", entityId: order.id, after: { paymentId: p.id, amount: p.amount.toFixed(2) }, ip: actor.ip });
    return updated;
  };
  return tx ? run(tx) : prisma.$transaction(run);
}

export async function rejectPayment(paymentId: string, reason: string, actor: Actor) {
  const p = assertFound(await prisma.payment.findUnique({ where: { id: paymentId } }), "Payment");
  if (p.status !== "PENDING") throw conflict(`Only pending payments can be rejected (this one is ${p.status})`);
  const updated = await prisma.payment.update({ where: { id: p.id }, data: { status: "FAILED", note: [p.note, `Rejected: ${reason}`].filter(Boolean).join("\n") } });
  await audit(prisma, { userId: actor.userId, action: "payment.rejected", entityType: "Order", entityId: p.orderId, after: { paymentId: p.id }, reason, ip: actor.ip });
  return updated;
}

// ───────────── refunds ─────────────

export async function requestRefund(input: { orderId: string; returnId?: string | null; amount: string; method: PaymentMethod; reason: string }, actor: Actor) {
  const order = assertFound(await prisma.order.findUnique({ where: { id: input.orderId }, include: { refunds: true } }), "Order");
  const amount = money(input.amount);
  if (!amount.greaterThan(0)) throw badRequest("Refund amount must be positive");
  const committed = order.refunds.filter((r) => r.status !== "REJECTED").reduce((s, r) => s.plus(r.amount), money(0));
  const refundable = money(order.paidAmount).minus(committed);
  if (amount.greaterThan(refundable)) throw conflict(`Refund exceeds the refundable amount (${refundable.toFixed(2)})`);
  const refund = await prisma.refund.create({
    data: { orderId: order.id, returnId: input.returnId ?? null, amount, method: input.method, reason: input.reason, status: "PENDING", requestedById: actor.userId },
  });
  await audit(prisma, { userId: actor.userId, action: "refund.requested", entityType: "Order", entityId: order.id, after: { refundId: refund.id, amount: amount.toFixed(2) }, reason: input.reason, ip: actor.ip });
  return refund;
}

export async function decideRefund(refundId: string, approve: boolean, actor: Actor, note?: string) {
  const r = assertFound(await prisma.refund.findUnique({ where: { id: refundId } }), "Refund");
  if (r.status !== "PENDING") throw conflict(`Refund is already ${r.status}`);
  const updated = await prisma.refund.update({ where: { id: r.id }, data: approve ? { status: "APPROVED", approvedById: actor.userId, approvedAt: new Date() } : { status: "REJECTED", approvedById: actor.userId, approvedAt: new Date() } });
  await audit(prisma, { userId: actor.userId, action: approve ? "refund.approved" : "refund.rejected", entityType: "Order", entityId: r.orderId, after: { refundId: r.id }, reason: note ?? null, ip: actor.ip });
  return updated;
}

/**
 * Pay an approved refund. P&L impact (RETURN_REVERSAL) and the cash outflow (REFUND) are separate
 * entries so revenue and cash reports each count it exactly once.
 */
export async function payRefund(refundId: string, input: { accountId: string; reference?: string | null }, actor: Actor) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Refund" WHERE id = ${refundId} FOR UPDATE`;
    const r = assertFound(await tx.refund.findUnique({ where: { id: refundId } }), "Refund");
    if (r.status === "PAID") return r;
    if (r.status !== "APPROVED") throw unprocessable("NOT_APPROVED", "Refunds must be approved before they are paid");
    const order = await tx.order.findUniqueOrThrow({ where: { id: r.orderId } });
    const refunded = money(order.refundedAmount).plus(r.amount);
    if (refunded.greaterThan(order.paidAmount)) throw conflict("Refund exceeds what the customer paid");
    const now = new Date();
    const paid = await tx.refund.update({ where: { id: r.id }, data: { status: "PAID", paidAt: now, accountId: input.accountId, reference: input.reference ?? null } });
    await tx.order.update({ where: { id: order.id }, data: { refundedAmount: refunded, paymentStatus: paymentStatusFor(money(order.total), money(order.paidAmount), refunded) } });
    await postEntries(tx, [
      { type: "RETURN_REVERSAL", amount: money(r.amount).negated(), date: now, orderId: order.id, refundId: r.id, description: `Refund (revenue reversal) ${order.orderNumber}`, key: `refund:${r.id}:reversal`, createdById: actor.userId },
      { type: "REFUND", amount: money(r.amount).negated(), date: now, isCash: true, accountId: input.accountId, orderId: order.id, refundId: r.id, description: `Refund paid ${order.orderNumber}`, key: `refund:${r.id}:cash`, createdById: actor.userId },
    ]);
    await recomputeCustomerStats(tx, order.customerId);
    await audit(tx, { userId: actor.userId, action: "refund.paid", entityType: "Order", entityId: order.id, after: { refundId: r.id, amount: r.amount.toFixed(2), accountId: input.accountId }, ip: actor.ip });
    return paid;
  });
}
