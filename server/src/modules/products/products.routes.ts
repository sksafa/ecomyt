import { z } from "zod";
import { createModule, csvList, idParam, moneySchema, pageMeta, pageQuery, withMeta } from "../../http/route.js";
import { prisma, Prisma } from "../../lib/prisma.js";
import { assertFound, badRequest, conflict } from "../../lib/errors.js";
import { audit, diff } from "../../lib/audit.js";
import { money, sum } from "../../lib/money.js";
import type { AuthUser } from "../../middleware/auth.js";

export const productsModule = createModule("/products", "Products");
export const categoriesModule = createModule("/categories", "Products");
export const collectionsModule = createModule("/collections", "Products");

export const slugify = (s: string) =>
  s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9ঀ-৿]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "item";

const variantSchema = z.object({
  id: z.string().optional(),
  sku: z.string().trim().min(2).max(60),
  barcode: z.string().trim().max(60).nullish(),
  name: z.string().trim().min(1).max(120),
  color: z.string().max(60).nullish(),
  size: z.string().max(60).nullish(),
  price: moneySchema.nullish(),
  costPrice: moneySchema.nullish(),
  weightGrams: z.number().int().min(1).max(50_000).nullish(),
  imageUrl: z.string().max(500).nullish(),
  isActive: z.boolean().default(true),
  lowStockThreshold: z.number().int().min(0).max(100_000).default(5),
  openingStock: z.number().int().min(0).max(1_000_000).optional(), // only on create
});

const costComponentSchema = z.object({
  type: z.enum(["MATERIAL", "FABRIC", "LACE", "EMBROIDERY", "LABOR", "FINISHING", "PACKAGING", "OTHER"]),
  materialId: z.string().nullish(),
  description: z.string().trim().min(1).max(200),
  quantity: z.union([z.number(), z.string()]).transform(String),
  unitCost: moneySchema,
});

const productSchema = z.object({
  name: z.string().trim().min(2).max(200),
  slug: z.string().trim().max(100).optional(),
  sku: z.string().trim().min(2).max(60),
  barcode: z.string().max(60).nullish(),
  shortDescription: z.string().max(500).nullish(),
  description: z.string().max(20_000).nullish(),
  categoryId: z.string().nullish(),
  status: z.enum(["DRAFT", "ACTIVE", "ARCHIVED"]).default("DRAFT"),
  isPublished: z.boolean().default(false),
  isFeatured: z.boolean().default(false),
  regularPrice: moneySchema,
  salePrice: moneySchema.nullish(),
  costPrice: moneySchema.default("0"),
  weightGrams: z.number().int().min(1).max(50_000).default(250),
  lengthCm: moneySchema.nullish(),
  widthCm: moneySchema.nullish(),
  heightCm: moneySchema.nullish(),
  fabric: z.string().max(200).nullish(),
  design: z.string().max(200).nullish(),
  embroidery: z.string().max(200).nullish(),
  careInstructions: z.string().max(2000).nullish(),
  freeShipping: z.boolean().default(false),
  shippingNote: z.string().max(500).nullish(),
  seoTitle: z.string().max(200).nullish(),
  seoDescription: z.string().max(500).nullish(),
  ogImageUrl: z.string().max(500).nullish(),
  images: z.array(z.object({ url: z.string().min(1).max(500), alt: z.string().max(200).nullish() })).max(20).default([]),
  collectionIds: z.array(z.string()).default([]),
  related: z.array(z.object({ productId: z.string(), type: z.enum(["RELATED", "UPSELL"]) })).default([]),
  costComponents: z.array(costComponentSchema).optional(),
  variants: z.array(variantSchema).min(1).max(100),
});

const productInclude = {
  category: { select: { id: true, name: true, slug: true } },
  images: { orderBy: { sortOrder: "asc" } },
  variants: { orderBy: { createdAt: "asc" }, include: { inventory: true } },
  collections: { include: { collection: { select: { id: true, name: true, slug: true } } } },
  related: { include: { related: { select: { id: true, name: true, slug: true } } } },
  costComponents: true,
} satisfies Prisma.ProductInclude;

type FullProduct = Prisma.ProductGetPayload<{ include: typeof productInclude }>;

function shapeProduct(p: FullProduct, user: AuthUser) {
  const finance = user.permissions.has("finance.view") || user.permissions.has("products.manage");
  const stock = p.variants.reduce(
    (acc, v) => ({
      available: acc.available + (v.inventory?.available ?? 0),
      reserved: acc.reserved + (v.inventory?.reserved ?? 0),
    }),
    { available: 0, reserved: 0 },
  );
  return {
    ...p,
    costPrice: finance ? p.costPrice : undefined,
    costComponents: finance ? p.costComponents : undefined,
    computedCost: finance && p.costComponents.length ? sum(p.costComponents.map((c) => money(c.unitCost).times(c.quantity))).toFixed(2) : undefined,
    variants: p.variants.map((v) => ({
      ...v,
      costPrice: finance ? v.costPrice : undefined,
      effectivePrice: money(v.price ?? p.salePrice ?? p.regularPrice).toFixed(2),
      stock: { available: v.inventory?.available ?? 0, reserved: v.inventory?.reserved ?? 0, damaged: v.inventory?.damaged ?? 0, returned: v.inventory?.returned ?? 0 },
      lowStock: (v.inventory?.available ?? 0) <= v.lowStockThreshold,
      inventory: undefined,
    })),
    collections: p.collections.map((c) => c.collection),
    related: p.related.map((r) => ({ ...r.related, type: r.type })),
    stock,
  };
}

productsModule.route({
  method: "get",
  path: "/",
  summary: "List products",
  access: "products.view",
  query: pageQuery.extend({
    search: z.string().trim().max(100).optional(),
    status: csvList,
    categoryId: z.string().optional(),
    collectionId: z.string().optional(),
    published: z.enum(["true", "false"]).optional(),
    lowStock: z.enum(["true"]).optional(),
    sort: z.enum(["-createdAt", "name", "-updatedAt"]).default("-createdAt"),
  }),
  handler: async ({ query, user }) => {
    const where: Prisma.ProductWhereInput = {
      ...(query.status?.length ? { status: { in: query.status as never } } : { status: { not: "ARCHIVED" } }),
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.collectionId ? { collections: { some: { collectionId: query.collectionId } } } : {}),
      ...(query.published ? { isPublished: query.published === "true" } : {}),
      ...(query.search
        ? { OR: [{ name: { contains: query.search, mode: "insensitive" } }, { sku: { contains: query.search, mode: "insensitive" } }, { variants: { some: { OR: [{ sku: { contains: query.search, mode: "insensitive" } }, { barcode: query.search }] } } }] }
        : {}),
    };
    if (query.lowStock) {
      const low = await prisma.$queryRaw<{ productId: string }[]>`
        SELECT DISTINCT v."productId" FROM "ProductVariant" v LEFT JOIN "InventoryLevel" i ON i."variantId" = v.id
        WHERE v."isActive" AND COALESCE(i.available, 0) <= v."lowStockThreshold"`;
      where.id = { in: low.map((l) => l.productId) };
    }
    const sortField = query.sort.replace("-", "") as "createdAt" | "name" | "updatedAt";
    const [rows, total] = await Promise.all([
      prisma.product.findMany({ where, include: productInclude, orderBy: { [sortField]: query.sort.startsWith("-") ? "desc" : "asc" }, skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
      prisma.product.count({ where }),
    ]);
    return withMeta(rows.map((p) => shapeProduct(p, user)), pageMeta(query.page, query.pageSize, total));
  },
});

productsModule.route({
  method: "get",
  path: "/variants/search",
  summary: "Search sellable variants (order entry picker)",
  access: "orders.view",
  query: z.object({ q: z.string().trim().max(100).default(""), limit: z.coerce.number().int().min(1).max(50).default(20) }),
  handler: async ({ query }) => {
    const variants = await prisma.productVariant.findMany({
      where: {
        isActive: true,
        product: { status: { not: "ARCHIVED" } },
        ...(query.q
          ? { OR: [{ sku: { contains: query.q, mode: "insensitive" } }, { barcode: query.q }, { name: { contains: query.q, mode: "insensitive" } }, { product: { name: { contains: query.q, mode: "insensitive" } } }] }
          : {}),
      },
      include: { product: { include: { images: { orderBy: { sortOrder: "asc" }, take: 1 } } }, inventory: true },
      take: query.limit,
      orderBy: { product: { name: "asc" } },
    });
    return variants.map((v) => ({
      id: v.id, sku: v.sku, name: v.name, color: v.color, size: v.size,
      productId: v.productId, productName: v.product.name, imageUrl: v.imageUrl ?? v.product.images[0]?.url ?? null,
      price: money(v.price ?? v.product.salePrice ?? v.product.regularPrice).toFixed(2),
      available: v.inventory?.available ?? 0,
    }));
  },
});

productsModule.route({
  method: "get",
  path: "/:id",
  summary: "Product details with variants, stock and cost breakdown",
  access: "products.view",
  params: idParam,
  handler: async ({ params, user }) => shapeProduct(assertFound(await prisma.product.findUnique({ where: { id: params.id }, include: productInclude }), "Product"), user),
});

async function uniqueSlug(base: string, excludeId?: string) {
  let slug = slugify(base);
  for (let i = 2; await prisma.product.findFirst({ where: { slug, ...(excludeId ? { id: { not: excludeId } } : {}) } }); i++) slug = `${slugify(base)}-${i}`;
  return slug;
}

function productData(body: z.infer<typeof productSchema>) {
  const nullable = (v: string | null | undefined) => (v === undefined ? undefined : v === null ? null : money(v));
  return {
    name: body.name, sku: body.sku, barcode: body.barcode ?? null, shortDescription: body.shortDescription ?? null, description: body.description ?? null,
    categoryId: body.categoryId ?? null, status: body.status, isPublished: body.isPublished && body.status === "ACTIVE", isFeatured: body.isFeatured,
    regularPrice: money(body.regularPrice), salePrice: nullable(body.salePrice) ?? null, costPrice: money(body.costPrice),
    weightGrams: body.weightGrams, lengthCm: nullable(body.lengthCm) ?? null, widthCm: nullable(body.widthCm) ?? null, heightCm: nullable(body.heightCm) ?? null,
    fabric: body.fabric ?? null, design: body.design ?? null, embroidery: body.embroidery ?? null, careInstructions: body.careInstructions ?? null,
    freeShipping: body.freeShipping, shippingNote: body.shippingNote ?? null, seoTitle: body.seoTitle ?? null, seoDescription: body.seoDescription ?? null,
    ogImageUrl: body.ogImageUrl ?? null, archivedAt: body.status === "ARCHIVED" ? new Date() : null,
  };
}

const variantData = (v: z.infer<typeof variantSchema>) => ({
  sku: v.sku, barcode: v.barcode || null, name: v.name, color: v.color ?? null, size: v.size ?? null,
  price: v.price ? money(v.price) : null, costPrice: v.costPrice ? money(v.costPrice) : null,
  weightGrams: v.weightGrams ?? null, imageUrl: v.imageUrl ?? null, isActive: v.isActive, lowStockThreshold: v.lowStockThreshold,
});

function costFromComponents(components?: z.infer<typeof costComponentSchema>[]) {
  if (!components?.length) return null;
  return sum(components.map((c) => money(c.unitCost).times(c.quantity)));
}

productsModule.route({
  method: "post",
  path: "/",
  summary: "Create a product with variants",
  description: "If costComponents are given, costPrice is derived from them (materials, embroidery, lace, labor, packaging…).",
  access: "products.manage",
  status: 201,
  body: productSchema,
  handler: async ({ body, user, ip }) => {
    const skus = body.variants.map((v) => v.sku.toUpperCase());
    if (new Set(skus).size !== skus.length) throw badRequest("Variant SKUs must be unique");
    const derived = costFromComponents(body.costComponents);
    const product = await prisma.$transaction(async (tx) => {
      const p = await tx.product.create({
        data: {
          ...productData(body),
          ...(derived ? { costPrice: derived } : {}),
          slug: await uniqueSlug(body.slug || body.name),
          images: { create: body.images.map((im, i) => ({ url: im.url, alt: im.alt ?? null, sortOrder: i })) },
          collections: { create: body.collectionIds.map((collectionId) => ({ collectionId })) },
          related: { create: body.related.map((r) => ({ relatedId: r.productId, type: r.type })) },
          costComponents: body.costComponents ? { create: body.costComponents.map((c) => ({ ...c, quantity: c.quantity, unitCost: money(c.unitCost), materialId: c.materialId ?? null })) } : undefined,
        },
      });
      for (const v of body.variants) {
        const variant = await tx.productVariant.create({ data: { ...variantData(v), productId: p.id } });
        await tx.inventoryLevel.create({ data: { variantId: variant.id } });
        if (v.openingStock) {
          const { applyMovement } = await import("../inventory/inventory.service.js");
          await applyMovement(tx, { variantId: variant.id, type: "ADJUST", quantity: v.openingStock, deltas: { available: v.openingStock }, reason: "Opening stock", userId: user.id });
        }
      }
      await audit(tx, { userId: user.id, action: "product.created", entityType: "Product", entityId: p.id, after: { name: p.name, sku: p.sku, variants: skus }, ip });
      return tx.product.findUniqueOrThrow({ where: { id: p.id }, include: productInclude });
    });
    return shapeProduct(product, user);
  },
});

productsModule.route({
  method: "put",
  path: "/:id",
  summary: "Update a product (variants without id are added; omitted variants are deactivated)",
  access: "products.manage",
  params: idParam,
  body: productSchema,
  handler: async ({ params, body, user, ip }) => {
    const existing = assertFound(await prisma.product.findUnique({ where: { id: params.id }, include: productInclude }), "Product");
    const derived = costFromComponents(body.costComponents);
    const product = await prisma.$transaction(async (tx) => {
      const data = { ...productData(body), ...(derived ? { costPrice: derived } : {}) };
      await tx.product.update({
        where: { id: params.id },
        data: { ...data, slug: body.slug ? await uniqueSlug(body.slug, params.id) : existing.slug, archivedAt: body.status === "ARCHIVED" ? existing.archivedAt ?? new Date() : null },
      });
      await tx.productImage.deleteMany({ where: { productId: params.id } });
      await tx.productImage.createMany({ data: body.images.map((im, i) => ({ productId: params.id, url: im.url, alt: im.alt ?? null, sortOrder: i })) });
      await tx.productCollection.deleteMany({ where: { productId: params.id } });
      await tx.productCollection.createMany({ data: body.collectionIds.map((collectionId) => ({ productId: params.id, collectionId })) });
      await tx.relatedProduct.deleteMany({ where: { productId: params.id } });
      await tx.relatedProduct.createMany({ data: body.related.filter((r) => r.productId !== params.id).map((r) => ({ productId: params.id, relatedId: r.productId, type: r.type })) });
      if (body.costComponents) {
        await tx.productCostComponent.deleteMany({ where: { productId: params.id } });
        await tx.productCostComponent.createMany({ data: body.costComponents.map((c) => ({ productId: params.id, type: c.type, materialId: c.materialId ?? null, description: c.description, quantity: c.quantity, unitCost: money(c.unitCost) })) });
      }
      const keep = new Set<string>();
      for (const v of body.variants) {
        if (v.id) {
          if (!existing.variants.some((ev) => ev.id === v.id)) throw badRequest(`Variant ${v.id} does not belong to this product`);
          await tx.productVariant.update({ where: { id: v.id }, data: variantData(v) });
          keep.add(v.id);
        } else {
          const nv = await tx.productVariant.create({ data: { ...variantData(v), productId: params.id } });
          await tx.inventoryLevel.create({ data: { variantId: nv.id } });
          keep.add(nv.id);
        }
      }
      // variants are never hard-deleted (order history references them); omitted ones are deactivated
      await tx.productVariant.updateMany({ where: { productId: params.id, id: { notIn: [...keep] } }, data: { isActive: false } });

      const after = await tx.product.findUniqueOrThrow({ where: { id: params.id }, include: productInclude });
      const pick = (p: FullProduct) => ({ name: p.name, status: p.status, isPublished: p.isPublished, regularPrice: p.regularPrice.toFixed(2), salePrice: p.salePrice?.toFixed(2) ?? null, costPrice: p.costPrice.toFixed(2), variants: p.variants.map((v) => `${v.sku}:${v.isActive ? "on" : "off"}:${v.price?.toFixed(2) ?? "-"}`).sort() });
      const d = diff(pick(existing), pick(after));
      if (d.changed) await audit(tx, { userId: user.id, action: "product.updated", entityType: "Product", entityId: params.id, before: d.before, after: d.after, ip });
      return after;
    });
    return shapeProduct(product, user);
  },
});

productsModule.route({
  method: "post",
  path: "/:id/archive",
  summary: "Archive (unpublish) a product – history is kept",
  access: "products.manage",
  params: idParam,
  handler: async ({ params, user, ip }) => {
    const p = await prisma.product.update({ where: { id: params.id }, data: { status: "ARCHIVED", isPublished: false, archivedAt: new Date() } });
    await audit(prisma, { userId: user.id, action: "product.archived", entityType: "Product", entityId: p.id, ip });
    return { id: p.id, status: p.status };
  },
});

// ───────────── categories ─────────────
const categorySchema = z.object({
  name: z.string().trim().min(2).max(100),
  slug: z.string().max(100).optional(),
  parentId: z.string().nullish(),
  description: z.string().max(2000).nullish(),
  imageUrl: z.string().max(500).nullish(),
  sortOrder: z.number().int().default(0),
  isActive: z.boolean().default(true),
});

categoriesModule.route({
  method: "get", path: "/", summary: "List categories", access: "products.view",
  handler: () => prisma.category.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }], include: { _count: { select: { products: true } } } }),
});
categoriesModule.route({
  method: "post", path: "/", summary: "Create category", access: "products.manage", status: 201, body: categorySchema,
  handler: async ({ body, user, ip }) => {
    const slug = slugify(body.slug || body.name);
    if (await prisma.category.findUnique({ where: { slug } })) throw conflict("A category with this slug exists");
    const c = await prisma.category.create({ data: { ...body, slug, parentId: body.parentId ?? null } });
    await audit(prisma, { userId: user.id, action: "category.created", entityType: "Category", entityId: c.id, after: body, ip });
    return c;
  },
});
categoriesModule.route({
  method: "put", path: "/:id", summary: "Update category", access: "products.manage", params: idParam, body: categorySchema,
  handler: async ({ params, body, user, ip }) => {
    if (body.parentId === params.id) throw badRequest("A category cannot be its own parent");
    const c = await prisma.category.update({ where: { id: params.id }, data: { ...body, slug: slugify(body.slug || body.name), parentId: body.parentId ?? null } });
    await audit(prisma, { userId: user.id, action: "category.updated", entityType: "Category", entityId: c.id, after: body, ip });
    return c;
  },
});
categoriesModule.route({
  method: "delete", path: "/:id", summary: "Delete an empty category", access: "products.manage", params: idParam,
  handler: async ({ params, user, ip }) => {
    if (await prisma.product.count({ where: { categoryId: params.id } })) throw conflict("Category still has products; move or archive them first");
    await prisma.category.delete({ where: { id: params.id } });
    await audit(prisma, { userId: user.id, action: "category.deleted", entityType: "Category", entityId: params.id, ip });
    return { deleted: true };
  },
});

// ───────────── collections ─────────────
const collectionSchema = z.object({
  name: z.string().trim().min(2).max(100),
  slug: z.string().max(100).optional(),
  description: z.string().max(2000).nullish(),
  imageUrl: z.string().max(500).nullish(),
  isActive: z.boolean().default(true),
  isFeatured: z.boolean().default(false),
  sortOrder: z.number().int().default(0),
});
collectionsModule.route({
  method: "get", path: "/", summary: "List collections", access: "products.view",
  handler: () => prisma.collection.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }], include: { _count: { select: { products: true } } } }),
});
collectionsModule.route({
  method: "post", path: "/", summary: "Create collection", access: "products.manage", status: 201, body: collectionSchema,
  handler: async ({ body, user, ip }) => {
    const c = await prisma.collection.create({ data: { ...body, slug: slugify(body.slug || body.name) } });
    await audit(prisma, { userId: user.id, action: "collection.created", entityType: "Collection", entityId: c.id, after: body, ip });
    return c;
  },
});
collectionsModule.route({
  method: "put", path: "/:id", summary: "Update collection", access: "products.manage", params: idParam, body: collectionSchema,
  handler: async ({ params, body, user, ip }) => {
    const c = await prisma.collection.update({ where: { id: params.id }, data: { ...body, slug: slugify(body.slug || body.name) } });
    await audit(prisma, { userId: user.id, action: "collection.updated", entityType: "Collection", entityId: c.id, after: body, ip });
    return c;
  },
});
collectionsModule.route({
  method: "delete", path: "/:id", summary: "Delete collection (products are kept)", access: "products.manage", params: idParam,
  handler: async ({ params, user, ip }) => {
    await prisma.collection.delete({ where: { id: params.id } });
    await audit(prisma, { userId: user.id, action: "collection.deleted", entityType: "Collection", entityId: params.id, ip });
    return { deleted: true };
  },
});
