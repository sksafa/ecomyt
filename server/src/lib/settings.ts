import { prisma, type Db } from "./prisma.js";
import { Prisma } from "../generated/prisma/client.js";

// Typed defaults for every configurable business rule. Stored overrides are merged on top,
// so new keys get sensible values without a migration.
export const SETTING_DEFAULTS = {
  store: {
    name: "Bent & Bound",
    tagline: "Premium embroidered orna",
    phone: "",
    email: "",
    address: "",
    logoUrl: "",
    currency: "BDT",
    timezone: "Asia/Dhaka",
  },
  inventory: {
    /** Stock is reserved as soon as an order is created so it cannot be oversold. */
    reserveOn: "ORDER_CREATED" as "ORDER_CREATED" | "CONFIRMED",
    /** Reserved stock leaves the books when the parcel leaves the warehouse. */
    deductOn: "SHIPPED" as "COURIER_BOOKED" | "SHIPPED",
    /** Allow orders beyond available stock (pre-orders). */
    allowBackorder: false,
  },
  orders: {
    /** Orders at or above this risk score go to CONFIRMATION_REQUIRED instead of PENDING. */
    confirmationRiskThreshold: 40,
    /** Same phone ordering again within this window is flagged as a possible duplicate. */
    duplicateWindowHours: 24,
    defaultPackagingCost: "20.00",
  },
  finance: {
    /** Courier COD collection charge (% of collected amount) used for estimates until the courier reports actual fees. */
    codChargePercent: "1.00",
    /** Estimated courier delivery fee by delivery-zone code, until the courier reports the real fee. */
    estimatedCourierFee: { INSIDE_DHAKA: "60.00", SUB_DHAKA: "100.00", OUTSIDE_DHAKA: "120.00" } as Record<string, string>,
    /** Estimated RTO charge as a share of the delivery fee when the courier has not reported one. */
    estimatedReturnFeeRatio: "0.5",
  },
  meta: {
    pixelId: "",
    capiEnabled: false,
  },
  statusLabels: {} as Record<string, { en?: string; bn?: string; color?: string }>,
  notifications: {
    newOrderInApp: true,
    lowStockInApp: true,
    courierFailureInApp: true,
    customerSmsOnConfirm: false,
    customerSmsOnShip: false,
    dailySummaryEmail: "",
    customerSmsLanguage: "en" as "en" | "bn",
  },
  cms: {
    announcementBar: { enabled: false, text: "", textBn: "", link: "" },
    footer: { about: "", facebookUrl: "", instagramUrl: "", whatsapp: "" },
    homepage: { featuredCollectionSlugs: [] as string[] },
  },
};

export type SettingKey = keyof typeof SETTING_DEFAULTS;
export type SettingValue<K extends SettingKey> = (typeof SETTING_DEFAULTS)[K];

const SETTING_GROUP: Record<SettingKey, string> = {
  store: "general",
  inventory: "operations",
  orders: "operations",
  finance: "finance",
  meta: "marketing",
  statusLabels: "operations",
  notifications: "notifications",
  cms: "content",
};

function merge<T>(base: T, override: unknown): T {
  if (override === null || typeof override !== "object" || Array.isArray(override)) {
    return (override === undefined ? base : (override as T));
  }
  if (base === null || typeof base !== "object" || Array.isArray(base)) return override as T;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(override as Record<string, unknown>)) {
    out[k] = merge((base as Record<string, unknown>)[k], v);
  }
  return out as T;
}

const cache = new Map<string, { value: unknown; at: number }>();
const TTL_MS = 5_000;

export async function getSetting<K extends SettingKey>(key: K, db: Db = prisma): Promise<SettingValue<K>> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value as SettingValue<K>;
  const row = await db.setting.findUnique({ where: { key } });
  const value = merge(SETTING_DEFAULTS[key], row?.value);
  cache.set(key, { value, at: Date.now() });
  return value;
}

export async function setSetting<K extends SettingKey>(
  key: K,
  value: Partial<SettingValue<K>>,
  userId: string | null,
  db: Db = prisma,
) {
  const current = await getSetting(key, db);
  const next = merge(current, value);
  await db.setting.upsert({
    where: { key },
    create: { key, group: SETTING_GROUP[key], value: next as Prisma.InputJsonValue, updatedById: userId },
    update: { value: next as Prisma.InputJsonValue, updatedById: userId },
  });
  cache.delete(key);
  return { before: current, after: next };
}

export const clearSettingsCache = () => cache.clear();
