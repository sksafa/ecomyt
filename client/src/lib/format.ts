import { TZDate } from "@date-fns/tz";
import { format, formatDistanceToNowStrict } from "date-fns";

export const TZ = "Asia/Dhaka";

/** Money arrives as decimal strings; display with ৳ and South-Asian (lakh) digit grouping. */
export function bdt(value: string | number | null | undefined, opts: { decimals?: boolean } = {}) {
  if (value === null || value === undefined || value === "") return "৳0";
  const n = Number(value);
  if (!Number.isFinite(n)) return "৳—";
  const showDecimals = opts.decimals ?? !Number.isInteger(n);
  const s = new Intl.NumberFormat("en-IN", { minimumFractionDigits: showDecimals ? 2 : 0, maximumFractionDigits: 2 }).format(Math.abs(n));
  return `${n < 0 ? "-" : ""}৳${s}`;
}

export const num = (v: number | string | null | undefined) => new Intl.NumberFormat("en-IN").format(Number(v ?? 0));

const inDhaka = (d: string | Date) => new TZDate(new Date(d), TZ);

/** "11:50 AM" in Dhaka time */
export const dhakaTime = (d: string | Date | null | undefined) => (d ? format(inDhaka(d), "h:mm a") : "—");
/** "17/10/2026" in Dhaka time */
export const dhakaDay = (d: string | Date | null | undefined) => (d ? format(inDhaka(d), "dd/MM/yyyy") : "—");
/** "17 Oct 2026, 11:50 AM" */
export const dhakaDateTime = (d: string | Date | null | undefined) => (d ? format(inDhaka(d), "d MMM yyyy, h:mm a") : "—");
export const ago = (d: string | Date | null | undefined) => (d ? `${formatDistanceToNowStrict(new Date(d))} ago` : "—");

/** YYYY-MM-DD of "today" in Dhaka, for date filters. */
export const dhakaToday = () => format(new TZDate(new Date(), TZ), "yyyy-MM-dd");
export const dhakaDaysAgo = (days: number) => format(new TZDate(new Date(Date.now() - days * 86_400_000), TZ), "yyyy-MM-dd");

export const telHref = (phone: string) => `tel:${phone}`;
/** WhatsApp click-to-chat (opens the user's own WhatsApp – no automated messaging). */
export const whatsappHref = (phone: string, text?: string) => `https://wa.me/88${phone.replace(/^\+?88/, "")}${text ? `?text=${encodeURIComponent(text)}` : ""}`;

export function titleCase(s: string) {
  return s.toLowerCase().replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
