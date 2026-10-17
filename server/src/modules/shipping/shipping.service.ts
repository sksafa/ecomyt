import type { Db } from "../../lib/prisma.js";
import { money, ZERO, type Decimal } from "../../lib/money.js";
import { badRequest } from "../../lib/errors.js";

export interface ResolvedLocation {
  districtId: string | null;
  districtName: string | null;
  divisionName: string | null;
  areaId: string | null;
  areaName: string | null;
  zoneId: string | null;
  zoneCode: string | null;
}

/** Area zone overrides district zone; anything unknown falls back to OUTSIDE_DHAKA. */
export async function resolveLocation(db: Db, input: { districtId?: string | null; areaId?: string | null; districtName?: string | null; areaName?: string | null }): Promise<ResolvedLocation> {
  const area = input.areaId
    ? await db.area.findUnique({ where: { id: input.areaId }, include: { zone: true, district: { include: { zone: true, division: true } } } })
    : null;
  if (input.areaId && !area) throw badRequest("Unknown delivery area");

  const district = area?.district
    ?? (input.districtId
      ? await db.district.findUnique({ where: { id: input.districtId }, include: { zone: true, division: true } })
      : input.districtName
        ? await db.district.findFirst({ where: { name: { equals: input.districtName.trim(), mode: "insensitive" } }, include: { zone: true, division: true } })
        : null);
  if (input.districtId && !district) throw badRequest("Unknown district");

  let zone = area?.zone ?? district?.zone ?? null;
  if (!zone) zone = await db.deliveryZone.findUnique({ where: { code: "OUTSIDE_DHAKA" } });

  return {
    districtId: district?.id ?? null,
    districtName: district?.name ?? input.districtName ?? null,
    divisionName: district?.division?.name ?? null,
    areaId: area?.id ?? null,
    areaName: area?.name ?? input.areaName ?? null,
    zoneId: zone?.id ?? null,
    zoneCode: zone?.code ?? null,
  };
}

/** base charge for the first baseWeight, then perKg for each started extra kilogram; free above threshold. */
export async function calculateDeliveryCharge(db: Db, zoneId: string | null, weightGrams: number, merchandiseTotal: Decimal, freeShipping = false): Promise<Decimal> {
  if (freeShipping || !zoneId) return ZERO;
  const zone = await db.deliveryZone.findUnique({ where: { id: zoneId } });
  if (!zone || !zone.isActive) return ZERO;
  if (zone.freeShippingAbove && merchandiseTotal.greaterThanOrEqualTo(zone.freeShippingAbove)) return ZERO;
  const extraKg = Math.max(0, Math.ceil((weightGrams - zone.baseWeightGrams) / 1000));
  return money(zone.baseCharge).plus(money(zone.perKgCharge).times(extraKg));
}
