import { prisma, type Tx } from "../../lib/prisma.js";
import { assertFound, badRequest, conflict, unprocessable } from "../../lib/errors.js";
import { money, sum } from "../../lib/money.js";
import { audit } from "../../lib/audit.js";
import { nextReturnNumber } from "../../lib/numbering.js";
import type { ReturnStatus } from "../../generated/prisma/enums.js";
import { changeStatus, createOrder, systemActor, type Actor } from "../orders/orders.service.js";
import { dispositionReturned, receiveReturned } from "../inventory/inventory.service.js";
import { postEntries } from "../finance/ledger.service.js";
import { notifyStaff } from "../notifications/notify.js";

const RETURNABLE_ORDER = ["DELIVERED"];

const NEXT: Record<ReturnStatus, ReturnStatus[]> = {
  REQUESTED: ["APPROVED", "REJECTED", "CANCELLED"],
  APPROVED: ["PICKUP_BOOKED", "IN_TRANSIT", "RECEIVED", "CANCELLED"],
  PICKUP_BOOKED: ["IN_TRANSIT", "RECEIVED", "CANCELLED"],
  IN_TRANSIT: ["RECEIVED"],
  RECEIVED: ["INSPECTED"],
  INSPECTED: ["COMPLETED"],
  REJECTED: [],
  COMPLETED: [],
  CANCELLED: [],
};

async function move(tx: Tx, id: string, from: ReturnStatus, to: ReturnStatus, actor: Actor, note?: string | null, data: Record<string, unknown> = {}) {
  if (!NEXT[from].includes(to)) throw unprocessable("INVALID_TRANSITION", `Return cannot move from ${from} to ${to}`);
  const r = await tx.returnRequest.update({ where: { id }, data: { status: to, ...data } });
  await tx.returnStatusHistory.create({ data: { returnId: id, fromStatus: from, toStatus: to, userId: actor.userId, note: note ?? null } });
  await audit(tx, { userId: actor.userId, action: `return.${to.toLowerCase()}`, entityType: "ReturnRequest", entityId: id, before: { status: from }, after: { status: to }, reason: note ?? null, ip: actor.ip });
  return r;
}

const lock = (tx: Tx, id: string) => tx.$queryRaw`SELECT id FROM "ReturnRequest" WHERE id = ${id} FOR UPDATE`;

export interface CreateReturnInput {
  orderId: string;
  type: "RETURN" | "EXCHANGE";
  reason: string;
  customerNote?: string | null;
  items: { orderItemId: string; quantity: number }[];
}

export async function createReturn(input: CreateReturnInput, actor: Actor) {
  const ret = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${input.orderId} FOR UPDATE`;
    const order = assertFound(await tx.order.findUnique({ where: { id: input.orderId }, include: { items: true, returns: { include: { items: true } } } }), "Order");
    if (!RETURNABLE_ORDER.includes(order.status)) {
      throw unprocessable("ORDER_NOT_RETURNABLE", `Only delivered orders can be returned or exchanged (order is ${order.status}); undelivered parcels come back as RTO automatically`);
    }
    if (!input.items.length) throw badRequest("Select at least one item");
    for (const it of input.items) {
      const line = order.items.find((i) => i.id === it.orderItemId);
      if (!line) throw badRequest("Item does not belong to this order");
      const already = order.returns
        .filter((r) => !["REJECTED", "CANCELLED"].includes(r.status))
        .flatMap((r) => r.items)
        .filter((ri) => ri.orderItemId === it.orderItemId)
        .reduce((n, ri) => n + ri.quantity, 0);
      if (it.quantity < 1 || it.quantity + already > line.quantity) {
        throw badRequest(`Cannot return ${it.quantity} × ${line.productName}; ${line.quantity - already} remaining`);
      }
    }
    const created = await tx.returnRequest.create({
      data: {
        returnNumber: await nextReturnNumber(tx),
        orderId: order.id,
        type: input.type,
        reason: input.reason,
        customerNote: input.customerNote ?? null,
        requestedById: actor.userId,
        items: { create: input.items.map((i) => ({ orderItemId: i.orderItemId, quantity: i.quantity })) },
        history: { create: { toStatus: "REQUESTED", userId: actor.userId, note: input.reason } },
      },
    });
    await changeStatus(order.id, input.type === "RETURN" ? "RETURN_REQUESTED" : "EXCHANGE_REQUESTED", { ...systemActor("USER"), userId: actor.userId }, { reason: `${created.returnNumber}: ${input.reason}` }, tx);
    await audit(tx, { userId: actor.userId, action: "return.requested", entityType: "ReturnRequest", entityId: created.id, after: { orderId: order.id, type: input.type, items: input.items }, reason: input.reason, ip: actor.ip });
    return created;
  });
  await notifyStaff("return.requested", { title: `${ret.type === "RETURN" ? "Return" : "Exchange"} requested (${ret.returnNumber})`, body: input.reason, link: `/returns/${ret.id}`, dedupeKey: `return-requested:${ret.id}` });
  return ret;
}

/** When a return closes without goods coming back, the order goes back to DELIVERED. */
async function restoreOrderIfIdle(tx: Tx, orderId: string, actor: Actor, reason: string) {
  const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, include: { returns: true } });
  const open = order.returns.some((r) => !["REJECTED", "CANCELLED", "COMPLETED"].includes(r.status));
  if (!open && (order.status === "RETURN_REQUESTED" || order.status === "EXCHANGE_REQUESTED")) {
    await changeStatus(orderId, "DELIVERED", { ...systemActor("USER"), userId: actor.userId }, { reason }, tx);
  }
}

export async function decideReturn(id: string, approve: boolean, actor: Actor, note: string | null, returnShippingCost?: string) {
  return prisma.$transaction(async (tx) => {
    await lock(tx, id);
    const r = assertFound(await tx.returnRequest.findUnique({ where: { id } }), "Return");
    if (approve) {
      return move(tx, id, r.status, "APPROVED", actor, note, {
        approvedById: actor.userId, approvedAt: new Date(),
        ...(returnShippingCost !== undefined ? { returnShippingCost: money(returnShippingCost) } : {}),
      });
    }
    if (!note?.trim()) throw badRequest("A rejection reason is required");
    const updated = await move(tx, id, r.status, "REJECTED", actor, note, { rejectedReason: note });
    await restoreOrderIfIdle(tx, r.orderId, actor, `Return ${r.returnNumber} rejected`);
    return updated;
  });
}

export async function cancelReturn(id: string, actor: Actor, note: string) {
  return prisma.$transaction(async (tx) => {
    await lock(tx, id);
    const r = assertFound(await tx.returnRequest.findUnique({ where: { id } }), "Return");
    const updated = await move(tx, id, r.status, "CANCELLED", actor, note);
    await restoreOrderIfIdle(tx, r.orderId, actor, `Return ${r.returnNumber} cancelled`);
    return updated;
  });
}

export async function markInTransit(id: string, actor: Actor, opts: { pickupBooked?: boolean; note?: string | null }) {
  return prisma.$transaction(async (tx) => {
    await lock(tx, id);
    const r = assertFound(await tx.returnRequest.findUnique({ where: { id } }), "Return");
    const to: ReturnStatus = opts.pickupBooked ? "PICKUP_BOOKED" : "IN_TRANSIT";
    const updated = await move(tx, id, r.status, to, actor, opts.note);
    const order = await tx.order.findUniqueOrThrow({ where: { id: r.orderId } });
    if (to === "IN_TRANSIT" && r.type === "RETURN" && order.status === "RETURN_REQUESTED") {
      await changeStatus(order.id, "RETURN_IN_TRANSIT", { ...systemActor("USER"), userId: actor.userId }, { reason: `${r.returnNumber} on the way back` }, tx);
    }
    return updated;
  });
}

/** Goods physically received: stock goes to the "returned" bucket pending inspection; return shipping is an expense. */
export async function receiveReturn(id: string, actor: Actor, opts: { returnShippingCost?: string; note?: string | null }) {
  return prisma.$transaction(async (tx) => {
    await lock(tx, id);
    const r = assertFound(await tx.returnRequest.findUnique({ where: { id }, include: { items: { include: { orderItem: true } }, order: true } }), "Return");
    const cost = opts.returnShippingCost !== undefined ? money(opts.returnShippingCost) : money(r.returnShippingCost);
    const now = new Date();
    const updated = await move(tx, id, r.status, "RECEIVED", actor, opts.note, { receivedAt: now, returnShippingCost: cost });
    await receiveReturned(tx, r.id, r.orderId, r.items.map((i) => ({ variantId: i.orderItem.variantId, quantity: i.quantity })), actor.userId);
    if (cost.greaterThan(0)) {
      await postEntries(tx, [{ type: "RETURN_FEE", amount: cost.negated(), date: now, orderId: r.orderId, description: `Return shipping ${r.returnNumber}`, key: `return:${r.id}:shipping`, createdById: actor.userId }]);
    }
    // a full return closes the order as RETURNED; partial returns leave it DELIVERED
    if (r.type === "RETURN") {
      const order = await tx.order.findUniqueOrThrow({ where: { id: r.orderId }, include: { items: true, returns: { include: { items: true } } } });
      const returnedQty = order.returns.filter((x) => ["RECEIVED", "INSPECTED", "COMPLETED"].includes(x.status) || x.id === r.id).flatMap((x) => x.items).reduce((n, i) => n + i.quantity, 0);
      const orderedQty = order.items.reduce((n, i) => n + i.quantity, 0);
      const sys = { ...systemActor("USER"), userId: actor.userId };
      if (returnedQty >= orderedQty) {
        if (order.status === "RETURN_REQUESTED") await changeStatus(order.id, "RETURN_IN_TRANSIT", sys, { reason: r.returnNumber }, tx);
        const fresh = await tx.order.findUniqueOrThrow({ where: { id: order.id } });
        if (fresh.status === "RETURN_IN_TRANSIT") await changeStatus(order.id, "RETURNED", sys, { reason: `${r.returnNumber} received` }, tx);
      }
    }
    return updated;
  });
}

/**
 * Inspection decides what happens to each returned unit. Restocked units recover their cost
 * (RESTOCK_RECOVERY); damaged / disposed units do not.
 */
export async function inspectReturn(
  id: string,
  decisions: { returnItemId: string; condition: "GOOD" | "DAMAGED" | "MISSING"; disposition: "RESTOCK" | "DAMAGED" | "DISPOSE"; notes?: string | null }[],
  actor: Actor,
) {
  return prisma.$transaction(async (tx) => {
    await lock(tx, id);
    const r = assertFound(await tx.returnRequest.findUnique({ where: { id }, include: { items: { include: { orderItem: true } }, order: true } }), "Return");
    if (r.status !== "RECEIVED") throw unprocessable("NOT_RECEIVED", "Items must be received before inspection");
    if (decisions.length !== r.items.length || !r.items.every((i) => decisions.some((d) => d.returnItemId === i.id))) {
      throw badRequest("Provide an inspection decision for every returned item");
    }
    const now = new Date();
    let recovered = money(0);
    for (const d of decisions) {
      const item = r.items.find((i) => i.id === d.returnItemId)!;
      if (d.condition === "MISSING" && d.disposition === "RESTOCK") throw badRequest("Missing items cannot be restocked");
      if (item.orderItem.variantId) {
        await dispositionReturned(tx, item.orderItem.variantId, item.quantity, d.disposition, { returnId: r.id, orderId: r.orderId, userId: actor.userId });
      }
      await tx.returnItem.update({ where: { id: item.id }, data: { condition: d.condition, disposition: d.disposition, inspectedById: actor.userId, inspectedAt: now, notes: d.notes ?? null } });
      if (d.disposition === "RESTOCK") recovered = recovered.plus(money(item.orderItem.unitCost).times(item.quantity));
    }
    // cost recovery only applies to goods whose cost was expensed, i.e. delivered (not RTO) orders
    if (!r.isRto && recovered.greaterThan(0)) {
      await postEntries(tx, [{ type: "RESTOCK_RECOVERY", amount: recovered, date: now, orderId: r.orderId, description: `Restocked items ${r.returnNumber}`, key: `return:${r.id}:restock`, createdById: actor.userId }]);
    }
    return move(tx, id, "RECEIVED", "INSPECTED", actor, null);
  });
}

/** Value of the returned lines as sold (line totals, pro-rata for partial quantities). */
export function returnedValue(items: { quantity: number; orderItem: { quantity: number; lineTotal: unknown } }[]) {
  return sum(items.map((i) => money(i.orderItem.lineTotal as string).times(i.quantity).dividedBy(i.orderItem.quantity)));
}

/**
 * Exchange: create the replacement order. The returned goods' value is credited as a discount;
 * any difference becomes COD to collect (additionalCollection) or a refund request.
 */
export async function createExchangeOrder(
  id: string,
  input: { items: { variantId: string; quantity: number }[]; deliveryCharge?: string; note?: string | null },
  actor: Actor,
) {
  const r = assertFound(await prisma.returnRequest.findUnique({ where: { id }, include: { items: { include: { orderItem: true } }, order: { include: { customer: true } } } }), "Return");
  if (r.type !== "EXCHANGE") throw badRequest("Only exchange requests create replacement orders");
  if (!["APPROVED", "PICKUP_BOOKED", "IN_TRANSIT", "RECEIVED", "INSPECTED"].includes(r.status)) throw unprocessable("NOT_APPROVED", "Approve the exchange first");
  if (r.exchangeOrderId) throw conflict("A replacement order already exists for this exchange");

  const credit = returnedValue(r.items);
  const o = r.order;
  const variants = await prisma.productVariant.findMany({ where: { id: { in: input.items.map((i) => i.variantId) } }, include: { product: true } });
  const newValue = sum(input.items.map((i) => {
    const v = variants.find((x) => x.id === i.variantId);
    if (!v) throw badRequest("Unknown replacement item");
    return money(v.price ?? v.product.salePrice ?? v.product.regularPrice).times(i.quantity);
  }));
  const discount = credit.greaterThan(newValue) ? newValue : credit;

  const { order } = await createOrder(
    {
      customer: { name: o.customer.name, phone: o.customer.phone, email: o.customer.email },
      shipping: { name: o.shippingName, phone: o.shippingPhone, addressLine: o.shippingAddress, districtId: o.districtId, areaId: o.areaId, districtName: o.districtName, areaName: o.areaName, note: input.note ?? `Exchange for ${o.orderNumber}` },
      items: input.items,
      discount: discount.toFixed(2),
      deliveryCharge: input.deliveryCharge,
      paymentMethod: "COD",
      channel: o.channel,
      note: `Exchange replacement for ${o.orderNumber} (${r.returnNumber}); credit ৳${credit.toFixed(2)}`,
    },
    actor,
  );

  await prisma.$transaction(async (tx) => {
    await tx.order.update({ where: { id: order.id }, data: { sourceOrderId: o.id } });
    await tx.returnRequest.update({
      where: { id: r.id },
      data: { exchangeOrderId: order.id, additionalCollection: money(order.total), refundAmount: credit.minus(discount) },
    });
    const fresh = await tx.order.findUniqueOrThrow({ where: { id: o.id } });
    if (fresh.status === "EXCHANGE_REQUESTED") {
      await changeStatus(o.id, "EXCHANGED", { ...systemActor("USER"), userId: actor.userId }, { reason: `Replacement order ${order.orderNumber}` }, tx);
    }
    await audit(tx, { userId: actor.userId, action: "return.exchange_order_created", entityType: "ReturnRequest", entityId: r.id, after: { exchangeOrderId: order.id, credit: credit.toFixed(2), newValue: newValue.toFixed(2) }, ip: actor.ip });
  });
  return { exchangeOrder: order, credit: credit.toFixed(2), newItemsValue: newValue.toFixed(2), customerOwes: money(order.total).toFixed(2), refundDue: credit.minus(discount).toFixed(2) };
}

/** Close a return once inspected and money is settled (refund paid / exchange created). */
export async function completeReturn(id: string, actor: Actor) {
  return prisma.$transaction(async (tx) => {
    await lock(tx, id);
    const r = assertFound(await tx.returnRequest.findUnique({ where: { id }, include: { refunds: true } }), "Return");
    if (r.status !== "INSPECTED") throw unprocessable("NOT_INSPECTED", "Inspect the returned items first");
    if (r.refunds.some((f) => f.status === "PENDING" || f.status === "APPROVED")) throw unprocessable("REFUND_OPEN", "Pay or reject the open refund first");
    if (r.type === "EXCHANGE" && !r.exchangeOrderId) throw unprocessable("EXCHANGE_OPEN", "Create the replacement order first");
    const updated = await move(tx, id, "INSPECTED", "COMPLETED", actor, null, { completedAt: new Date() });
    const order = await tx.order.findUniqueOrThrow({ where: { id: r.orderId }, include: { returns: true } });
    if (!order.returns.some((x) => !["REJECTED", "CANCELLED", "COMPLETED"].includes(x.status))) {
      const anySettled = await tx.financialEntry.count({ where: { orderId: order.id, type: { in: ["SETTLEMENT_RECEIVED"] } } });
      if (anySettled || order.status === "RETURNED") await tx.order.update({ where: { id: order.id }, data: { financeStatus: "RECONCILED" } });
    }
    return updated;
  });
}
