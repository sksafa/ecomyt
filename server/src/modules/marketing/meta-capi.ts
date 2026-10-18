import { createHash } from "node:crypto";
import { prisma, Prisma } from "../../lib/prisma.js";
import { env } from "../../config/env.js";
import { getSetting } from "../../lib/settings.js";
import { logger } from "../../lib/logger.js";
import { money } from "../../lib/money.js";
import { normalizeBdPhone } from "../../lib/phone.js";
import { enqueue, QUEUES } from "../../jobs/queues.js";

/**
 * Meta Pixel + Conversions API (server side).
 *
 * Purchase deduplication – one purchase → one Purchase conversion:
 *  - every website order gets ONE persistent event id (Order.metaPurchaseEventId = "purchase:<orderId>"),
 *    used by both the browser Pixel (eventID) and this server event (event_id);
 *  - the server event is sent at most once: MetaEventLog (eventName, eventId) is unique and a row only
 *    becomes SENT when Meta confirms `events_received >= 1`;
 *  - the browser gets the Purchase payload at most once (atomic Order.pixelPurchaseClaimedAt claim), and only
 *    from the backend after the order exists (COD) or the payment was verified (online), so thank-you page
 *    refreshes, revisits and retried checkout requests never fire a second Purchase;
 *  - value / contents come from ONE builder (purchaseCustomData) for both sides, so they always match.
 *
 * Privacy: nothing is sent unless settings.meta.capiEnabled and a pixel id + access token are configured.
 * Customer data is normalised and SHA-256 hashed per Meta's spec; fbc/fbp/IP/user agent are sent unhashed as
 * Meta requires. The access token lives only in server env and is sent in the request body (not the URL).
 */

export const META_GRAPH_VERSION = env.META_GRAPH_VERSION;
const STALE_PENDING_MS = 10 * 60 * 1000;
/** Meta rejects events older than 7 days. */
const MAX_EVENT_AGE_S = 7 * 24 * 3600;

export interface MetaConfig {
  pixelId: string;
  token: string;
  testEventCode: string;
  capiEnabled: boolean;
  purchaseValue: "ORDER_TOTAL" | "PRODUCT_VALUE";
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
  return {
    pixelId, token, testEventCode: env.META_TEST_EVENT_CODE.trim(), capiEnabled: s.capiEnabled,
    purchaseValue: s.purchaseValue === "PRODUCT_VALUE" ? "PRODUCT_VALUE" : "ORDER_TOTAL",
    active: reason === null, reason,
  };
}

// ───────────── normalisation & hashing (Meta customer information parameters) ─────────────

export const sha256Hex = (v: string) => createHash("sha256").update(v, "utf8").digest("hex");

/** Phone: digits only incl. country code, no '+' or leading zeros → 8801XXXXXXXXX. */
export function normalizePhoneForMeta(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const bd = normalizeBdPhone(phone);
  return bd ? `88${bd}` : null;
}
export const normalizeEmailForMeta = (email: string | null | undefined) => {
  const e = email?.trim().toLowerCase();
  return e && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : null;
};
/** Names / city: lower-case, punctuation and spaces removed, UTF-8 (Bengali kept as is). */
const normalizeText = (v: string | null | undefined) => {
  const s = (v ?? "").normalize("NFC").toLowerCase().replace(/[\p{P}\p{S}\s]/gu, "");
  return s || null;
};
/** "Md. Safawat Hossain" → fn "md", ln "hossain". Single-word names only set fn. */
export function splitName(full: string | null | undefined) {
  const parts = (full ?? "").trim().split(/\s+/).filter(Boolean);
  return { fn: normalizeText(parts[0]), ln: parts.length > 1 ? normalizeText(parts[parts.length - 1]) : null };
}

const hashed = (v: string | null) => (v ? [sha256Hex(v)] : undefined);

// ───────────── event model ─────────────

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

const PURCHASE_ORDER_INCLUDE = {
  items: true,
  attribution: true,
  customer: { select: { id: true, email: true, name: true } },
  payments: { where: { status: "COMPLETED" as const, kind: "ADVANCE" as const }, orderBy: { verifiedAt: "asc" as const } },
} satisfies Prisma.OrderInclude;
type PurchaseOrder = Prisma.OrderGetPayload<{ include: typeof PURCHASE_ORDER_INCLUDE }>;

/**
 * The one definition of Purchase parameters (value, contents, ids) – used for the browser Pixel payload and
 * the server event alike. `value` follows settings.meta.purchaseValue; delivery and product value are also
 * sent as explicit custom properties so the number is never ambiguous.
 */
export function purchaseCustomData(order: PurchaseOrder, mode: MetaConfig["purchaseValue"]) {
  const productValue = money(order.subtotal).minus(order.discountTotal);
  const total = money(order.total);
  const value = mode === "PRODUCT_VALUE" ? productValue : total;
  return {
    currency: "BDT",
    value: Number(value.toFixed(2)),
    content_type: "product",
    content_ids: [...new Set(order.items.map((i) => i.sku))],
    contents: order.items.map((i) => ({ id: i.sku, quantity: i.quantity, item_price: Number(money(i.unitPrice).toFixed(2)) })),
    num_items: order.items.reduce((n, i) => n + i.quantity, 0),
    order_id: order.orderNumber,
    product_value: Number(productValue.toFixed(2)),
    delivery_charge: Number(money(order.deliveryCharge).toFixed(2)),
    order_total: Number(total.toFixed(2)),
  };
}

export type PurchaseEligibility = { eligible: true; trigger: "PLACED_COD" | "PAID_ONLINE" | "CONFIRMED_UNPAID" } | { eligible: false; reason: string };

/**
 * When an order counts as a Purchase:
 *  - only website orders placed by customers (staff / phone / Facebook-inbox orders entered by staff never count);
 *  - cash on delivery: as soon as the order is created;
 *  - online payment: once the payment is verified by the gateway's validation API;
 *  - online order left unpaid but later confirmed by staff (customer chose COD): server-side only.
 */
export function purchaseEligibility(order: Pick<PurchaseOrder, "channel" | "createdById" | "paymentMethod" | "paymentStatus" | "status">): PurchaseEligibility {
  if (order.channel !== "WEBSITE" || order.createdById) return { eligible: false, reason: "Not a customer website order" };
  if (order.paymentMethod === "COD") return { eligible: true, trigger: "PLACED_COD" };
  if (["PAID", "PARTIALLY_PAID", "PARTIALLY_REFUNDED", "REFUNDED"].includes(order.paymentStatus)) return { eligible: true, trigger: "PAID_ONLINE" };
  if (!["PENDING", "CONFIRMATION_REQUIRED", "CANCELLED", "ON_HOLD"].includes(order.status)) return { eligible: true, trigger: "CONFIRMED_UNPAID" };
  return { eligible: false, reason: "Online payment not completed yet" };
}

/** Time of the purchase: order placement for COD, payment verification for online payments. */
function purchaseTime(order: PurchaseOrder) {
  const paidAt = order.payments.find((p) => p.verifiedAt)?.verifiedAt;
  return order.paymentMethod !== "COD" && paidAt ? paidAt : order.createdAt;
}

function sourceUrl(order: PurchaseOrder) {
  const base = env.CLIENT_URL.split(",")[0].trim().replace(/\/$/, "");
  const a = order.attribution;
  if (a?.eventSourceUrl) return a.eventSourceUrl;
  const landing = a?.lastLandingPage || a?.firstLandingPage;
  if (landing) return landing.startsWith("http") ? landing : `${base}${landing.startsWith("/") ? "" : "/"}${landing}`;
  return `${base}/checkout`;
}

/** Meta customer information parameters for an order (hashed where Meta requires hashing). */
export function purchaseUserData(order: PurchaseOrder) {
  const a = order.attribution;
  const { fn, ln } = splitName(order.shippingName || order.customer.name);
  const user_data: Record<string, string | string[]> = {};
  const set = (k: string, v: string[] | string | undefined | null) => {
    if (v && (Array.isArray(v) ? v.length : true)) user_data[k] = v;
  };
  set("em", hashed(normalizeEmailForMeta(order.customer.email)));
  set("ph", hashed(normalizePhoneForMeta(order.shippingPhone)));
  set("fn", hashed(fn));
  set("ln", hashed(ln));
  set("ct", hashed(normalizeText(order.districtName)));
  set("country", hashed("bd"));
  set("external_id", hashed(order.customer.id));
  set("fbc", a?.fbc);
  set("fbp", a?.fbp);
  set("client_ip_address", a?.clientIpAddress);
  set("client_user_agent", a?.clientUserAgent);
  return user_data;
}

export async function loadPurchaseOrder(orderId: string) {
  return prisma.order.findUnique({ where: { id: orderId }, include: PURCHASE_ORDER_INCLUDE });
}

/** Build the server Purchase event (event_id matches the Pixel's eventID). */
export async function buildPurchaseEvent(orderId: string, mode?: MetaConfig["purchaseValue"]): Promise<MetaServerEvent | null> {
  const order = await loadPurchaseOrder(orderId);
  if (!order) return null;
  const valueMode = mode ?? (await getMetaConfig()).purchaseValue;
  return {
    event_name: "Purchase",
    event_time: Math.floor(purchaseTime(order).getTime() / 1000),
    event_id: order.metaPurchaseEventId ?? purchaseEventId(order.id),
    action_source: "website",
    event_source_url: sourceUrl(order),
    user_data: purchaseUserData(order),
    custom_data: purchaseCustomData(order, valueMode),
  };
}

// ───────────── browser Purchase hand-off (one time) ─────────────

export interface BrowserPurchase {
  eventName: "Purchase";
  eventId: string;
  data: ReturnType<typeof purchaseCustomData>;
}

/**
 * Give the browser the Purchase payload exactly once per order. The atomic conditional update means
 * concurrent or repeated callers (double submit, refresh, revisit, other devices) get null.
 */
export async function claimBrowserPurchase(orderId: string): Promise<BrowserPurchase | null> {
  const order = await loadPurchaseOrder(orderId);
  if (!order || !order.metaPurchaseEventId) return null;
  const elig = purchaseEligibility(order);
  if (!elig.eligible || elig.trigger === "CONFIRMED_UNPAID") return null;
  const claimed = await prisma.order.updateMany({ where: { id: order.id, pixelPurchaseClaimedAt: null }, data: { pixelPurchaseClaimedAt: new Date() } });
  if (claimed.count !== 1) return null;
  const cfg = await getMetaConfig();
  return { eventName: "Purchase", eventId: order.metaPurchaseEventId, data: purchaseCustomData(order, cfg.purchaseValue) };
}

// ───────────── sending ─────────────

export interface MetaSendJob {
  eventName: string;
  eventId: string;
  orderId?: string | null;
  /** Prebuilt event (browser-mirrored events, test event). Purchase is rebuilt from the DB at send time. */
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
    const row = await prisma.metaEventLog.create({ data: { eventName: job.eventName, eventId: job.eventId, orderId: job.orderId ?? null, status: "PENDING", attempts: 1 } });
    return { id: row.id };
  } catch (err) {
    if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")) throw err;
  }
  const existing = await prisma.metaEventLog.findUniqueOrThrow({ where: { eventName_eventId: { eventName: job.eventName, eventId: job.eventId } } });
  // SENT is final. SKIPPED is re-tried only once configuration exists (e.g. CAPI enabled later).
  const reclaimable =
    existing.status === "FAILED" ||
    (existing.status === "SKIPPED" && (await getMetaConfig()).active) ||
    (existing.status === "PENDING" && Date.now() - existing.updatedAt.getTime() > STALE_PENDING_MS);
  if (!reclaimable) return { status: existing.status === "PENDING" ? "IN_PROGRESS" : "DUPLICATE", logId: existing.id, reason: existing.error };
  // optimistic lock on the row version so two retries cannot both send
  const r = await prisma.metaEventLog.updateMany({
    where: { id: existing.id, status: existing.status, updatedAt: existing.updatedAt },
    data: { status: "PENDING", error: null, attempts: { increment: 1 } },
  });
  return r.count === 1 ? { id: existing.id } : { status: "IN_PROGRESS", logId: existing.id };
}

type FetchFn = typeof fetch;

/** What we keep about a sent payload: parameters and which match keys were present (no hashes, no PII). */
const payloadSummary = (e: MetaServerEvent) => ({
  event_time: e.event_time,
  event_source_url: e.event_source_url,
  custom_data: e.custom_data ?? null,
  match_keys: Object.keys(e.user_data).sort(),
});

/**
 * Send one server event (idempotent). Marked SENT only when Meta answers 2xx with events_received ≥ 1.
 * Network errors, timeouts, 5xx and 429 → FAILED + retryable; other 4xx (bad token, invalid data) → FAILED, not retried.
 */
export async function sendMetaEvent(job: MetaSendJob, fetchImpl: FetchFn = fetch): Promise<MetaSendResult> {
  const slot = await claim(job);
  if (!("id" in slot)) return slot;
  const logId = slot.id;
  const done = (data: Prisma.MetaEventLogUpdateInput) => prisma.metaEventLog.update({ where: { id: logId }, data });

  const cfg = await getMetaConfig();
  if (!cfg.active) {
    await done({ status: "SKIPPED", error: cfg.reason });
    return { status: "SKIPPED", logId, reason: cfg.reason };
  }

  let event = job.event ?? null;
  if (!event && job.eventName === "Purchase" && job.orderId) {
    const order = await loadPurchaseOrder(job.orderId);
    const elig = order ? purchaseEligibility(order) : null;
    if (!order || !elig?.eligible) {
      const reason = !order ? "Order not found" : (elig as { reason: string }).reason;
      await done({ status: "SKIPPED", error: reason });
      return { status: "SKIPPED", logId, reason };
    }
    event = await buildPurchaseEvent(job.orderId, cfg.purchaseValue);
  }
  if (!event) {
    await done({ status: "SKIPPED", error: "Nothing to send" });
    return { status: "SKIPPED", logId, reason: "Nothing to send" };
  }
  if (Math.floor(Date.now() / 1000) - event.event_time > MAX_EVENT_AGE_S) {
    const reason = "Event is older than 7 days – Meta would reject it";
    await done({ status: "FAILED", error: reason, payload: payloadSummary(event) as Prisma.InputJsonValue });
    return { status: "FAILED", logId, reason, retryable: false };
  }

  const testCode = job.testEventCode ?? cfg.testEventCode;
  const url = `${env.META_GRAPH_BASE_URL.replace(/\/$/, "")}/${META_GRAPH_VERSION}/${encodeURIComponent(cfg.pixelId)}/events`;
  const body = { data: [event], access_token: cfg.token, ...(testCode ? { test_event_code: testCode } : {}) };
  const summary = payloadSummary(event) as Prisma.InputJsonValue;
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await res.json().catch(() => ({}))) as { events_received?: number; fbtrace_id?: string; messages?: unknown; error?: { message?: string; code?: number; error_subcode?: number; fbtrace_id?: string } };
    const received = typeof json.events_received === "number" ? json.events_received : null;
    if (!res.ok || !received) {
      const message = !res.ok
        ? `Graph API ${res.status}: ${json.error?.message ?? "request failed"}${json.error?.code ? ` (code ${json.error.code}${json.error.error_subcode ? `/${json.error.error_subcode}` : ""})` : ""}`
        : "Meta accepted the request but reported 0 events received";
      await done({
        status: "FAILED", error: message.slice(0, 500), payload: summary, response: json as Prisma.InputJsonValue,
        fbtraceId: json.fbtrace_id ?? json.error?.fbtrace_id ?? null, eventsReceived: received, testEventCode: testCode || null,
      });
      return { status: "FAILED", logId, reason: message, retryable: !res.ok && (res.status >= 500 || res.status === 429) };
    }
    await done({
      status: "SENT", error: null, payload: summary, response: json as Prisma.InputJsonValue, eventsReceived: received,
      fbtraceId: json.fbtrace_id ?? null, testEventCode: testCode || null, sentAt: new Date(),
    });
    return { status: "SENT", logId };
  } catch (err) {
    const message = (err as Error).name === "TimeoutError" ? "Meta did not answer within 15s" : (err as Error).message;
    await done({ status: "FAILED", error: message.slice(0, 500), payload: summary, testEventCode: testCode || null });
    logger.warn({ err: message, eventName: job.eventName, eventId: job.eventId }, "meta capi send failed");
    return { status: "FAILED", logId, reason: message, retryable: true };
  }
}

/** Worker handler: throws on retryable failure so BullMQ retries with exponential backoff. */
export async function processMetaEventJob(job: MetaSendJob) {
  const r = await sendMetaEvent(job);
  if (r.status === "FAILED" && r.retryable) throw new Error(r.reason ?? "Meta CAPI send failed");
  return r;
}

/** Queue (or, with queues disabled, send inline) a server event. The jobId makes enqueueing idempotent too. */
export async function queueMetaEvent(job: MetaSendJob) {
  const queued = await enqueue(QUEUES.marketing, "capi-event", job, { jobId: `capi-${job.eventName}-${job.eventId}`.replace(/:/g, "-") });
  if (queued) return { queued: true as const };
  return { queued: false as const, result: await sendMetaEvent(job) };
}

/** Queue the Purchase for an order if it is eligible (safe to call any number of times). */
export async function queuePurchaseEvent(orderId: string) {
  const order = await prisma.order.findUnique({ where: { id: orderId }, select: { id: true, channel: true, createdById: true, paymentMethod: true, paymentStatus: true, status: true, metaPurchaseEventId: true } });
  if (!order) return null;
  if (!purchaseEligibility(order).eligible) return null;
  const eventId = order.metaPurchaseEventId ?? purchaseEventId(order.id);
  if (!order.metaPurchaseEventId) await prisma.order.update({ where: { id: order.id }, data: { metaPurchaseEventId: eventId } });
  return queueMetaEvent({ eventName: "Purchase", eventId, orderId: order.id });
}

/** Admin: send a FAILED / SKIPPED event again (same event_id, so Meta still deduplicates). */
export async function retryMetaEvent(logId: string) {
  const row = await prisma.metaEventLog.findUniqueOrThrow({ where: { id: logId } });
  if (row.status === "SENT") return { status: "DUPLICATE" as const, logId };
  if (row.eventName === "Purchase" && row.orderId) return sendMetaEvent({ eventName: "Purchase", eventId: row.eventId, orderId: row.orderId });
  return { status: "SKIPPED" as const, logId, reason: "Only Purchase events can be re-sent (browsing events are not stored)" };
}

// ───────────── browser-mirrored events (ViewContent / InitiateCheckout / AddToCart) ─────────────

export interface MirroredEventInput {
  eventName: "ViewContent" | "InitiateCheckout" | "AddToCart";
  eventId: string;
  eventSourceUrl: string;
  items: { sku: string; quantity: number; price: string }[];
  fbp?: string | null;
  fbc?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}

/** Server copy of a browser event with the browser's eventID (Meta deduplicates the pair). No personal data. */
export function buildMirroredEvent(e: MirroredEventInput): MetaServerEvent {
  const value = e.items.reduce((s, i) => s.plus(money(i.price).times(i.quantity)), money(0));
  const user_data: Record<string, string | string[]> = {};
  if (e.fbp) user_data.fbp = e.fbp;
  if (e.fbc) user_data.fbc = e.fbc;
  if (e.ip) user_data.client_ip_address = e.ip;
  if (e.userAgent) user_data.client_user_agent = e.userAgent;
  return {
    event_name: e.eventName,
    event_time: Math.floor(Date.now() / 1000),
    event_id: e.eventId,
    action_source: "website",
    event_source_url: e.eventSourceUrl,
    user_data,
    custom_data: {
      currency: "BDT",
      value: Number(value.toFixed(2)),
      content_type: "product",
      content_ids: [...new Set(e.items.map((i) => i.sku))],
      contents: e.items.map((i) => ({ id: i.sku, quantity: i.quantity, item_price: Number(money(i.price).toFixed(2)) })),
      num_items: e.items.reduce((n, i) => n + i.quantity, 0),
    },
  };
}
