import { prisma, Prisma, type Tx } from "../../lib/prisma.js";
import { assertFound, AppError, conflict, unprocessable } from "../../lib/errors.js";
import { money } from "../../lib/money.js";
import { sha256 } from "../../lib/crypto.js";
import { audit } from "../../lib/audit.js";
import { logger } from "../../lib/logger.js";
import { enqueue, QUEUES } from "../../jobs/queues.js";
import type { ShipmentStatus, OrderStatus } from "../../generated/prisma/enums.js";
import { changeStatus, systemActor, type Actor } from "../orders/orders.service.js";
import { postEntries } from "../finance/ledger.service.js";
import { contextFor, getAdapter, resolveProvider } from "./registry.js";
import { CourierError, type CourierAdapter, type ShipmentUpdate, type WebhookRequest } from "./types.js";
import { notifyStaff } from "../notifications/notify.js";

export const MAX_BOOKING_ATTEMPTS = 5;
const BOOKABLE: OrderStatus[] = ["CONFIRMED", "PROCESSING", "READY_TO_SHIP"];
const ACTIVE_EXCLUDED: ShipmentStatus[] = ["CANCELLED", "FAILED"];

/** Monotonic progress rank; updates that would move a shipment backwards are recorded but not applied. */
const RANK: Record<ShipmentStatus, number> = {
  PENDING: 0, FAILED: 0, BOOKED: 1, PICKED_UP: 2, IN_TRANSIT: 3, RETURNING: 4,
  PARTIALLY_DELIVERED: 5, DELIVERED: 5, RETURNED: 6, CANCELLED: 6,
};

export interface BookOptions {
  providerId?: string | null;
  weightGrams?: number;
  note?: string | null;
}

// ───────────── booking ─────────────

/** Merchant reference sent to the courier: order number, suffixed from the 2nd booking attempt on. */
export function referenceFor(idempotencyKey: string, orderNumber: string) {
  const attempt = Number(idempotencyKey.split(":").pop());
  return attempt > 1 ? `${orderNumber}-${attempt}` : orderNumber;
}

export async function bookShipment(orderId: string, opts: BookOptions, actor: Actor) {
  const { provider, adapter } = await resolveProvider(opts.providerId);
  if (!adapter.capabilities.createShipment) throw unprocessable("UNSUPPORTED", `${provider.name} does not support creating shipments via API`);

  const order = assertFound(await prisma.order.findUnique({ where: { id: orderId }, include: { items: true, shipments: true } }), "Order");
  const active = order.shipments.find((s) => !s.isReturn && !ACTIVE_EXCLUDED.includes(s.status));
  if (active) {
    if (active.status === "PENDING") return { shipment: active, alreadyBooked: false, pending: true };
    return { shipment: active, alreadyBooked: true, pending: false };
  }
  if (!BOOKABLE.includes(order.status)) {
    throw unprocessable("ORDER_NOT_READY", `Orders in ${order.status} cannot be booked; confirm the order first`);
  }

  const attempt = order.shipments.filter((s) => !s.isReturn).length + 1;
  const reference = referenceFor(`x:${attempt}`, order.orderNumber);
  let shipment;
  try {
    shipment = await prisma.shipment.create({
      data: {
        orderId: order.id,
        providerId: provider.id,
        status: "PENDING",
        idempotencyKey: `order:${order.id}:fwd:${attempt}`,
        codAmount: money(order.codAmount),
        weightGrams: opts.weightGrams ?? Math.max(order.weightGrams, 100),
        note: opts.note ?? order.deliveryNote,
        createdById: actor.userId,
      },
    });
  } catch (err) {
    // the partial unique index rejected a second live shipment (double click / concurrent request)
    if ((err as { code?: string }).code === "P2002") {
      const existing = await prisma.shipment.findFirst({ where: { orderId, isReturn: false, status: { notIn: ACTIVE_EXCLUDED } } });
      if (existing) return { shipment: existing, alreadyBooked: existing.status !== "PENDING", pending: existing.status === "PENDING" };
    }
    throw err;
  }
  await audit(prisma, { userId: actor.userId, action: "shipment.booking_requested", entityType: "Order", entityId: order.id, after: { provider: provider.code, reference }, ip: actor.ip });

  const result = await attemptBooking(shipment.id, reference, actor);
  return { shipment: result, alreadyBooked: false, pending: result.status === "PENDING" };
}

/**
 * One booking attempt. Before re-sending a create request we ask the courier whether a parcel with
 * our reference already exists (the previous response may have been lost), so retries never create
 * duplicate parcels.
 */
export async function attemptBooking(shipmentId: string, reference: string, actor: Actor = systemActor()) {
  const shipment = await prisma.shipment.findUniqueOrThrow({ where: { id: shipmentId }, include: { provider: true, order: { include: { items: true } } } });
  if (shipment.status !== "PENDING") return shipment;
  const adapter = getAdapter(shipment.provider.code)!;
  const ctx = contextFor(shipment.provider, shipment.id);
  const order = shipment.order;

  try {
    let created = shipment.attempts > 0 && adapter.findByReference ? await adapter.findByReference(ctx, reference) : null;
    if (!created) {
      created = await adapter.createShipment(ctx, {
        merchantReference: reference,
        recipientName: order.shippingName,
        recipientPhone: order.shippingPhone,
        recipientAddress: [order.shippingAddress, order.areaName, order.districtName].filter(Boolean).join(", "),
        districtName: order.districtName,
        areaName: order.areaName,
        codAmount: money(order.codAmount).toFixed(2),
        weightGrams: shipment.weightGrams,
        itemDescription: order.items.map((i) => `${i.productName}${i.variantName ? ` (${i.variantName})` : ""} x${i.quantity}`).join(", ").slice(0, 250),
        itemQuantity: order.items.reduce((n, i) => n + i.quantity, 0),
        note: shipment.note,
      });
    }

    return await prisma.$transaction(async (tx) => {
      const updated = await tx.shipment.update({
        where: { id: shipment.id },
        data: {
          status: "BOOKED",
          rawStatus: created!.rawStatus ?? "booked",
          consignmentId: created!.consignmentId,
          trackingCode: created!.trackingCode,
          labelUrl: created!.labelUrl ?? null,
          deliveryFee: created!.deliveryFee != null ? money(created!.deliveryFee) : undefined,
          codCharge: created!.codCharge != null ? money(created!.codCharge) : undefined,
          attempts: { increment: 1 },
          lastError: null,
          nextRetryAt: null,
          bookedAt: new Date(),
        },
      });
      const current = await tx.order.findUniqueOrThrow({ where: { id: order.id } });
      const sys = { ...systemActor("SYSTEM"), userId: actor.userId };
      if (current.status === "CONFIRMED" || current.status === "PROCESSING") await changeStatus(order.id, "READY_TO_SHIP", sys, { reason: "Courier booking" }, tx);
      await changeStatus(order.id, "COURIER_BOOKED", sys, { reason: `Booked with ${shipment.provider.name} (${created!.trackingCode ?? created!.consignmentId})` }, tx);
      await audit(tx, { userId: actor.userId, action: "shipment.booked", entityType: "Shipment", entityId: shipment.id, after: { consignmentId: created!.consignmentId, trackingCode: created!.trackingCode } });
      return updated;
    });
  } catch (err) {
    const retryable = err instanceof CourierError ? err.retryable : false;
    const attempts = shipment.attempts + 1;
    const giveUp = !retryable || attempts >= MAX_BOOKING_ATTEMPTS;
    const delayMs = Math.min(30 * 60_000, 30_000 * 2 ** (attempts - 1));
    const message = err instanceof Error ? err.message : String(err);
    const updated = await prisma.shipment.update({
      where: { id: shipment.id },
      data: {
        attempts,
        lastError: message.slice(0, 500),
        status: giveUp ? "FAILED" : "PENDING",
        nextRetryAt: giveUp ? null : new Date(Date.now() + delayMs),
      },
    });
    if (giveUp) {
      await notifyStaff("courier.booking_failed", {
        title: `Courier booking failed for ${order.orderNumber}`,
        body: `${shipment.provider.name}: ${message}`,
        link: `/orders/${order.id}`,
        dedupeKey: `courier-failed:${shipment.id}`,
      });
    } else {
      await enqueue(QUEUES.courier, "retry-booking", { shipmentId: shipment.id, reference }, { jobId: `book-${shipment.id}-${attempts}`, delay: delayMs, attempts: 1 });
    }
    if (!(err instanceof CourierError)) logger.error({ err, shipmentId }, "unexpected courier booking error");
    return updated;
  }
}

// ───────────── status updates (webhooks / polling) ─────────────

export async function applyShipmentUpdate(shipmentId: string, update: ShipmentUpdate, source: string, tx?: Tx) {
  const run = async (db: Tx) => {
    await db.$queryRaw`SELECT id FROM "Shipment" WHERE id = ${shipmentId} FOR UPDATE`;
    const s = await db.shipment.findUniqueOrThrow({ where: { id: shipmentId }, include: { order: true, provider: true } });

    // fees can arrive with any event, even a stale one
    const fees: Prisma.ShipmentUpdateInput = {
      ...(update.deliveryFee != null ? { deliveryFee: money(update.deliveryFee) } : {}),
      ...(update.codCharge != null ? { codCharge: money(update.codCharge) } : {}),
      ...(update.returnFee != null ? { returnFee: money(update.returnFee) } : {}),
      ...(update.collectedAmount != null ? { collectedAmount: money(update.collectedAmount) } : {}),
    };
    // a courier "cancel" after pickup means the parcel is coming back to us
    const next = update.status === "CANCELLED" && RANK[s.status] > RANK.BOOKED ? "RETURNING" : update.status;
    const advances = next !== null && RANK[next] > RANK[s.status] && !(next === "CANCELLED" && RANK[s.status] > RANK.BOOKED);

    if (!advances) {
      if (Object.keys(fees).length) await db.shipment.update({ where: { id: s.id }, data: fees });
      return { applied: false, shipment: s };
    }

    const now = update.occurredAt;
    const updated = await db.shipment.update({
      where: { id: s.id },
      data: {
        ...fees,
        status: next,
        rawStatus: update.rawStatus,
        lastEventAt: now,
        ...(next === "PICKED_UP" ? { pickedUpAt: now } : {}),
        ...(next === "DELIVERED" || next === "PARTIALLY_DELIVERED" ? { deliveredAt: now } : {}),
        ...(next === "RETURNED" ? { returnedAt: now } : {}),
      },
    });

    // drive the order through the matching workflow steps
    const actor = systemActor("COURIER");
    const reason = `${s.provider.name}: ${update.rawStatus}`;
    const order = await db.order.findUniqueOrThrow({ where: { id: s.orderId } });
    const step = async (to: OrderStatus, extra: { collectedAmount?: string | null } = {}) => {
      const fresh = await db.order.findUniqueOrThrow({ where: { id: s.orderId } });
      if (fresh.status !== to) await changeStatus(s.orderId, to, actor, { reason, occurredAt: now, ...extra }, db);
    };
    if (!s.isReturn) {
      if ((next === "PICKED_UP" || next === "IN_TRANSIT") && order.status === "COURIER_BOOKED") await step("SHIPPED");
      if (next === "DELIVERED" || next === "PARTIALLY_DELIVERED") {
        if (order.status === "COURIER_BOOKED") await step("SHIPPED");
        if (["SHIPPED", "COURIER_BOOKED"].includes((await db.order.findUniqueOrThrow({ where: { id: s.orderId } })).status)) {
          await step("DELIVERED", { collectedAmount: update.collectedAmount ?? null });
        }
      }
      if (next === "RETURNING" && ["COURIER_BOOKED", "SHIPPED"].includes(order.status)) await step("RETURN_IN_TRANSIT");
      if (next === "RETURNED" && ["COURIER_BOOKED", "SHIPPED", "RETURN_IN_TRANSIT"].includes(order.status)) await step("RETURNED");
      if (next === "CANCELLED" && order.status === "COURIER_BOOKED") await step("READY_TO_SHIP");
    }

    await postShipmentFees(db, updated.id);
    return { applied: true, shipment: updated };
  };
  return tx ? run(tx) : prisma.$transaction(run, { maxWait: 10_000, timeout: 30_000 });
}

/**
 * Courier charges become expenses once the parcel reaches a final state and the fee is known.
 * Idempotency keys guarantee each fee is booked once per shipment.
 */
export async function postShipmentFees(db: Tx, shipmentId: string) {
  const s = await db.shipment.findUniqueOrThrow({ where: { id: shipmentId }, include: { order: true } });
  const final = ["DELIVERED", "PARTIALLY_DELIVERED", "RETURNED"].includes(s.status);
  if (!final) return;
  const date = s.deliveredAt ?? s.returnedAt ?? new Date();
  const base = { orderId: s.orderId, shipmentId: s.id, date };
  await postEntries(db, [
    ...(s.deliveryFee != null ? [{ ...base, type: "COURIER_FEE" as const, amount: money(s.deliveryFee).negated(), description: `Courier fee ${s.order.orderNumber}`, key: `shipment:${s.id}:delivery_fee` }] : []),
    ...(s.codCharge != null && s.status !== "RETURNED" ? [{ ...base, type: "COD_FEE" as const, amount: money(s.codCharge).negated(), description: `COD charge ${s.order.orderNumber}`, key: `shipment:${s.id}:cod_fee` }] : []),
    ...(s.returnFee != null && s.status === "RETURNED" ? [{ ...base, type: "RETURN_FEE" as const, amount: money(s.returnFee).negated(), description: `Return charge ${s.order.orderNumber}`, key: `shipment:${s.id}:return_fee` }] : []),
  ]);
}

/** Verify, de-duplicate and apply courier webhook events. Returns counts for the response. */
export async function handleWebhook(providerCode: string, req: WebhookRequest) {
  const provider = await prisma.courierProvider.findUnique({ where: { code: providerCode } });
  const adapter = provider ? getAdapter(provider.code) : null;
  if (!provider || !adapter || !adapter.capabilities.webhooks || !adapter.parseWebhook) {
    throw new AppError(404, "NOT_FOUND", "Unknown webhook endpoint");
  }
  const ctx = contextFor(provider);
  if (!adapter.verifyWebhook || !adapter.verifyWebhook(ctx, req)) {
    throw new AppError(401, "INVALID_SIGNATURE", "Webhook authentication failed");
  }
  const handshake = adapter.webhookHandshake?.(ctx, req);
  if (handshake) return { handshake, received: 0, applied: 0, duplicates: 0, unmatched: 0 };

  const events = adapter.parseWebhook(ctx, req);
  let applied = 0;
  let duplicates = 0;
  let unmatched = 0;
  for (const e of events) {
    // a provider event id identifies a delivery uniquely; otherwise use parcel + status + time
    const dedupeKey = sha256(
      e.eventId
        ? `${provider.id}|event|${e.eventId}`
        : `${provider.id}|${e.consignmentId ?? e.trackingCode ?? e.merchantReference ?? ""}|${e.rawStatus}|${e.occurredAt.toISOString()}`,
    );
    const shipment = await prisma.shipment.findFirst({
      where: {
        providerId: provider.id,
        OR: [
          ...(e.consignmentId ? [{ consignmentId: e.consignmentId }] : []),
          ...(e.trackingCode ? [{ trackingCode: e.trackingCode }] : []),
          ...(e.merchantReference ? [{ order: { orderNumber: e.merchantReference.replace(/-\d+$/, "") } }] : []),
        ],
      },
      orderBy: { createdAt: "desc" },
    });

    let event;
    try {
      event = await prisma.courierEvent.create({
        data: {
          providerId: provider.id, shipmentId: shipment?.id ?? null, dedupeKey, rawStatus: e.rawStatus, mappedStatus: e.status,
          payload: e.payload as Prisma.InputJsonValue, occurredAt: e.occurredAt,
        },
      });
    } catch (err) {
      if ((err as { code?: string }).code === "P2002") {
        duplicates++;
        continue;
      }
      throw err;
    }
    if (!shipment) {
      unmatched++;
      await prisma.courierEvent.update({ where: { id: event.id }, data: { processedAt: new Date(), error: "No matching shipment" } });
      continue;
    }
    try {
      // unsigned webhooks are only a hint: take status and fees from the courier API instead
      let update = e as import("./types.js").ShipmentUpdate;
      if (adapter.confirmWebhooksViaApi && adapter.track) {
        const s = await prisma.shipment.findUniqueOrThrow({ where: { id: shipment.id }, include: { order: true } });
        update = await adapter.track(contextFor(provider, shipment.id), { consignmentId: s.consignmentId, trackingCode: s.trackingCode, merchantReference: s.order.orderNumber });
      } else if (adapter.confirmWebhooksViaApi) {
        update = { ...e, deliveryFee: null, codCharge: null, returnFee: null, collectedAmount: null };
      }
      const r = await applyShipmentUpdate(shipment.id, update, "webhook");
      if (r.applied) applied++;
      await prisma.courierEvent.update({ where: { id: event.id }, data: { processedAt: new Date(), applied: r.applied } });
    } catch (err) {
      await prisma.courierEvent.update({ where: { id: event.id }, data: { processedAt: new Date(), error: (err as Error).message.slice(0, 500) } });
      logger.error({ err, eventId: event.id }, "courier webhook processing failed");
    }
  }
  return { received: events.length, applied, duplicates, unmatched };
}

/** Pull the latest status from the courier (for providers without webhooks, or manual refresh). */
export async function syncShipment(shipmentId: string) {
  const s = await prisma.shipment.findUniqueOrThrow({ where: { id: shipmentId }, include: { provider: true, order: true } });
  const adapter = getAdapter(s.provider.code);
  if (!adapter?.track || !adapter.capabilities.trackShipment) throw unprocessable("UNSUPPORTED", `${s.provider.name} does not support tracking via API`);
  if (!s.consignmentId && !s.trackingCode) throw unprocessable("NOT_BOOKED", "Shipment has no consignment yet");
  const update = await adapter.track(contextFor(s.provider, s.id), { consignmentId: s.consignmentId, trackingCode: s.trackingCode, merchantReference: s.order.orderNumber });
  await prisma.courierEvent.create({
    data: {
      providerId: s.providerId, shipmentId: s.id, rawStatus: update.rawStatus, mappedStatus: update.status, payload: { source: "poll" },
      occurredAt: update.occurredAt, dedupeKey: sha256(`${s.id}|poll|${update.rawStatus}|${Math.floor(Date.now() / 60_000)}`),
    },
  }).catch(() => {});
  return applyShipmentUpdate(s.id, update, "poll");
}

// ───────────── cancellation ─────────────

export async function cancelShipment(shipmentId: string, reason: string, actor: Actor, opts: { manual?: boolean } = {}) {
  const s = assertFound(await prisma.shipment.findUnique({ where: { id: shipmentId }, include: { provider: true, order: true } }), "Shipment");
  if (["CANCELLED", "FAILED"].includes(s.status)) return s;
  if (RANK[s.status] > RANK.BOOKED) throw conflict("The parcel has already been picked up – request a return instead");
  const adapter = getAdapter(s.provider.code);

  // a PENDING booking may already exist at the courier if an earlier response was lost
  if (s.status === "PENDING" && s.attempts > 0 && !opts.manual && adapter?.findByReference) {
    const ghost = await adapter.findByReference(contextFor(s.provider, s.id), referenceFor(s.idempotencyKey, s.order.orderNumber));
    if (ghost) {
      if (!adapter.cancel || !adapter.capabilities.cancelShipment) {
        throw unprocessable("UNSUPPORTED", `A parcel was created at ${s.provider.name}; cancel it in the courier portal, then mark it cancelled here.`);
      }
      await adapter.cancel(contextFor(s.provider, s.id), { consignmentId: ghost.consignmentId, trackingCode: ghost.trackingCode, merchantReference: referenceFor(s.idempotencyKey, s.order.orderNumber) });
    }
  }

  if (s.status === "BOOKED" && !opts.manual) {
    if (!adapter?.cancel || !adapter.capabilities.cancelShipment) {
      throw unprocessable("UNSUPPORTED", `${s.provider.name} does not support cancellation via API. Cancel it in the courier portal, then mark it cancelled here.`);
    }
    await adapter.cancel(contextFor(s.provider, s.id), { consignmentId: s.consignmentId, trackingCode: s.trackingCode, merchantReference: s.order.orderNumber });
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.shipment.update({ where: { id: s.id }, data: { status: "CANCELLED", rawStatus: opts.manual ? "cancelled_manually" : "cancelled", nextRetryAt: null } });
    const order = await tx.order.findUniqueOrThrow({ where: { id: s.orderId } });
    if (order.status === "COURIER_BOOKED") {
      await changeStatus(order.id, "READY_TO_SHIP", { ...systemActor("SYSTEM"), userId: actor.userId }, { reason: `Shipment cancelled: ${reason}` }, tx);
    }
    await audit(tx, { userId: actor.userId, action: opts.manual ? "shipment.marked_cancelled" : "shipment.cancelled", entityType: "Shipment", entityId: s.id, reason, ip: actor.ip });
    return updated;
  });
}

/** Retry worker entry point (BullMQ). */
export async function retryBookingJob(data: { shipmentId: string; reference: string }) {
  const s = await prisma.shipment.findUnique({ where: { id: data.shipmentId } });
  if (!s || s.status !== "PENDING") return;
  await attemptBooking(s.id, data.reference);
}

export type { CourierAdapter };
