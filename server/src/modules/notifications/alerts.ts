import { prisma, Prisma } from "../../lib/prisma.js";
import { getSetting } from "../../lib/settings.js";
import { dhakaDate } from "../../lib/time.js";
import { formatBdt } from "../../lib/money.js";
import { notifyStaff } from "./notify.js";
import { sendNotification } from "./outbound.service.js";
import type { Lang } from "./templates.js";

export interface LowStockRow {
  variantId: string;
  sku: string;
  variantName: string;
  productName: string;
  available: number;
  threshold: number;
}

/** Active variants of non-archived products whose available stock is at or below their threshold. */
export async function findLowStock(variantIds?: string[]): Promise<LowStockRow[]> {
  if (variantIds && !variantIds.length) return [];
  const filter = variantIds ? Prisma.sql`AND pv."id" IN (${Prisma.join(variantIds)})` : Prisma.empty;
  return prisma.$queryRaw<LowStockRow[]>`
    SELECT pv."id" AS "variantId", pv."sku", pv."name" AS "variantName", p."name" AS "productName",
           il."available", pv."lowStockThreshold" AS "threshold"
    FROM "InventoryLevel" il
    JOIN "ProductVariant" pv ON pv."id" = il."variantId"
    JOIN "Product" p ON p."id" = pv."productId"
    WHERE pv."isActive" = true AND p."archivedAt" IS NULL AND il."available" <= pv."lowStockThreshold" ${filter}
    ORDER BY il."available" ASC, pv."sku" ASC`;
}

/** In-app low-stock alert per variant, at most once per variant per Dhaka day. Returns rows alerted. */
export async function alertLowStock(variantIds?: string[]) {
  const cfg = await getSetting("notifications");
  if (!cfg.lowStockInApp) return [];
  const rows = await findLowStock(variantIds);
  const day = dhakaDate();
  for (const r of rows) {
    await notifyStaff("inventory.low_stock", {
      title: r.available <= 0 ? `Out of stock: ${r.sku}` : `Low stock: ${r.sku}`,
      body: `${r.productName} – ${r.variantName}: ${r.available} available (threshold ${r.threshold})`,
      link: `/inventory?variantId=${r.variantId}`,
      dedupeKey: `low_stock:${r.variantId}:${day}`,
    });
  }
  return rows;
}

/** Customer language for transactional SMS (optional stored setting `notifications.customerSmsLanguage`). */
async function customerLang(): Promise<Lang> {
  const cfg = (await getSetting("notifications")) as { customerSmsLanguage?: string };
  return cfg.customerSmsLanguage === "bn" ? "bn" : "en";
}

/**
 * Transactional customer SMS on order confirmation / shipping, only when enabled in settings
 * (notifications.customerSmsOnConfirm / customerSmsOnShip). Deduped per order + event.
 */
export async function customerStatusSms(orderId: string, status: "CONFIRMED" | "SHIPPED") {
  const cfg = await getSetting("notifications");
  if (status === "CONFIRMED" && !cfg.customerSmsOnConfirm) return null;
  if (status === "SHIPPED" && !cfg.customerSmsOnShip) return null;
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { shipments: { where: { isReturn: false }, orderBy: { createdAt: "desc" }, take: 1, include: { provider: { select: { name: true } } } } },
  });
  if (!order) return null;
  const shipment = order.shipments[0];
  const key = status === "CONFIRMED" ? "order.confirmed" : "order.shipped";
  return sendNotification({
    channel: "SMS",
    recipient: order.shippingPhone,
    type: key,
    lang: await customerLang(),
    vars: {
      customerName: order.shippingName,
      orderNumber: order.orderNumber,
      total: formatBdt(order.total),
      codAmount: formatBdt(order.codAmount),
      courier: shipment?.provider.name ?? "our courier partner",
      trackingCode: shipment?.trackingCode ?? shipment?.consignmentId ?? "will be shared soon",
    },
    dedupeKey: `sms:${key}:${order.id}`,
    link: `/orders/${order.id}`,
  });
}
