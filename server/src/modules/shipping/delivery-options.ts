import type { Db } from "../../lib/prisma.js";
import { getSetting } from "../../lib/settings.js";
import { money, type Decimal } from "../../lib/money.js";
import type { DeliveryOption } from "../../generated/prisma/enums.js";

export const DELIVERY_OPTIONS = ["INSIDE_DHAKA", "OUTSIDE_DHAKA"] as const satisfies readonly DeliveryOption[];
/** Pre-selected at checkout. */
export const DEFAULT_DELIVERY_OPTION: DeliveryOption = "OUTSIDE_DHAKA";

const LABELS: Record<DeliveryOption, { label: string; labelBn: string }> = {
  INSIDE_DHAKA: { label: "Inside Dhaka", labelBn: "ঢাকার ভিতরে" },
  OUTSIDE_DHAKA: { label: "Outside Dhaka", labelBn: "ঢাকার বাইরে" },
};

/** Current checkout delivery options with the charges stored in Settings (the only source of these charges). */
export async function getDeliveryOptions(db?: Db) {
  const cfg = await getSetting("checkout", db);
  const charge: Record<DeliveryOption, Decimal> = {
    INSIDE_DHAKA: money(cfg.insideDhakaCharge),
    OUTSIDE_DHAKA: money(cfg.outsideDhakaCharge),
  };
  return DELIVERY_OPTIONS.map((code) => ({ code, ...LABELS[code], charge: charge[code].toFixed(2), isDefault: code === DEFAULT_DELIVERY_OPTION }));
}

export async function deliveryChargeFor(option: DeliveryOption, db?: Db): Promise<Decimal> {
  const cfg = await getSetting("checkout", db);
  return money(option === "INSIDE_DHAKA" ? cfg.insideDhakaCharge : cfg.outsideDhakaCharge);
}

export const deliveryOptionLabel = (option: DeliveryOption | null | undefined) => (option ? LABELS[option] : null);
