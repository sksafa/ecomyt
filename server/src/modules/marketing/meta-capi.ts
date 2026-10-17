import { createHash } from "node:crypto";
import { prisma, Prisma } from "../../lib/prisma.js";
import { env } from "../../config/env.js";
import { getSetting } from "../../lib/settings.js";
import { logger } from "../../lib/logger.js";
import { money } from "../../lib/money.js";
import { normalizeBdPhone } from "../../lib/phone.js";
import { enqueue, QUEUES } from "../../jobs/queues.js";

/**
 * Meta Conversions API (server-side events).
 *
 * Privacy rules enforced here:
 *  - nothing is sent unless settings.meta.capiEnabled is true AND a pixel id + access token exist;
 *  - customer data is only sent hashed (SHA-256) as Meta specifies – phone as E.164 digits without '+',
 *    email lower-cased and trimmed, country 'bd', external_id = hashed customer id;
 *  - fbc / fbp / client IP / user agent are first-party values captured by the storefront, sent as-is
 *    (Meta requires them unhashed). We never try to identify a buyer's Facebook profile.
 * Every send is recorded in MetaEventLog; (eventName, eventId) is unique so an event is sent at most once.
 */

export const META_GRAPH_VERSION = "v21.0";
const STALE_PENDING_MS = 10 * 60 * 1000;

export interface MetaConfig {
  pixelId: string;
  token: string;
  testEventCode: string;
  capiEnabled: boolean;
  /** true only when every requirement for sending is met */
  active: boolean;
  reason: string | null;
}

export async function getMetaConfig(): Promise<MetaConfig> {
  const s = await getSetting("meta");
  const pixelId = (s.pixelId || env.META_PIXEL_ID || "").trim();
  const token = env.META_CAPI_ACCESS_TOKEN.trim();
  const reason = !s.capiEnabled
    ? "Conversions API disabled in settings (meta.capiEnabled = false)"
    : !pixelId
      ? "Meta Pixel id not configured (settings meta.pixelId or META_PIXEL_ID)"
      : !token
        ? "META_CAPI_ACCESS_TOKEN not configured"
        : null;
  return { pixelId, token, testEventCode: env.META_TEST_EVENT_CODE.trim(), capiEnabled: s.capiEnabled, active: reason === null, reason };
}

export const sha256Hex = (v: string) => createHash("sha256").update(v, "utf8").digest("hex");

/** Meta's phone normalisation: digits only, with country code, no leading '+' or zeros. */
export function normalizePhoneForMeta(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const bd = normalizeBdPhone(phone);
  return bd ? `88${bd}` : null;
}
export const normalizeEmailForMeta = (email: string | null | undefined) => (email && email.includes("@") ? email.trim().toLowerCase() : null);

export interface MetaServerEvent {
  event_name: string;
  event_time: number;
  event_id: string;
  action_source: "website";
  event_source_url?: string;
  user_data: Record<string, string | string[]>;
  custom_data?: Record<string, unknown>;
}

export const purchaseEventId = (orderId: string) => `purchase:${orderId}`;

/** Build the Purchase event for an order (event_id matches the storefront Pixel's eventID for dedup). */
export async function buildPurchaseEvent(orderId: string): Promise<MetaServerEvent | null> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { items: true, attribution: true, customer: { select: { id: true, email: true } } },
  });
  if (!order) return null;
  const a = order.attribution;
  // client IP / UA are read when the attribution record carries them (columns proposed, see report)
  const extra = (a ?? {}) as Record<string, unknown>;
  const clientIp = typeof extra.clientIpAddress === "string" ? extra.clientIpAddress : null;
  const userAgent = typeof extra.clientUserAgent === "string" ? extra.clientUserAgent : null;

  const phone = normalizePhoneForMeta(order.shippingPhone);
  const email = normalizeEmailForMeta(order.customer.email);
  const user_data: Record<string, string | string[]> = {
    country: [sha256Hex("bd")],
    external_id: [sha256Hex(order.customer.id)],
  };
  if (phone) user_data.ph = [sha256Hex(phone)];
  if (email) user_data.em = [sha256Hex(email)];
  if (a?.fbc) user_data.fbc = a.fbc;
  if (a?.fbp) user_data.fbp = a.fbp;
  if (clientIp) user_data.client_ip_address = clientIp;
  if (userAgent) user_data.client_user_agent = userAgent;

  const sourceUrl = a?.lastLandingPage || a?.firstLandingPage || `${env.CLIENT_URL.split(",")[0].trim().replace(/\/$/, "")}/checkout`;
  const skus = [...new Set(order.items.map((i) => i.sku))];
  return {
    event_name: "Purchase",
    event_time: Math.floor(order.createdAt.getTime() / 1000),
    event_id: purchaseEventId(order.id),
    action_source: "website",
    event_source_url: sourceUrl,
    user_data,
    custom_data: {
      currency: "BDT",
      // JSON number required by Meta; derived from the exact Decimal, 2dp
      value: Number(money(order.total).toFixed(2)),
      content_ids: skus,
      content_type: "product",
      contents: order.items.map((i) => ({ id: i.sku, quantity: i.quantity, item_price: Number(money(i.unitPrice).toFixed(2)) })),
      num_items: order.items.reduce((n, i) => n + i.quantity, 0),
      order_id: order.orderNumber,
    },
  };
}

export interface MetaSendJob {
  eventName: string;
  eventId: string;
  orderId?: string | null;
  /** For ad-hoc events (test event); order events are rebuilt from the DB at send time. */
  event?: MetaServerEvent;
  testEventCode?: string | null;
}

export interface MetaSendResult {
  status: "SENT" | "SKIPPED" | "FAILED" | "DUPLICATE" | "IN_PROGRESS";
  logId?: string;
  reason?: string | null;
  retryable?: boolean;
}

/** Claim the (eventName, eventId) slot. Returns the log id when this caller may send, else the existing outcome. */
async function claim(job: MetaSendJob): Promise<{ id: string } | MetaSendResult> {
  try {
    const row = await prisma.metaEventLog.create({ data: { eventName: job.eventName, eventId: job.eventId, orderId: job.orderId ?? null, status: "PENDING" } });
    return { id: row.id };
  } catch (err) {
    if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")) throw err;
  }
  const existing = await prisma.metaEventLog.findUniqueOrThrow({ where: { eventName_eventId: { eventName: job.eventName, eventId: job.eventId } } });
  const reclaimable = existing.status === "FAILED" || (existing.status === "PENDING" && Date.now() - existing.createdAt.getTime() > STALE_PENDING_MS);
  if (!reclaimable) {
    return { status: existing.status === "PENDING" ? "IN_PROGRESS" : "DUPLICATE", logId: existing.id, reason: existing.error };
  }
  const r = await prisma.metaEventLog.updateMany({
    where: { id: existing.id, status: existing.status, createdAt: existing.createdAt },
    data: { status: "PENDING", error: null, createdAt: new Date() },
  });
  return r.count === 1 ? { id: existing.id } : { status: "IN_PROGRESS", logId: existing.id };
}

type FetchFn = typeof fetch;

/**
 * Send one server event (idempotent). Used by the marketing worker and inline when queues are disabled.
 * Not configured → SKIPPED row with the reason. Network / 5xx / 429 → FAILED + retryable.
 */
export async function sendMetaEvent(job: MetaSendJob, fetchImpl: FetchFn = fetch): Promise<MetaSendResult> {
  const slot = await claim(job);
  if (!("id" in slot)) return slot;
  const logId = slot.id;

  const cfg = await getMetaConfig();
  if (!cfg.active) {
    await prisma.metaEventLog.update({ where: { id: logId }, data: { status: "SKIPPED", error: cfg.reason } });
    return { status: "SKIPPED", logId, reason: cfg.reason };
  }

  const event = job.event ?? (job.eventName === "Purchase" && job.orderId ? await buildPurchaseEvent(job.orderId) : null);
  if (!event) {
    await prisma.metaEventLog.update({ where: { id: logId }, data: { status: "SKIPPED", error: "Nothing to send (order not found)" } });
    return { status: "SKIPPED", logId, reason: "Nothing to send (order not found)" };
  }

  const testCode = job.testEventCode ?? cfg.testEventCode;
  const url = `https://graph.facebook.com/${META_GRAPH_VERSION}/${encodeURIComponent(cfg.pixelId)}/events?access_token=${encodeURIComponent(cfg.token)}`;
  const payload = { data: [event], ...(testCode ? { test_event_code: testCode } : {}) };
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const message = `Graph API ${res.status}: ${String((body.error as { message?: string } | undefined)?.message ?? "request failed")}`.slice(0, 500);
      await prisma.metaEventLog.update({ where: { id: logId }, data: { status: "FAILED", error: message, response: body as Prisma.InputJsonValue } });
      return { status: "FAILED", logId, reason: message, retryable: res.status >= 500 || res.status === 429 };
    }
    await prisma.metaEventLog.update({
      where: { id: logId },
      data: { status: "SENT", error: null, response: { ...body, testEventCode: testCode || null } as Prisma.InputJsonValue },
    });
    return { status: "SENT", logId };
  } catch (err) {
    const message = (err as Error).message.slice(0, 500);
    await prisma.metaEventLog.update({ where: { id: logId }, data: { status: "FAILED", error: message } });
    logger.warn({ err: message, eventName: job.eventName, eventId: job.eventId }, "meta capi send failed");
    return { status: "FAILED", logId, reason: message, retryable: true };
  }
}

/** Worker handler: throws on retryable failure so BullMQ retries with backoff. */
export async function processMetaEventJob(job: MetaSendJob) {
  const r = await sendMetaEvent(job);
  if (r.status === "FAILED" && r.retryable) throw new Error(r.reason ?? "Meta CAPI send failed");
  return r;
}

/** Queue (or, with queues disabled, send inline) the Purchase event for a website order. */
export async function queuePurchaseEvent(orderId: string) {
  const job: MetaSendJob = { eventName: "Purchase", eventId: purchaseEventId(orderId), orderId };
  const queued = await enqueue(QUEUES.marketing, "capi-event", job, { jobId: `capi-purchase-${orderId}` });
  if (queued) return { queued: true as const };
  return { queued: false as const, result: await sendMetaEvent(job) };
}
