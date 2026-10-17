import { Prisma } from "../generated/prisma/client.js";

// All money math goes through Prisma.Decimal (decimal.js) – never JS floats.
export const Decimal = Prisma.Decimal;
export type Decimal = Prisma.Decimal;
export type MoneyInput = Prisma.Decimal | number | string | null | undefined;

export const ZERO = new Decimal(0);

export function money(v: MoneyInput): Prisma.Decimal {
  if (v === null || v === undefined || v === "") return new Decimal(0);
  return new Decimal(v as string | number | Prisma.Decimal).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

export function sum(values: MoneyInput[]): Prisma.Decimal {
  return values.reduce<Prisma.Decimal>((acc, v) => acc.plus(money(v)), new Decimal(0));
}

export const max0 = (v: Prisma.Decimal) => (v.isNegative() ? new Decimal(0) : v);

/** Serialise for JSON responses: fixed 2dp string keeps precision for clients. */
export const toMoneyString = (v: MoneyInput) => money(v).toFixed(2);

/** "৳1,234.50" – BDT display formatting (lakh grouping as used in Bangladesh). */
export function formatBdt(v: MoneyInput): string {
  const n = money(v);
  const [int, frac] = n.abs().toFixed(2).split(".");
  const last3 = int.slice(-3);
  const rest = int.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  const grouped = rest ? `${rest},${last3}` : last3;
  return `${n.isNegative() ? "-" : ""}৳${grouped}${frac === "00" ? "" : `.${frac}`}`;
}
