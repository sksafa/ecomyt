import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";
import { getSetting } from "../lib/settings.js";
import { formatBdt, sum, type Decimal } from "../lib/money.js";
import { dhakaDate, dhakaRange } from "../lib/time.js";
import { notifyStaff } from "../modules/notifications/notify.js";
import { alertLowStock, findLowStock } from "../modules/notifications/alerts.js";
import { sendNotification } from "../modules/notifications/outbound.service.js";
import { interpolate, DEFAULT_TEMPLATES } from "../modules/notifications/templates.js";
import { getAdapter } from "../modules/couriers/registry.js";
import { syncShipment } from "../modules/couriers/shipments.service.js";
import type { ShipmentStatus } from "../generated/prisma/enums.js";

/**
 * Plain job handlers (no BullMQ types) so tests and the worker call the same code.
 * Every handler is idempotent: notifications are deduped per day via dedupeKey.
 */

// ───────────── daily sales summary ─────────────

export async function dailySummaryJob(opts: { date?: string } = {}) {
  const date = opts.date ?? dhakaDate();
  const day = dhakaRange(date, date);
  const [placed, confirmedCount, shippedCount, delivered, cancelledCount, returnedCount, awaitingConfirmation, lowStock] = await Promise.all([
    prisma.order.findMany({ where: { createdAt: day }, select: { total: true, status: true } }),
    prisma.order.count({ where: { confirmedAt: day } }),
    prisma.order.count({ where: { shippedAt: day } }),
    prisma.order.findMany({ where: { deliveredAt: day }, select: { total: true } }),
    prisma.order.count({ where: { cancelledAt: day } }),
    prisma.order.count({ where: { returnedAt: day } }),
    prisma.order.count({ where: { status: { in: ["PENDING", "CONFIRMATION_REQUIRED"] } } }),
    findLowStock(),
  ]);
  const placedValue = sum(placed.filter((o) => o.status !== "CANCELLED").map((o) => o.total));
  const deliveredValue = sum(delivered.map((o) => o.total));
  const summary = {
    date,
    placedCount: placed.length,
    placedValue: placedValue.toFixed(2),
    confirmedCount,
    shippedCount,
    deliveredCount: delivered.length,
    deliveredValue: deliveredValue.toFixed(2),
    cancelledCount,
    returnedCount,
    awaitingConfirmation,
    lowStockCount: lowStock.length,
  };
  const vars = { ...summary, placedValue: formatBdt(placedValue), deliveredValue: formatBdt(deliveredValue) };

  const inApp = await notifyStaff("daily.summary", {
    title: interpolate(DEFAULT_TEMPLATES["daily.summary"].subject.en, vars),
    body: `${summary.placedCount} placed (${vars.placedValue}) · ${summary.deliveredCount} delivered (${vars.deliveredValue}) · ${summary.cancelledCount} cancelled · ${summary.awaitingConfirmation} awaiting confirmation`,
    link: "/dashboard",
    dedupeKey: `daily.summary:${date}`,
  });

  const cfg = await getSetting("notifications");
  const recipients = (cfg.dailySummaryEmail ?? "").split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);
  const emails = [];
  for (const to of recipients) {
    const r = await sendNotification({ channel: "EMAIL", recipient: to, type: "daily.summary", vars, dedupeKey: `daily.summary:${date}:email:${to.toLowerCase()}` });
    emails.push({ to, status: r.notification.status, duplicate: r.duplicate });
  }
  logger.info({ summary, inApp, emails: emails.length }, "daily summary");
  return { summary, inAppRecipients: inApp, emails };
}

// ───────────── low stock ─────────────

export async function lowStockScanJob() {
  const rows = await alertLowStock();
  return { lowStock: rows.length, variants: rows.map((r) => r.sku) };
}

// ───────────── COD settlement reminder ─────────────

export const COD_SETTLEMENT_DUE_DAYS = 7;

/** Delivered (non-return) shipments not in any courier settlement after N days → one staff alert per day. */
export async function codSettlementReminderJob(opts: { now?: Date; days?: number } = {}) {
  const now = opts.now ?? new Date();
  const days = opts.days ?? COD_SETTLEMENT_DUE_DAYS;
  const cutoff = new Date(now.getTime() - days * 24 * 3600 * 1000);
  const due = await prisma.shipment.findMany({
    where: {
      isReturn: false,
      status: { in: ["DELIVERED", "PARTIALLY_DELIVERED"] },
      deliveredAt: { lt: cutoff },
      settlementItem: { is: null },
    },
    select: { id: true, codAmount: true, collectedAmount: true, provider: { select: { name: true } } },
  });
  if (!due.length) return { due: 0, amount: "0.00", byProvider: {} as Record<string, { count: number; amount: string }> };

  const byProvider = new Map<string, { count: number; amounts: Decimal[] }>();
  for (const s of due) {
    const p = byProvider.get(s.provider.name) ?? { count: 0, amounts: [] };
    p.count++;
    p.amounts.push(s.collectedAmount ?? s.codAmount);
    byProvider.set(s.provider.name, p);
  }
  const amount = sum(due.map((s) => s.collectedAmount ?? s.codAmount));
  const parts = [...byProvider].map(([name, p]) => `${name}: ${p.count} (${formatBdt(sum(p.amounts))})`);
  await notifyStaff("cod.settlement_due", {
    title: `${due.length} delivered COD parcel${due.length === 1 ? "" : "s"} unsettled for over ${days} days`,
    body: `${formatBdt(amount)} awaiting courier settlement – ${parts.join("; ")}`,
    link: "/couriers/settlements",
    dedupeKey: `cod.settlement_due:${dhakaDate(now)}`,
  });
  return {
    due: due.length,
    amount: amount.toFixed(2),
    byProvider: Object.fromEntries([...byProvider].map(([k, p]) => [k, { count: p.count, amount: sum(p.amounts).toFixed(2) }])),
  };
}

// ───────────── courier status polling ─────────────

const ACTIVE_SHIPMENT: ShipmentStatus[] = ["BOOKED", "PICKED_UP", "IN_TRANSIT", "RETURNING"];

/** Poll couriers that cannot push webhooks (or whose adapter supports tracking but not webhooks). */
export async function courierSyncJob(opts: { limit?: number } = {}) {
  const providers = await prisma.courierProvider.findMany({ where: { isEnabled: true } });
  const pollable = providers.filter((p) => {
    const a = getAdapter(p.code);
    return a && a.capabilities.trackShipment && typeof a.track === "function" && !a.capabilities.webhooks;
  });
  let checked = 0;
  let failed = 0;
  for (const p of pollable) {
    const shipments = await prisma.shipment.findMany({
      where: { providerId: p.id, status: { in: ACTIVE_SHIPMENT }, OR: [{ consignmentId: { not: null } }, { trackingCode: { not: null } }] },
      orderBy: { lastEventAt: { sort: "asc", nulls: "first" } },
      take: opts.limit ?? 200,
      select: { id: true },
    });
    for (const s of shipments) {
      checked++;
      try {
        await syncShipment(s.id);
      } catch (err) {
        failed++;
        logger.warn({ err: (err as Error).message, shipmentId: s.id, provider: p.code }, "courier sync failed");
      }
    }
  }
  return { providers: pollable.map((p) => p.code), checked, failed };
}

/**
 * Browser-mirrored Meta events (ViewContent / InitiateCheckout / AddToCart) are only kept for 30 days.
 * Purchase rows are kept permanently – they are the audit trail of conversion tracking.
 */
export async function pruneMetaEventLogsJob(opts: { days?: number } = {}) {
  const before = new Date(Date.now() - (opts.days ?? 30) * 86_400_000);
  const r = await prisma.metaEventLog.deleteMany({ where: { eventName: { not: "Purchase" }, createdAt: { lt: before } } });
  return { deleted: r.count };
}
