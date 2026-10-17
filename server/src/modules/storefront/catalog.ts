import { prisma, Prisma, type Db } from "../../lib/prisma.js";
import { money } from "../../lib/money.js";
import { getSetting } from "../../lib/settings.js";

/** Only these products are ever visible on the storefront. */
export const publicProductWhere: Prisma.ProductWhereInput = { status: "ACTIVE", isPublished: true, archivedAt: null };

export const publicProductInclude = {
  category: { select: { name: true, slug: true } },
  images: { orderBy: { sortOrder: "asc" }, select: { url: true, alt: true } },
  variants: {
    where: { isActive: true },
    orderBy: { createdAt: "asc" },
    // explicit selects: cost / raw inventory never leave this module
    select: {
      id: true, sku: true, name: true, color: true, size: true, price: true, imageUrl: true, lowStockThreshold: true,
      inventory: { select: { available: true } },
    },
  },
} satisfies Prisma.ProductInclude;

export type PublicProductRow = Prisma.ProductGetPayload<{ include: typeof publicProductInclude }>;

/**
 * Explicit allow-list of public fields. Never includes costPrice, cost components, stock counts,
 * or internal flags – only `inStock` / `lowStock` hints.
 */
export function shapePublicProduct(p: PublicProductRow, opts: { detail?: boolean; allowBackorder?: boolean } = {}) {
  const base = money(p.salePrice ?? p.regularPrice);
  const onSale = p.salePrice !== null && money(p.salePrice).lessThan(p.regularPrice);
  const variants = p.variants.map((v) => {
    const available = v.inventory?.available ?? 0;
    return {
      id: v.id,
      sku: v.sku,
      name: v.name,
      color: v.color,
      size: v.size,
      price: money(v.price ?? base).toFixed(2),
      imageUrl: v.imageUrl,
      inStock: available > 0 || !!opts.allowBackorder,
      lowStock: available > 0 && available <= v.lowStockThreshold,
    };
  });
  const prices = variants.map((v) => money(v.price));
  const minPrice = prices.length ? prices.reduce((a, b) => (b.lessThan(a) ? b : a)) : base;
  const maxPrice = prices.length ? prices.reduce((a, b) => (b.greaterThan(a) ? b : a)) : base;
  const summary = {
    id: p.id,
    name: p.name,
    slug: p.slug,
    shortDescription: p.shortDescription,
    category: p.category ? { name: p.category.name, slug: p.category.slug } : null,
    price: base.toFixed(2),
    compareAtPrice: onSale ? money(p.regularPrice).toFixed(2) : null,
    onSale,
    priceRange: { min: minPrice.toFixed(2), max: maxPrice.toFixed(2) },
    imageUrl: p.images[0]?.url ?? null,
    images: p.images.map((i) => ({ url: i.url, alt: i.alt })),
    isFeatured: p.isFeatured,
    freeShipping: p.freeShipping,
    inStock: variants.some((v) => v.inStock),
    lowStock: variants.some((v) => v.lowStock),
    variants,
  };
  if (!opts.detail) return summary;
  return {
    ...summary,
    description: p.description,
    fabric: p.fabric,
    design: p.design,
    embroidery: p.embroidery,
    careInstructions: p.careInstructions,
    shippingNote: p.shippingNote,
    weightGrams: p.weightGrams,
    seo: { title: p.seoTitle ?? p.name, description: p.seoDescription ?? p.shortDescription, ogImageUrl: p.ogImageUrl ?? p.images[0]?.url ?? null },
  };
}

export type PublicProduct = ReturnType<typeof shapePublicProduct>;

export async function publicProducts(where: Prisma.ProductWhereInput, opts: { take?: number; skip?: number; orderBy?: Prisma.ProductOrderByWithRelationInput | Prisma.ProductOrderByWithRelationInput[] } = {}, db: Db = prisma) {
  const [rows, inv] = await Promise.all([
    db.product.findMany({ where: { AND: [publicProductWhere, where] }, include: publicProductInclude, take: opts.take, skip: opts.skip, orderBy: opts.orderBy ?? { createdAt: "desc" } }),
    getSetting("inventory", db),
  ]);
  return rows.map((p) => shapePublicProduct(p, { allowBackorder: inv.allowBackorder }));
}

/** Public products by id, in the given order. */
export async function publicProductsByIds(ids: string[], db: Db = prisma) {
  if (!ids.length) return [];
  const rows = await publicProducts({ id: { in: ids } }, {}, db);
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids.map((id) => byId.get(id)).filter((p): p is PublicProduct => !!p);
}

export async function publicProductsInCollection(slug: string, take: number, db: Db = prisma) {
  const collection = await db.collection.findFirst({ where: { slug, isActive: true } });
  if (!collection) return null;
  const links = await db.productCollection.findMany({
    where: { collectionId: collection.id, product: publicProductWhere },
    orderBy: [{ sortOrder: "asc" }],
    select: { productId: true },
    take,
  });
  return {
    collection: { id: collection.id, name: collection.name, slug: collection.slug, description: collection.description, imageUrl: collection.imageUrl },
    products: await publicProductsByIds(links.map((l) => l.productId), db),
  };
}
