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

type FbqArgs = [string, string, Record<string, unknown>?, { eventID: string }?];
declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void;
    __bbPixelQ?: FbqArgs[];
  }
}

export type PixelEvent = "PageView" | "ViewContent" | "AddToCart" | "InitiateCheckout" | "Purchase";

/** Fire a standard pixel event. Queued until the pixel script initialises (no-op forever if no pixel id). */
export function track(event: PixelEvent, data?: Record<string, unknown>, eventID?: string) {
  if (typeof window === "undefined") return;
  const args: FbqArgs = ["track", event, data, eventID ? { eventID } : undefined];
  while (args.length && args[args.length - 1] === undefined) args.pop();
  if (window.fbq) window.fbq(...args);
  else (window.__bbPixelQ ??= []).push(args);
}

/** Pixel content payload (SKUs – same ids the server-side Conversions API sends – quantities and value only). */
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
