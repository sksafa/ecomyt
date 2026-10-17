// Business dates are in Asia/Dhaka (UTC+6, no DST). Timestamps are stored in UTC.
export const BUSINESS_TZ = "Asia/Dhaka";
const OFFSET_MS = 6 * 60 * 60 * 1000;

/** YYYY-MM-DD of the given instant in Dhaka. */
export function dhakaDate(d: Date = new Date()): string {
  return new Date(d.getTime() + OFFSET_MS).toISOString().slice(0, 10);
}

/** UTC instant of 00:00 Dhaka time on the given YYYY-MM-DD. */
export function startOfDhakaDay(date: string): Date {
  return new Date(new Date(`${date}T00:00:00.000Z`).getTime() - OFFSET_MS);
}

/** Exclusive UTC upper bound: 00:00 Dhaka on the following day. */
export function endOfDhakaDayExclusive(date: string): Date {
  return new Date(startOfDhakaDay(date).getTime() + 24 * 60 * 60 * 1000);
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Resolve an inclusive Dhaka date range into a [gte, lt) UTC window. */
export function dhakaRange(from?: string, to?: string): { gte?: Date; lt?: Date } {
  return {
    ...(from ? { gte: startOfDhakaDay(from) } : {}),
    ...(to ? { lt: endOfDhakaDayExclusive(to) } : {}),
  };
}

/** Date-only column value (Postgres DATE) for a Dhaka business day. */
export const dateOnly = (date: string) => new Date(`${date}T00:00:00.000Z`);

/** YYMMDD in Dhaka time, used in human-facing document numbers. */
export const dhakaYymmdd = (d: Date = new Date()) => dhakaDate(d).slice(2).replaceAll("-", "");
