import { z } from "zod";
import { createModule, dateRangeQuery, pageMeta, pageQuery, withMeta } from "../../http/route.js";
import { prisma, Prisma } from "../../lib/prisma.js";
import { badRequest } from "../../lib/errors.js";
import { audit } from "../../lib/audit.js";
import { money, sum } from "../../lib/money.js";
import { dhakaRange } from "../../lib/time.js";
import { applyMovement, type Deltas } from "./inventory.service.js";

export const inventoryModule = createModule("/inventory", "Inventory");
const { route } = inventoryModule;

route({
  method: "get",
  path: "/",
  summary: "Stock levels per variant",
  access: "inventory.view",
  query: pageQuery.extend({ search: z.string().trim().max(100).optional(), lowStock: z.enum(["true"]).optional() }),
  handler: async ({ query, user }) => {
    const where: Prisma.ProductVariantWhereInput = {
      product: { status: { not: "ARCHIVED" } },
      ...(query.search ? { OR: [{ sku: { contains: query.search, mode: "insensitive" } }, { product: { name: { contains: query.search, mode: "insensitive" } } }] } : {}),
    };
    if (query.lowStock) {
      const low = await prisma.$queryRaw<{ id: string }[]>`
        SELECT v.id FROM "ProductVariant" v LEFT JOIN "InventoryLevel" i ON i."variantId" = v.id
        WHERE v."isActive" AND COALESCE(i.available, 0) <= v."lowStockThreshold"`;
      where.id = { in: low.map((l) => l.id) };
    }
    const [rows, total] = await Promise.all([
      prisma.productVariant.findMany({
        where,
        include: { inventory: true, product: { select: { id: true, name: true, costPrice: true, images: { take: 1, orderBy: { sortOrder: "asc" } } } } },
        orderBy: [{ product: { name: "asc" } }, { sku: "asc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      prisma.productVariant.count({ where }),
    ]);
    const finance = user.permissions.has("finance.view");
    return withMeta(
      rows.map((v) => {
        const unitCost = money(v.costPrice ?? v.product.costPrice);
        const onHand = (v.inventory?.available ?? 0) + (v.inventory?.reserved ?? 0);
        return {
          variantId: v.id, sku: v.sku, name: v.name, color: v.color, size: v.size, isActive: v.isActive,
          productId: v.product.id, productName: v.product.name, imageUrl: v.imageUrl ?? v.product.images[0]?.url ?? null,
          available: v.inventory?.available ?? 0, reserved: v.inventory?.reserved ?? 0, damaged: v.inventory?.damaged ?? 0, returned: v.inventory?.returned ?? 0,
          lowStockThreshold: v.lowStockThreshold, lowStock: (v.inventory?.available ?? 0) <= v.lowStockThreshold,
          ...(finance ? { unitCost: unitCost.toFixed(2), stockValue: unitCost.times(onHand).toFixed(2) } : {}),
        };
      }),
      pageMeta(query.page, query.pageSize, total),
    );
  },
});

route({
  method: "get",
  path: "/valuation",
  summary: "Inventory valuation at cost (sellable = available + reserved)",
  access: ["inventory.view", "finance.view"],
  handler: async () => {
    const variants = await prisma.productVariant.findMany({ include: { inventory: true, product: { select: { costPrice: true } } } });
    let units = 0;
    let damagedUnits = 0;
    const value = sum(
      variants.map((v) => {
        const onHand = (v.inventory?.available ?? 0) + (v.inventory?.reserved ?? 0);
        units += onHand;
        damagedUnits += v.inventory?.damaged ?? 0;
        return money(v.costPrice ?? v.product.costPrice).times(onHand);
      }),
    );
    return { units, value: value.toFixed(2), damagedUnits, method: "Current unit cost × units on hand" };
  },
});

route({
  method: "post",
  path: "/adjust",
  summary: "Adjust stock with a reason (counted stock, damage, found items…)",
  description: "bucket=available|damaged; quantity is signed. Moving to damaged uses mode=to_damaged.",
  access: "inventory.adjust",
  body: z.object({
    variantId: z.string(),
    mode: z.enum(["available", "damaged", "to_damaged", "dispose_damaged"]),
    quantity: z.number().int().refine((n) => n !== 0, "Quantity cannot be zero").refine((n) => Math.abs(n) <= 100_000),
    reason: z.string().trim().min(3).max(300),
  }),
  handler: async ({ body, user, ip }) => {
    const q = Math.abs(body.quantity);
    let deltas: Deltas;
    let type: "ADJUST" | "DAMAGE" | "DISPOSE" = "ADJUST";
    switch (body.mode) {
      case "available": deltas = { available: body.quantity }; break;
      case "damaged": deltas = { damaged: body.quantity }; break;
      case "to_damaged": if (body.quantity < 0) throw badRequest("Use a positive quantity"); deltas = { available: -q, damaged: q }; type = "DAMAGE"; break;
      case "dispose_damaged": if (body.quantity < 0) throw badRequest("Use a positive quantity"); deltas = { damaged: -q }; type = "DISPOSE"; break;
    }
    return prisma.$transaction(async (tx) => {
      const result = await applyMovement(tx, { variantId: body.variantId, type, quantity: q, deltas, reason: body.reason, userId: user.id });
      await audit(tx, { userId: user.id, action: "inventory.adjusted", entityType: "ProductVariant", entityId: body.variantId, after: { mode: body.mode, quantity: body.quantity }, reason: body.reason, ip });
      return result;
    });
  },
});

route({
  method: "get",
  path: "/movements",
  summary: "Stock movement history",
  access: "inventory.view",
  query: pageQuery.merge(dateRangeQuery).extend({ variantId: z.string().optional(), orderId: z.string().optional(), type: z.string().optional() }),
  handler: async ({ query }) => {
    const range = dhakaRange(query.from, query.to);
    const where: Prisma.InventoryMovementWhereInput = {
      ...(query.variantId ? { variantId: query.variantId } : {}),
      ...(query.orderId ? { orderId: query.orderId } : {}),
      ...(query.type ? { type: query.type as never } : {}),
      ...(range.gte || range.lt ? { createdAt: range } : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.inventoryMovement.findMany({
        where, orderBy: { createdAt: "desc" }, skip: (query.page - 1) * query.pageSize, take: query.pageSize,
        include: { variant: { select: { sku: true, name: true, product: { select: { name: true } } } }, user: { select: { id: true, name: true } } },
      }),
      prisma.inventoryMovement.count({ where }),
    ]);
    return withMeta(rows, pageMeta(query.page, query.pageSize, total));
  },
});
