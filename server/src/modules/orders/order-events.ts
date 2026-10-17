import { EventEmitter } from "node:events";
import { logger } from "../../lib/logger.js";
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
  setImmediate(() => bus.emit("order", event));
}

export function onOrderEvent(listener: (event: OrderEvent) => Promise<void> | void) {
  bus.on("order", (event: OrderEvent) => {
    Promise.resolve()
      .then(() => listener(event))
      .catch((err) => logger.error({ err, event }, "order event listener failed"));
  });
}
