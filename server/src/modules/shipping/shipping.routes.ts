import { z } from "zod";
import { createModule, idParam, moneySchema } from "../../http/route.js";
import { prisma } from "../../lib/prisma.js";
import { audit } from "../../lib/audit.js";
import { money } from "../../lib/money.js";
import { calculateDeliveryCharge, resolveLocation } from "./shipping.service.js";

export const shippingModule = createModule("/shipping", "Shipping");
const { route } = shippingModule;

route({
  method: "get",
  path: "/locations",
  summary: "Divisions → districts → areas (for address pickers)",
  access: "public",
  handler: async () =>
    prisma.division.findMany({
      orderBy: { name: "asc" },
      include: {
        districts: {
          orderBy: { name: "asc" },
          select: { id: true, name: true, nameBn: true, zone: { select: { code: true } }, areas: { orderBy: { name: "asc" }, select: { id: true, name: true, nameBn: true, zone: { select: { code: true } } } } },
        },
      },
    }),
});

route({
  method: "post",
  path: "/quote",
  summary: "Delivery charge for a location, weight and merchandise total",
  access: "public",
  body: z.object({
    districtId: z.string().nullish(),
    areaId: z.string().nullish(),
    districtName: z.string().nullish(),
    weightGrams: z.number().int().min(0).max(100_000).default(500),
    merchandiseTotal: moneySchema.default("0"),
  }),
  handler: async ({ body }) => {
    const loc = await resolveLocation(prisma, body);
    const charge = await calculateDeliveryCharge(prisma, loc.zoneId, body.weightGrams, money(body.merchandiseTotal));
    return { zone: loc.zoneCode, district: loc.districtName, area: loc.areaName, deliveryCharge: charge.toFixed(2) };
  },
});

const zoneSchema = z.object({
  name: z.string().trim().min(2).max(60),
  baseCharge: moneySchema,
  baseWeightGrams: z.number().int().min(0).max(100_000),
  perKgCharge: moneySchema,
  freeShippingAbove: moneySchema.nullable(),
  isActive: z.boolean(),
  sortOrder: z.number().int().default(0),
});

route({
  method: "get",
  path: "/zones",
  summary: "Delivery zones and rates",
  access: "orders.view",
  handler: () => prisma.deliveryZone.findMany({ orderBy: { sortOrder: "asc" }, include: { _count: { select: { districts: true, areas: true } } } }),
});

route({
  method: "post",
  path: "/zones",
  summary: "Create a delivery zone",
  access: "shipping.manage",
  status: 201,
  body: zoneSchema.extend({ code: z.string().regex(/^[A-Z0-9_]{2,30}$/) }),
  handler: async ({ body, user, ip }) => {
    const z = await prisma.deliveryZone.create({ data: { ...body, baseCharge: money(body.baseCharge), perKgCharge: money(body.perKgCharge), freeShippingAbove: body.freeShippingAbove ? money(body.freeShippingAbove) : null } });
    await audit(prisma, { userId: user.id, action: "shipping.zone_created", entityType: "DeliveryZone", entityId: z.id, after: body, ip });
    return z;
  },
});

route({
  method: "put",
  path: "/zones/:id",
  summary: "Update a delivery zone's rates (no code change needed)",
  access: "shipping.manage",
  params: idParam,
  body: zoneSchema,
  handler: async ({ params, body, user, ip }) => {
    const before = await prisma.deliveryZone.findUniqueOrThrow({ where: { id: params.id } });
    const z = await prisma.deliveryZone.update({ where: { id: params.id }, data: { ...body, baseCharge: money(body.baseCharge), perKgCharge: money(body.perKgCharge), freeShippingAbove: body.freeShippingAbove ? money(body.freeShippingAbove) : null } });
    await audit(prisma, { userId: user.id, action: "shipping.zone_updated", entityType: "DeliveryZone", entityId: z.id, before, after: z, ip });
    return z;
  },
});

route({
  method: "put",
  path: "/districts/:id/zone",
  summary: "Assign a district to a delivery zone",
  access: "shipping.manage",
  params: idParam,
  body: z.object({ zoneId: z.string().nullable() }),
  handler: async ({ params, body, user, ip }) => {
    const d = await prisma.district.update({ where: { id: params.id }, data: { zoneId: body.zoneId } });
    await audit(prisma, { userId: user.id, action: "shipping.district_zone", entityType: "District", entityId: d.id, after: body, ip });
    return d;
  },
});

route({
  method: "post",
  path: "/districts/:id/areas",
  summary: "Add a delivery area to a district (optionally with its own zone)",
  access: "shipping.manage",
  status: 201,
  params: idParam,
  body: z.object({ name: z.string().trim().min(2).max(80), nameBn: z.string().max(80).nullish(), zoneId: z.string().nullish() }),
  handler: async ({ params, body }) => prisma.area.create({ data: { districtId: params.id, name: body.name, nameBn: body.nameBn ?? null, zoneId: body.zoneId ?? null } }),
});

route({
  method: "put",
  path: "/areas/:id",
  summary: "Update an area (name / zone override)",
  access: "shipping.manage",
  params: idParam,
  body: z.object({ name: z.string().trim().min(2).max(80), nameBn: z.string().max(80).nullish(), zoneId: z.string().nullish() }),
  handler: ({ params, body }) => prisma.area.update({ where: { id: params.id }, data: { name: body.name, nameBn: body.nameBn ?? null, zoneId: body.zoneId ?? null } }),
});

const pickupSchema = z.object({
  name: z.string().trim().min(2).max(80),
  contactName: z.string().trim().min(2).max(80),
  phone: z.string().min(10).max(20),
  address: z.string().trim().min(5).max(300),
  districtName: z.string().max(80).nullish(),
  areaName: z.string().max(80).nullish(),
  isDefault: z.boolean().default(false),
  isActive: z.boolean().default(true),
});

route({ method: "get", path: "/pickup-addresses", summary: "Pickup addresses", access: "shipments.view", handler: () => prisma.pickupAddress.findMany({ orderBy: { createdAt: "asc" } }) });

route({
  method: "post",
  path: "/pickup-addresses",
  summary: "Add a pickup address",
  access: "shipping.manage",
  status: 201,
  body: pickupSchema,
  handler: async ({ body }) =>
    prisma.$transaction(async (tx) => {
      if (body.isDefault) await tx.pickupAddress.updateMany({ data: { isDefault: false } });
      return tx.pickupAddress.create({ data: body });
    }),
});

route({
  method: "put",
  path: "/pickup-addresses/:id",
  summary: "Update a pickup address",
  access: "shipping.manage",
  params: idParam,
  body: pickupSchema,
  handler: async ({ params, body }) =>
    prisma.$transaction(async (tx) => {
      if (body.isDefault) await tx.pickupAddress.updateMany({ where: { id: { not: params.id } }, data: { isDefault: false } });
      return tx.pickupAddress.update({ where: { id: params.id }, data: body });
    }),
});
