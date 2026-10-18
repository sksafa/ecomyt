// Marketing attribution (first/last touch) + Meta Pixel event helpers. Browser only.
// Never pass personal data (name, phone, address, email) to the pixel – only product ids, values and counts.

const FIRST_KEY = "bb_attr_first";
const LAST_KEY = "bb_attr_last";

export interface Touch {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;
  campaign_id?: string;
  adset_id?: string;
  ad_id?: string;
  landing_page: string;
  referrer?: string;
  fbclid?: string;
  ts: string;
}

const clip = (v: string | null | undefined, n = 500) => (v ? v.slice(0, n) : undefined);

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
function writeJson(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    // storage disabled (private mode) – attribution is best effort
  }
}

export function readCookie(name: string) {
  const m = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return m ? decodeURIComponent(m[1]) : null;
}

/** Called once per full page load (landing). Stores first touch once, always refreshes last touch. */
export function captureAttribution() {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  const p = url.searchParams;
  const ref = document.referrer && !document.referrer.startsWith(window.location.origin) ? document.referrer : undefined;
  const touch: Touch = {
    utm_source: clip(p.get("utm_source")),
    utm_medium: clip(p.get("utm_medium")),
    utm_campaign: clip(p.get("utm_campaign")),
    utm_content: clip(p.get("utm_content")),
    utm_term: clip(p.get("utm_term")),
    campaign_id: clip(p.get("campaign_id") ?? p.get("utm_id")),
    adset_id: clip(p.get("adset_id")),
    ad_id: clip(p.get("ad_id")),
    landing_page: clip(url.pathname + url.search)!,
    referrer: clip(ref),
    fbclid: clip(p.get("fbclid")),
    ts: new Date().toISOString(),
  };
  if (!readJson<Touch>(FIRST_KEY)) writeJson(FIRST_KEY, touch);
  // Last touch = the latest landing that carries a marketing signal (campaign params, click id or an
  // external referrer). Plain internal reloads (e.g. opening /checkout directly) must not wipe it.
  const hasSignal = !!(touch.utm_source || touch.utm_medium || touch.utm_campaign || touch.fbclid || touch.campaign_id || touch.ad_id || touch.referrer);
  if (hasSignal || !readJson<Touch>(LAST_KEY)) writeJson(LAST_KEY, touch);

  // _fbc per Meta's format: fb.1.<creation time ms>.<fbclid> – only when we have a click id and no cookie yet
  if (touch.fbclid && !readCookie("_fbc")) {
    const fbc = `fb.1.${Date.now()}.${touch.fbclid}`;
    document.cookie = `_fbc=${encodeURIComponent(fbc)}; path=/; max-age=${60 * 60 * 24 * 90}; SameSite=Lax`;
  }
}

/** Attribution payload in the shape POST /storefront/checkout accepts. */
export function attributionPayload() {
  const first = readJson<Touch>(FIRST_KEY);
  const last = readJson<Touch>(LAST_KEY);
  const out: Record<string, string | undefined> = {
    firstSource: first?.utm_source,
    firstMedium: first?.utm_medium,
    firstCampaign: first?.utm_campaign,
    firstContent: first?.utm_content,
    firstTerm: first?.utm_term,
    firstLandingPage: first?.landing_page,
    firstTouchAt: first?.ts,
    lastSource: last?.utm_source,
    lastMedium: last?.utm_medium,
    lastCampaign: last?.utm_campaign,
    lastContent: last?.utm_content,
    lastTerm: last?.utm_term,
    lastLandingPage: last?.landing_page,
    lastTouchAt: last?.ts,
    referrer: last?.referrer ?? first?.referrer,
    fbclid: last?.fbclid ?? first?.fbclid,
    fbc: clip(readCookie("_fbc")),
    fbp: clip(readCookie("_fbp")),
    campaignId: last?.campaign_id ?? first?.campaign_id,
    adsetId: last?.adset_id ?? first?.adset_id,
    adId: last?.ad_id ?? first?.ad_id,
  };
  // drop empties so the server's optional fields stay undefined
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v)) as Record<string, string>;
}

// ───────────── Meta Pixel ─────────────
//
// Every browser event carries an eventID. ViewContent / InitiateCheckout / AddToCart are mirrored to our server,
// which sends the same event (same eventID) through the Conversions API, so Meta keeps one of each pair.
// Purchase is NEVER built here: the backend hands out the Purchase payload exactly once per order
// (see firePurchase), so refreshes, revisits and retried checkouts cannot create a second conversion.

type FbqArgs = [string, string, Record<string, unknown>?, { eventID: string }?];
declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void;
    __bbPixelQ?: FbqArgs[];
    /** set by <StoreTracking> when a pixel id is configured */
    __bbPixelOn?: boolean;
  }
}

export type PixelEvent = "PageView" | "ViewContent" | "AddToCart" | "InitiateCheckout" | "Purchase";

export const pixelEnabled = () => typeof window !== "undefined" && !!window.__bbPixelOn;

/** Fire a standard pixel event. Queued until the pixel script initialises (no-op when no pixel is configured). */
export function track(event: PixelEvent, data?: Record<string, unknown>, eventID?: string) {
  if (!pixelEnabled()) return;
  const args: FbqArgs = ["track", event, data, eventID ? { eventID } : undefined];
  while (args.length && args[args.length - 1] === undefined) args.pop();
  if (window.fbq) window.fbq(...args);
  else (window.__bbPixelQ ??= []).push(args);
}

const newEventId = (prefix: string) =>
  `${prefix}.${typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}${Math.random().toString(36).slice(2)}`}`;

type Line = { sku: string; quantity: number; price: string | number; variantId?: string };

/**
 * Browser event + server mirror (Conversions API) sharing one eventID. The server re-prices items from the
 * catalogue and adds IP / user agent; no personal data is sent from here.
 */
export function trackWithServer(event: "ViewContent" | "InitiateCheckout" | "AddToCart", lines: Line[], extra: Record<string, unknown> = {}) {
  if (!pixelEnabled() || !lines.length) return;
  const eventID = newEventId(event === "ViewContent" ? "vc" : event === "AddToCart" ? "atc" : "ic");
  track(event, { ...contentData(lines), ...extra }, eventID);
  const items = lines.filter((l) => l.variantId).map((l) => ({ variantId: l.variantId!, quantity: Math.min(10, Math.max(1, l.quantity)) }));
  if (!items.length) return;
  try {
    void fetch("/api/v1/storefront/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      keepalive: true, // survives navigation (e.g. Add to bag → checkout)
      credentials: "same-origin",
      body: JSON.stringify({ eventName: event, eventId: eventID, eventSourceUrl: window.location.href, items, fbp: readCookie("_fbp"), fbc: readCookie("_fbc") }),
    }).catch(() => {});
  } catch {
    // tracking must never break shopping
  }
}

export interface ServerPurchase {
  eventName: "Purchase";
  eventId: string;
  data: Record<string, unknown>;
}

const PURCHASE_DONE = "bb_px_purchase_";

/**
 * Fire the Pixel Purchase from the payload the backend issued for this order (same eventID and parameters as
 * the server Conversions API event). The backend issues it only once; this per-device guard additionally
 * stops a second fire if the same payload is ever replayed in this browser.
 */
export function firePurchase(p: ServerPurchase | null | undefined) {
  if (!p?.eventId) return false;
  try {
    if (localStorage.getItem(PURCHASE_DONE + p.eventId)) return false;
    localStorage.setItem(PURCHASE_DONE + p.eventId, String(Date.now()));
  } catch {
    // storage unavailable – the server-side one-time hand-off still prevents duplicates
  }
  track("Purchase", p.data, p.eventId);
  return true;
}

/** InitiateCheckout once per cart content per browsing session (reloading the checkout page does not repeat it). */
export function initiateCheckoutOnce(lines: (Line & { variantId: string })[]) {
  if (!pixelEnabled() || !lines.length) return;
  const signature = lines.map((l) => `${l.variantId}x${l.quantity}`).sort().join("|");
  try {
    if (sessionStorage.getItem("bb_px_ic") === signature) return;
    sessionStorage.setItem("bb_px_ic", signature);
  } catch {
    // ignore – fire anyway
  }
  trackWithServer("InitiateCheckout", lines);
}

/** Pixel content payload (SKUs – the same ids the server sends – quantities and value only). */
export function contentData(lines: { sku: string; quantity: number; price: string | number }[], value?: number) {
  const total = value ?? lines.reduce((s, l) => s + Number(l.price) * l.quantity, 0);
  return {
    content_type: "product",
    content_ids: lines.map((l) => l.sku),
    contents: lines.map((l) => ({ id: l.sku, quantity: l.quantity, item_price: Number(l.price) })),
    num_items: lines.reduce((s, l) => s + l.quantity, 0),
    value: Math.round(total * 100) / 100,
    currency: "BDT",
  };
}
