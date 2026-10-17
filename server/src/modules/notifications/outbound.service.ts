import { prisma, Prisma } from "../../lib/prisma.js";
import { logger } from "../../lib/logger.js";
import { normalizeBdPhone, toE164 } from "../../lib/phone.js";
import { enqueue, QUEUES } from "../../jobs/queues.js";
import type { NotificationChannel } from "../../generated/prisma/enums.js";
import type { Notification } from "../../generated/prisma/client.js";
import { renderTemplate, type Lang, type TemplateVars } from "./templates.js";
import { getSmsProvider, getWhatsAppProvider, PermanentDeliveryError, sendEmail, type DeliveryResult } from "./channels.js";

/** Normalised recipient as stored in Notification / NotificationOptOut (01XXXXXXXXX or lowercase email). */
export function normalizeRecipient(channel: NotificationChannel, recipient: string): string | null {
  const r = recipient.trim();
  if (channel === "SMS" || channel === "WHATSAPP") return normalizeBdPhone(r);
  if (channel === "EMAIL") {
    const e = r.toLowerCase();
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : null;
  }
  return r || null;
}

export async function isOptedOut(channel: NotificationChannel, recipient: string) {
  return Boolean(await prisma.notificationOptOut.findUnique({ where: { channel_recipient: { channel, recipient } } }));
}

export interface OutboundInput {
  channel: Exclude<NotificationChannel, "IN_APP">;
  recipient: string;
  /** Notification type, e.g. "order.confirmed" (also the template key unless templateKey is given). */
  type: string;
  templateKey?: string;
  vars?: TemplateVars;
  lang?: Lang;
  /** Unique per logical message: the same key is delivered at most once, ever. */
  dedupeKey: string;
  link?: string | null;
  userId?: string | null;
}

export interface DeliverJobData {
  notificationId: string;
  whatsapp?: { templateName: string; languageCode: string; bodyParams: string[] };
}

/**
 * Queue an outbound EMAIL / SMS / WHATSAPP message. Never throws for business reasons:
 *   - invalid recipient / opted out → row stored as SKIPPED with the reason
 *   - same dedupeKey seen before → returns the existing row (duplicate: true), nothing is sent
 * Delivery happens in the notifications queue (retry + backoff) or inline when queues are disabled.
 */
export async function sendNotification(input: OutboundInput) {
  const existing = await prisma.notification.findUnique({ where: { dedupeKey: input.dedupeKey } });
  if (existing) return { notification: existing, duplicate: true };

  const recipient = normalizeRecipient(input.channel, input.recipient);
  const key = input.templateKey ?? input.type;
  const lang = input.lang ?? "en";
  const rendered = await renderTemplate(key, input.channel, input.vars ?? {}, lang);

  let skipReason: string | null = null;
  if (!recipient) skipReason = `Invalid ${input.channel === "EMAIL" ? "email address" : "phone number"}`;
  else if (await isOptedOut(input.channel, recipient)) skipReason = "Recipient opted out of this channel";

  let notification: Notification;
  try {
    notification = await prisma.notification.create({
      data: {
        userId: input.userId ?? null,
        channel: input.channel,
        type: input.type,
        recipient: recipient ?? input.recipient.slice(0, 200),
        title: rendered.subject,
        body: rendered.body,
        link: input.link ?? null,
        status: skipReason ? "SKIPPED" : "PENDING",
        error: skipReason,
        dedupeKey: input.dedupeKey,
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const row = await prisma.notification.findUniqueOrThrow({ where: { dedupeKey: input.dedupeKey } });
      return { notification: row, duplicate: true };
    }
    throw err;
  }
  if (skipReason) return { notification, duplicate: false };

  const job: DeliverJobData = {
    notificationId: notification.id,
    ...(input.channel === "WHATSAPP"
      ? { whatsapp: { templateName: key.replace(/[^a-z0-9_]/gi, "_").toLowerCase(), languageCode: lang, bodyParams: rendered.params } }
      : {}),
  };
  const queued = await enqueue(QUEUES.notifications, "deliver", job, { jobId: `notif-${notification.id}` });
  if (!queued) {
    await deliverNotification(job).catch((err) => logger.warn({ err: (err as Error).message, id: notification.id }, "inline notification delivery failed"));
    notification = await prisma.notification.findUniqueOrThrow({ where: { id: notification.id } });
  }
  return { notification, duplicate: false };
}

/**
 * Worker entry point: deliver one stored notification. Idempotent – SENT / SKIPPED rows are never
 * re-sent, and an optimistic claim on `attempts` stops two workers sending the same row.
 * Throws on retryable failure so BullMQ retries with backoff.
 */
export async function deliverNotification(data: DeliverJobData): Promise<{ status: string; reason?: string | null }> {
  const n = await prisma.notification.findUnique({ where: { id: data.notificationId } });
  if (!n) return { status: "MISSING" };
  if (n.status === "SENT" || n.status === "SKIPPED" || n.channel === "IN_APP") return { status: n.status, reason: n.error };

  const claim = await prisma.notification.updateMany({
    where: { id: n.id, attempts: n.attempts, status: { in: ["PENDING", "FAILED"] } },
    data: { attempts: { increment: 1 }, status: "PENDING" },
  });
  if (claim.count === 0) return { status: "IN_PROGRESS" };

  // opt-out may have been recorded after queueing
  if (n.recipient && (await isOptedOut(n.channel, n.recipient))) {
    await prisma.notification.update({ where: { id: n.id }, data: { status: "SKIPPED", error: "Recipient opted out of this channel" } });
    return { status: "SKIPPED", reason: "Recipient opted out of this channel" };
  }

  let result: DeliveryResult;
  try {
    const to = n.recipient ?? "";
    if (n.channel === "EMAIL") result = await sendEmail(to, n.title, n.body);
    else if (n.channel === "SMS") result = await getSmsProvider().send(toE164(to), n.body);
    else {
      const wa = getWhatsAppProvider();
      result = wa.isConfigured()
        ? await wa.sendTemplate(toE164(to), data.whatsapp ?? { templateName: n.type.replace(/[^a-z0-9_]/gi, "_"), languageCode: "en", bodyParams: [] })
        : { status: "SKIPPED", reason: "WhatsApp Cloud API not configured (WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID)" };
    }
  } catch (err) {
    const message = (err as Error).message.slice(0, 500);
    await prisma.notification.update({ where: { id: n.id }, data: { status: "FAILED", error: message } });
    if (err instanceof PermanentDeliveryError) {
      // permanent: keep FAILED, do not retry
      return { status: "FAILED", reason: message };
    }
    throw err;
  }

  await prisma.notification.update({
    where: { id: n.id },
    data: { status: result.status, error: result.reason ?? null, sentAt: result.status === "SENT" ? new Date() : null },
  });
  return { status: result.status, reason: result.reason ?? null };
}
