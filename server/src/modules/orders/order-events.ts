import { EventEmitter } from "node:events";
import { logger } from "../../lib/logger.js";
import { prisma } from "../../lib/prisma.js";
import { publishRealtime } from "../../lib/realtime.js";
import type { OrderStatus } from "../../generated/prisma/enums.js";

export type OrderEvent =
  | { type: "order.created"; orderId: string }
  | { type: "order.updated"; orderId: string }
  | { type: "order.status_changed"; orderId: string; from: OrderStatus; to: OrderStatus };

/**
 * In-process bus for side effects that must happen only after the DB transaction commits
 * (notifications, Meta CAPI, …). Listeners must be idempotent and must never throw into callers.
 */
const bus = new EventEmitter();
bus.setMaxListeners(50);

export function emitOrderEvent(event: OrderEvent) {
  setImmediate(() => {
    bus.emit("order", event);
    void publishOrderToAdmins(event);
  });
}

/** Live update for open admin screens (see lib/realtime.ts). Runs after commit, so a refetch sees the change. */
async function publishOrderToAdmins(event: OrderEvent) {
  try {
    const o = await prisma.order.findUnique({
      where: { id: event.orderId },
      select: { orderNumber: true, status: true, channel: true, shippingName: true, total: true },
    });
    if (!o) return;
    publishRealtime({
      topic: "orders",
      type: event.type,
      orderId: event.orderId,
      orderNumber: o.orderNumber,
      status: o.status,
      ...(event.type === "order.status_changed" ? { from: event.from } : {}),
      channel: o.channel,
      name: o.shippingName,
      total: o.total.toFixed(2),
    });
  } catch (err) {
    logger.warn({ err, event }, "realtime order publish failed");
  }
}

export function onOrderEvent(listener: (event: OrderEvent) => Promise<void> | void) {
  bus.on("order", (event: OrderEvent) => {
    Promise.resolve()
      .then(() => listener(event))
      .catch((err) => logger.error({ err, event }, "order event listener failed"));
  });
}
