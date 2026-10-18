import { onOrderEvent } from "../orders/order-events.js";
import { queuePurchaseEvent } from "./meta-capi.js";

/**
 * Server-side Purchase triggers (all idempotent – the event id is unique per order and MetaEventLog stores it once):
 *  - order.created: customer website order paid by cash on delivery → Purchase now (the browser fires the same event_id);
 *  - order.status_changed → CONFIRMED: an online-payment website order that was never paid but which staff
 *    confirmed (the customer switched to COD) → Purchase, server side only;
 *  - online payment verified: queued from the payments module.
 * Staff-created orders (phone, Facebook inbox, manual) are never sent: they are not website conversions.
 */
export async function onOrderCreatedForMeta(orderId: string) {
  return queuePurchaseEvent(orderId);
}

/** Registers order-event listeners for this module. Called once at app start (src/app.ts). */
export function registerListeners() {
  onOrderEvent(async (event) => {
    if (event.type === "order.created") await queuePurchaseEvent(event.orderId);
    if (event.type === "order.status_changed" && event.to === "CONFIRMED") await queuePurchaseEvent(event.orderId);
  });
}
