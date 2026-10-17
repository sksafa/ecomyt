import { safeEqual } from "../../../lib/crypto.js";
import type { ShipmentStatus } from "../../../generated/prisma/enums.js";
import type { WebhookRequest } from "../types.js";

export const header = (req: WebhookRequest, name: string): string | undefined => {
  const v = req.headers[name.toLowerCase()];
  return Array.isArray(v) ? v[0] : v;
};

/** Constant-time comparison of a shared secret; false when we have no secret configured. */
export const secretMatches = (expected: string | null, given: string | undefined | null) =>
  !!expected && !!given && safeEqual(expected, given);

/** Status lookup tolerant of case, spaces, dashes and underscores. */
export function mapStatus(map: Record<string, ShipmentStatus | null>, raw: string | null | undefined): ShipmentStatus | null {
  if (!raw) return null;
  const key = raw.toLowerCase().trim().replace(/[\s-]+/g, "_");
  for (const [k, v] of Object.entries(map)) if (k.toLowerCase().replace(/[\s-]+/g, "_") === key) return v;
  return null;
}

export const required = (creds: Record<string, string>, ...keys: string[]) => {
  const missing = keys.filter((k) => !creds[k]);
  if (missing.length) throw new Error(`Missing courier credentials: ${missing.join(", ")}`);
};

/** Whole-taka COD amount (couriers expect integers). */
export const takaInt = (amount: string) => Math.round(Number(amount));
