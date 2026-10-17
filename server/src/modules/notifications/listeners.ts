import { prisma } from "../../lib/prisma.js";
import { getSetting } from "../../lib/settings.js";
import { formatBdt } from "../../lib/money.js";
import { onOrderEvent } from "../orders/order-events.js";
import { notifyStaff } from "./notify.js";
import { alertLowStock, customerStatusSms } from "./alerts.js";

/** New website order → staff in-app alert (orders.confirm audience). */
export async function onOrderCreated(orderId: string) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true, orderNumber: true, channel: true, shippingName: true, total: true, status: true, items: { select: { variantId: true } } },
  });
  if (!order) return;
  const cfg = await getSetting("notifications");
  if (order.channel === "WEBSITE" && cfg.newOrderInApp) {
    await notifyStaff("order.new", {
      title: `New website order ${order.orderNumber}`,
      body: `${order.shippingName} · ${formatBdt(order.total)}${order.status === "CONFIRMATION_REQUIRED" ? " · needs confirmation (risk)" : ""}`,
      link: `/orders/${order.id}`,
      dedupeKey: `order.new:${order.id}`,
    });
  }
  const variantIds = [...new Set(order.items.map((i) => i.variantId).filter((v): v is string => Boolean(v)))];
  await alertLowStock(variantIds);
}

/** Registers order-event listeners for this module. Called once at app start (src/app.ts). */
export function registerListeners() {
  onOrderEvent(async (event) => {
    if (event.type === "order.created") await onOrderCreated(event.orderId);
    else if (event.type === "order.status_changed" && (event.to === "CONFIRMED" || event.to === "SHIPPED")) {
      await customerStatusSms(event.orderId, event.to);
    }
  });
}
