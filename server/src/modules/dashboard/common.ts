import { Prisma } from "../../lib/prisma.js";
import { badRequest } from "../../lib/errors.js";
import { money, type MoneyInput } from "../../lib/money.js";
import { addDays, dhakaDate, dhakaRange } from "../../lib/time.js";
import type { AuthUser } from "../../middleware/auth.js";

export const TZ = "Asia/Dhaka";
export const DEFAULT_RANGE_DAYS = 30;

export interface ResolvedRange {
  from: string;
  to: string;
  /** [gte, lt) UTC window covering the inclusive Dhaka business days. */
  gte: Date;
  lt: Date;
}

/** Inclusive Dhaka business-day range; defaults to the last 30 days ending today (Dhaka). */
export function resolveRange(from?: string, to?: string): ResolvedRange {
  const end = to ?? (from ? addDays(from, DEFAULT_RANGE_DAYS - 1) : dhakaDate());
  const start = from ?? addDays(end, -(DEFAULT_RANGE_DAYS - 1));
  if (start > end) throw badRequest("`from` must be on or before `to`");
  const r = dhakaRange(start, end);
  return { from: start, to: end, gte: r.gte!, lt: r.lt! };
}

export const canSeeFinance = (user: AuthUser) => user.permissions.has("finance.view");

/**
 * Timestamp columns are `timestamp without time zone` holding UTC, so converting to Dhaka wall-clock
 * time needs both hops: interpret as UTC, then render in Asia/Dhaka.
 */
export const dhakaLocal = (column: string) => Prisma.raw(`((${column} AT TIME ZONE 'UTC') AT TIME ZONE '${TZ}')`);

/** A JS instant as a UTC `timestamp` literal comparable with the stored columns (independent of the session TZ). */
export const ts = (d: Date) => Prisma.sql`(${d.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;

/** `column >= gte AND column < lt` for a resolved range. */
export const inRange = (column: string, r: { gte: Date; lt: Date }) =>
  Prisma.sql`${Prisma.raw(column)} >= ${ts(r.gte)} AND ${Prisma.raw(column)} < ${ts(r.lt)}`;

export const fixed = (v: MoneyInput) => money(v).toFixed(2);
/** Costs are stored as negative ledger amounts; KPIs show them as positive spend. */
export const cost = (v: MoneyInput) => money(v).negated().toFixed(2);

export const pct = (num: number, den: number) => (den > 0 ? Math.round((num / den) * 1000) / 10 : null);
export const ratio = (num: MoneyInput, den: number) => (den > 0 ? money(num).dividedBy(den).toFixed(2) : null);

// ───────────── order filters shared by dashboard and reports ─────────────

export interface OrderFilter {
  channel?: string[];
  productId?: string;
}

export const isFiltered = (f: OrderFilter) => !!(f.channel?.length || f.productId);

export function orderWhere(f: OrderFilter): Prisma.OrderWhereInput {
  return {
    ...(f.channel?.length ? { channel: { in: f.channel as never } } : {}),
    ...(f.productId ? { items: { some: { productId: f.productId } } } : {}),
  };
}

/** SQL fragment (starting with AND, or empty) restricting alias `o` ("Order") by the filter. */
export function orderSqlFilter(f: OrderFilter, alias = "o"): Prisma.Sql {
  const parts: Prisma.Sql[] = [];
  if (f.channel?.length) parts.push(Prisma.sql`AND ${Prisma.raw(alias)}.channel::text = ANY(${f.channel})`);
  if (f.productId)
    parts.push(Prisma.sql`AND EXISTS (SELECT 1 FROM "OrderItem" fi WHERE fi."orderId" = ${Prisma.raw(alias)}.id AND fi."productId" = ${f.productId})`);
  return parts.length ? Prisma.join(parts, " ") : Prisma.empty;
}

// ───────────── status groups ─────────────

/** Orders the customer received and kept (or is exchanging). */
export const DELIVERED_STATES = ["DELIVERED", "RETURN_REQUESTED", "EXCHANGE_REQUESTED", "EXCHANGED"] as const;
/** Orders that came back (RTO or returned after delivery). */
export const RETURNED_STATES = ["RETURNED", "RETURN_IN_TRANSIT"] as const;

// ───────────── chart buckets ─────────────

export type Granularity = "day" | "week" | "month" | "year";

/** Bucket key exactly as produced by `bucketSql` (YYYY-MM-DD of the bucket start, Dhaka time). */
export const bucketSql = (column: string, g: Granularity) =>
  Prisma.sql`to_char(date_trunc(${g}, ${dhakaLocal(column)}), 'YYYY-MM-DD')`;

function truncate(date: string, g: Granularity): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  if (g === "week") d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); // ISO week, Monday start (Postgres date_trunc)
  if (g === "month" || g === "year") d.setUTCDate(1);
  if (g === "year") d.setUTCMonth(0);
  return d.toISOString().slice(0, 10);
}

function next(date: string, g: Granularity): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  if (g === "day") d.setUTCDate(d.getUTCDate() + 1);
  if (g === "week") d.setUTCDate(d.getUTCDate() + 7);
  if (g === "month") d.setUTCMonth(d.getUTCMonth() + 1);
  if (g === "year") d.setUTCFullYear(d.getUTCFullYear() + 1);
  return d.toISOString().slice(0, 10);
}

export const MAX_BUCKETS = 1000;

/** Every bucket start between from and to (inclusive), so charts have no gaps. */
export function bucketKeys(from: string, to: string, g: Granularity): string[] {
  const keys: string[] = [];
  for (let k = truncate(from, g); k <= to; k = next(k, g)) {
    keys.push(k);
    if (keys.length > MAX_BUCKETS) throw badRequest(`Too many ${g} buckets for this range; choose a coarser granularity`);
  }
  return keys;
}

export const bucketLabel = (key: string, g: Granularity) => (g === "month" ? key.slice(0, 7) : g === "year" ? key.slice(0, 4) : key);
