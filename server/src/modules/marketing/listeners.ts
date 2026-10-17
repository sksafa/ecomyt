import { prisma } from "../../lib/prisma.js";
import { onOrderEvent } from "../orders/order-events.js";
import { queuePurchaseEvent } from "./meta-capi.js";

/**
 * Purchase is sent to Meta when a customer places an order on the website (channel WEBSITE and not
 * created by a staff user). That is the moment the browser Pixel fires with the same event_id
 * (`purchase:<orderId>`), so Meta deduplicates the pair, and it is what Meta's delivery optimises on.
 * Staff-created / manual / phone orders are never sent. Because many Bangladesh COD orders are
 * cancelled or returned, delivered-only results are reported separately (GET /marketing/reconciliation
 * and /marketing/attribution) – platform numbers are never mixed into verified revenue.
 * Orders without attribution are still sent (the Pixel fired for them too); the event then simply
 * carries no fbc/fbp. Nothing leaves the server unless meta.capiEnabled + credentials are set.
 */
export async function onOrderCreatedForMeta(orderId: string) {
  const order = await prisma.order.findUnique({ where: { id: orderId }, select: { channel: true, createdById: true } });
  if (!order || order.channel !== "WEBSITE" || order.createdById) return null;
  return queuePurchaseEvent(orderId);
}

/** Registers order-event listeners for this module. Called once at app start (src/app.ts). */
export function registerListeners() {
  onOrderEvent(async (event) => {
    if (event.type === "order.created") await onOrderCreatedForMeta(event.orderId);
  });
}
