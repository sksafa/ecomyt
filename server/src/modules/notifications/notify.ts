import { prisma } from "../../lib/prisma.js";
import { logger } from "../../lib/logger.js";
import type { Permission } from "../../rbac/permissions.js";

/** Which staff receive which in-app alert (by permission). */
const AUDIENCE: Record<string, Permission> = {
  "order.new": "orders.confirm",
  "courier.booking_failed": "shipments.book",
  "inventory.low_stock": "inventory.adjust",
  "payment.failed": "payments.record",
  "return.requested": "returns.approve",
  "cod.settlement_due": "accounts.reconcile",
  "staff.activity": "audit.view",
  "daily.summary": "reports.view",
};

export const STAFF_NOTIFICATION_TYPES = Object.keys(AUDIENCE);

export interface StaffNotification {
  title: string;
  body: string;
  link?: string;
  /** Same key → delivered once per user, so retries never spam. */
  dedupeKey: string;
}

/** In-app notification to every active user holding the audience permission. Never throws. */
export async function notifyStaff(type: string, n: StaffNotification) {
  try {
    const permission = AUDIENCE[type] ?? "settings.manage";
    const users = await prisma.user.findMany({
      where: { status: "ACTIVE", roles: { some: { role: { permissions: { some: { permission: { key: permission } } } } } } },
      select: { id: true },
    });
    if (!users.length) return 0;
    const r = await prisma.notification.createMany({
      data: users.map((u) => ({
        userId: u.id, channel: "IN_APP" as const, type, title: n.title, body: n.body, link: n.link ?? null,
        status: "SENT" as const, sentAt: new Date(), dedupeKey: `${n.dedupeKey}:${u.id}`,
      })),
      skipDuplicates: true,
    });
    return r.count;
  } catch (err) {
    logger.error({ err, type }, "notifyStaff failed");
    return 0;
  }
}
