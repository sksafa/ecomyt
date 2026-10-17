import { z } from "zod";
import { createModule, pageMeta, withMeta } from "../../http/route.js";
import { prisma, Prisma } from "../../lib/prisma.js";
import { badRequest, conflict, notFound } from "../../lib/errors.js";
import { max0, money } from "../../lib/money.js";
import { normalizeBdPhone } from "../../lib/phone.js";
import { getSetting } from "../../lib/settings.js";
import { storefrontLimiter } from "../../middleware/rateLimit.js";
import { createOrder, type Actor } from "../orders/orders.service.js";
import { STATUS_LABELS } from "../orders/order-status.js";
import { sanitizeSections, type Section } from "../cms/sections.js";
import {
  publicProductInclude,
  publicProducts,
  publicProductsByIds,
  publicProductsInCollection,
  publicProductWhere,
  shapePublicProduct,
} from "./catalog.js";

export const storefrontModule = createModule("/storefront", "Storefront (public)");
const { route } = storefrontModule;

const slugParam = z.object({ slug: z.string().trim().min(1).max(120) });

const activeBannerWhere = (now: Date): Prisma.BannerWhereInput => ({
  isActive: true,
  AND: [{ OR: [{ startsAt: null }, { startsAt: { lte: now } }] }, { OR: [{ endsAt: null }, { endsAt: { gt: now } }] }],
});

const publicTestimonials = (take: number) =>
  prisma.testimonial.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
    take,
    select: { id: true, name: true, location: true, quote: true, rating: true, imageUrl: true },
  });

const publicFaqs = (category?: string | null) =>
  prisma.faq.findMany({
    where: { isActive: true, ...(category ? { category } : {}) },
    orderBy: [{ category: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
    select: { id: true, question: true, answer: true, category: true },
  });

async function storeInfo() {
  const [store, cms, meta] = await Promise.all([getSetting("store"), getSetting("cms"), getSetting("meta")]);
  return {
    store: { name: store.name, tagline: store.tagline, phone: store.phone, email: store.email, address: store.address, logoUrl: store.logoUrl, currency: store.currency },
    announcementBar: cms.announcementBar.enabled ? cms.announcementBar : null,
    footer: cms.footer,
    // Pixel id is public by nature (it is embedded in the page); CAPI token is never exposed.
    meta: { pixelId: meta.pixelId || null },
    cms,
  };
}

// ───────────── home ─────────────

route({
  method: "get",
  path: "/home",
  summary: "Homepage content: active banners, featured collections/products, testimonials, announcement bar, store info",
  access: "public",
  handler: async () => {
    const now = new Date();
    const info = await storeInfo();
    const slugs = info.cms.homepage.featuredCollectionSlugs;
    const collectionSlugs = slugs.length
      ? slugs
      : (await prisma.collection.findMany({ where: { isActive: true, isFeatured: true }, orderBy: { sortOrder: "asc" }, take: 6, select: { slug: true } })).map((c) => c.slug);

    const [banners, featuredCollections, featuredProducts, testimonials] = await Promise.all([
      prisma.banner.findMany({
        where: activeBannerWhere(now),
        orderBy: [{ placement: "asc" }, { sortOrder: "asc" }],
        select: { id: true, title: true, subtitle: true, imageUrl: true, mobileImageUrl: true, linkUrl: true, ctaLabel: true, placement: true, sortOrder: true },
      }),
      Promise.all(collectionSlugs.map((slug) => publicProductsInCollection(slug, 8))),
      publicProducts({ isFeatured: true }, { take: 8, orderBy: { updatedAt: "desc" } }),
      publicTestimonials(12),
    ]);
    return {
      banners,
      featuredCollections: featuredCollections.filter((c) => c !== null),
      featuredProducts,
      testimonials,
      announcementBar: info.announcementBar,
      store: info.store,
      footer: info.footer,
      meta: info.meta,
    };
  },
});

// ───────────── catalogue ─────────────

const SORTS = ["newest", "price_asc", "price_desc", "name", "featured"] as const;

async function categoryIds(slug: string) {
  const cat = await prisma.category.findFirst({ where: { slug, isActive: true }, include: { children: { where: { isActive: true }, select: { id: true } } } });
  return cat ? [cat.id, ...cat.children.map((c) => c.id)] : null;
}

route({
  method: "get",
  path: "/products",
  summary: "Published products (public fields only)",
  access: "public",
  query: z.object({
    page: z.coerce.number().int().min(1).max(1000).default(1),
    pageSize: z.coerce.number().int().min(1).max(48).default(24),
    collection: z.string().trim().max(120).optional(),
    category: z.string().trim().max(120).optional(),
    search: z.string().trim().max(100).optional(),
    sort: z.enum(SORTS).default("newest"),
  }),
  handler: async ({ query }) => {
    const and: Prisma.ProductWhereInput[] = [publicProductWhere];
    if (query.collection) and.push({ collections: { some: { collection: { slug: query.collection, isActive: true } } } });
    if (query.category) {
      const ids = await categoryIds(query.category);
      and.push({ categoryId: { in: ids ?? [] } });
    }
    if (query.search) {
      and.push({ OR: [{ name: { contains: query.search, mode: "insensitive" } }, { shortDescription: { contains: query.search, mode: "insensitive" } }, { fabric: { contains: query.search, mode: "insensitive" } }] });
    }
    const where: Prisma.ProductWhereInput = { AND: and };
    const skip = (query.page - 1) * query.pageSize;
    const total = await prisma.product.count({ where });

    let data;
    if (query.sort === "price_asc" || query.sort === "price_desc") {
      // effective price = COALESCE(salePrice, regularPrice) – sorted with Decimal, then paged
      const all = await prisma.product.findMany({ where, select: { id: true, salePrice: true, regularPrice: true, createdAt: true }, take: 5000 });
      const dir = query.sort === "price_asc" ? 1 : -1;
      all.sort((a, b) => dir * money(a.salePrice ?? a.regularPrice).comparedTo(money(b.salePrice ?? b.regularPrice)) || b.createdAt.getTime() - a.createdAt.getTime());
      data = await publicProductsByIds(all.slice(skip, skip + query.pageSize).map((p) => p.id));
    } else {
      const orderBy: Prisma.ProductOrderByWithRelationInput[] =
        query.sort === "name" ? [{ name: "asc" }] : query.sort === "featured" ? [{ isFeatured: "desc" }, { createdAt: "desc" }] : [{ createdAt: "desc" }];
      data = await publicProducts(where, { skip, take: query.pageSize, orderBy });
    }
    return withMeta(data, pageMeta(query.page, query.pageSize, total));
  },
});

route({
  method: "get",
  path: "/products/:slug",
  summary: "Product detail with related and upsell products",
  access: "public",
  params: slugParam,
  handler: async ({ params }) => {
    const [p, inv] = await Promise.all([
      prisma.product.findFirst({ where: { AND: [publicProductWhere, { slug: params.slug }] }, include: { ...publicProductInclude, related: { select: { relatedId: true, type: true } } } }),
      getSetting("inventory"),
    ]);
    if (!p) throw notFound("Product");
    const relatedIds = p.related.filter((r) => r.type === "RELATED").map((r) => r.relatedId);
    const upsellIds = p.related.filter((r) => r.type === "UPSELL").map((r) => r.relatedId);
    let related = await publicProductsByIds(relatedIds);
    if (!related.length && p.categoryId) {
      related = await publicProducts({ categoryId: p.categoryId, id: { not: p.id } }, { take: 4 });
    }
    return {
      product: shapePublicProduct(p, { detail: true, allowBackorder: inv.allowBackorder }),
      related,
      upsell: await publicProductsByIds(upsellIds),
    };
  },
});

route({
  method: "get",
  path: "/collections",
  summary: "Active collections",
  access: "public",
  handler: async () => {
    const rows = await prisma.collection.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true, slug: true, description: true, imageUrl: true, isFeatured: true, _count: { select: { products: { where: { product: publicProductWhere } } } } },
    });
    return rows.map(({ _count, ...c }) => ({ ...c, productCount: _count.products }));
  },
});

route({
  method: "get",
  path: "/collections/:slug",
  summary: "Collection with its published products",
  access: "public",
  params: slugParam,
  query: z.object({ page: z.coerce.number().int().min(1).max(1000).default(1), pageSize: z.coerce.number().int().min(1).max(48).default(24) }),
  handler: async ({ params, query }) => {
    const c = await prisma.collection.findFirst({ where: { slug: params.slug, isActive: true } });
    if (!c) throw notFound("Collection");
    const where = { collectionId: c.id, product: publicProductWhere };
    const [links, total] = await Promise.all([
      prisma.productCollection.findMany({ where, orderBy: [{ sortOrder: "asc" }], skip: (query.page - 1) * query.pageSize, take: query.pageSize, select: { productId: true } }),
      prisma.productCollection.count({ where }),
    ]);
    return withMeta(
      { collection: { id: c.id, name: c.name, slug: c.slug, description: c.description, imageUrl: c.imageUrl }, products: await publicProductsByIds(links.map((l) => l.productId)) },
      pageMeta(query.page, query.pageSize, total),
    );
  },
});

route({
  method: "get",
  path: "/categories",
  summary: "Active categories (tree)",
  access: "public",
  handler: async () => {
    const rows = await prisma.category.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true, slug: true, description: true, imageUrl: true, parentId: true },
    });
    const byParent = new Map<string | null, typeof rows>();
    for (const r of rows) byParent.set(r.parentId, [...(byParent.get(r.parentId) ?? []), r]);
    const ids = new Set(rows.map((r) => r.id));
    type Node = (typeof rows)[number] & { children: Node[] };
    const build = (parentId: string | null): Node[] => (byParent.get(parentId) ?? []).map((r) => ({ ...r, children: build(r.id) }));
    // roots = no parent, or parent inactive
    return rows.filter((r) => !r.parentId || !ids.has(r.parentId)).map((r) => ({ ...r, children: build(r.id) }));
  },
});

// ───────────── content ─────────────

async function resolveSection(block: Section) {
  switch (block.type) {
    case "product_grid": {
      const limit = block.limit ?? 8;
      if (block.productIds?.length) return { ...block, products: (await publicProductsByIds(block.productIds)).slice(0, limit) };
      const res = block.collectionSlug ? await publicProductsInCollection(block.collectionSlug, limit) : null;
      return { ...block, collection: res?.collection ?? null, products: res?.products ?? [] };
    }
    case "order_form": {
      const [product] = await publicProductsByIds([block.productId]);
      if (!product) return { ...block, product: null };
      const full = await prisma.product.findUnique({ where: { id: product.id }, include: publicProductInclude });
      const inv = await getSetting("inventory");
      return { ...block, product: full ? shapePublicProduct(full, { detail: true, allowBackorder: inv.allowBackorder }) : product };
    }
    case "testimonials":
      return { ...block, testimonials: await publicTestimonials(block.limit ?? 6) };
    case "faq":
      return { ...block, faqs: await publicFaqs(block.category) };
    default:
      return block;
  }
}

route({
  method: "get",
  path: "/pages/:slug",
  summary: "Published page / landing page with resolved sections",
  description: "product_grid and order_form blocks are resolved to public product data; rich text is sanitised.",
  access: "public",
  params: slugParam,
  handler: async ({ params }) => {
    const page = await prisma.page.findFirst({ where: { slug: params.slug, status: "PUBLISHED" } });
    if (!page) throw notFound("Page");
    const sections = await Promise.all(sanitizeSections(page.sections).map(resolveSection));
    return {
      id: page.id,
      slug: page.slug,
      title: page.title,
      type: page.type,
      publishedAt: page.publishedAt,
      seo: { title: page.seoTitle ?? page.title, description: page.seoDescription, ogImageUrl: page.ogImageUrl },
      sections,
    };
  },
});

route({
  method: "get",
  path: "/faqs",
  summary: "Active FAQs",
  access: "public",
  query: z.object({ category: z.string().trim().max(80).optional() }),
  handler: ({ query }) => publicFaqs(query.category),
});

// ───────────── checkout ─────────────

const attrText = z.string().trim().max(500).optional();
const attributionSchema = z
  .object({
    firstSource: attrText, firstMedium: attrText, firstCampaign: attrText, firstContent: attrText, firstTerm: attrText, firstLandingPage: attrText,
    firstTouchAt: z.string().datetime({ offset: true }).optional(),
    lastSource: attrText, lastMedium: attrText, lastCampaign: attrText, lastContent: attrText, lastTerm: attrText, lastLandingPage: attrText,
    lastTouchAt: z.string().datetime({ offset: true }).optional(),
    referrer: attrText, fbclid: attrText, fbc: attrText, fbp: attrText, campaignId: attrText, adsetId: attrText, adId: attrText,
  })
  .optional();

const STORE_ACTOR: Actor = { userId: null, permissions: "system", source: "STOREFRONT" };

route({
  method: "post",
  path: "/checkout",
  summary: "Place an order from the website",
  description:
    "Requires an `Idempotency-Key` header (double-submits return the same order). Prices and delivery charge are always computed on the server. " +
    "`website` is a honeypot and must be empty. `metaEventId` is the Pixel Purchase eventID for deduplication with the server-side Conversions API event.",
  access: "public",
  status: 201,
  middleware: [storefrontLimiter],
  body: z.object({
    customer: z.object({ name: z.string().trim().min(2).max(100), phone: z.string().trim().min(10).max(20), email: z.string().trim().email().max(150).nullish() }),
    shipping: z.object({
      addressLine: z.string().trim().min(5).max(500),
      districtId: z.string().max(60).nullish(),
      areaId: z.string().max(60).nullish(),
      note: z.string().trim().max(500).nullish(),
    }),
    items: z.array(z.object({ variantId: z.string().min(1).max(60), quantity: z.number().int().min(1).max(10) })).min(1).max(20),
    paymentMethod: z.enum(["COD", "SSLCOMMERZ"]).default("COD"),
    attribution: attributionSchema,
    clientEventId: z.string().max(100).optional(),
    website: z.string().max(500).optional(),
  }),
  handler: async ({ body, req, ip }) => {
    if (body.website && body.website.trim() !== "") throw badRequest("Unable to place this order");
    const key = req.header("idempotency-key")?.trim();
    if (!key) throw badRequest("Idempotency-Key header is required");
    if (!/^[A-Za-z0-9_.:-]{8,100}$/.test(key)) throw badRequest("Idempotency-Key must be 8–100 characters of letters, digits, '-', '_', '.', ':'");

    const phone = normalizeBdPhone(body.customer.phone);
    if (!phone) throw badRequest(`"${body.customer.phone}" is not a valid Bangladeshi mobile number (01XXXXXXXXX)`);

    const { order, duplicate } = await createOrder(
      {
        customer: body.customer,
        shipping: { addressLine: body.shipping.addressLine, districtId: body.shipping.districtId ?? null, areaId: body.shipping.areaId ?? null, note: body.shipping.note ?? null },
        // only variant + quantity reach the order service: client prices/discounts/delivery are never accepted
        items: body.items.map((i) => ({ variantId: i.variantId, quantity: i.quantity })),
        paymentMethod: body.paymentMethod,
        channel: "WEBSITE",
        // IP + user agent are captured server-side for Meta CAPI event matching (never taken from the body)
        attribution: { ...(body.attribution ?? {}), clientIpAddress: ip || undefined, clientUserAgent: req.header("user-agent")?.slice(0, 500) },
        idempotencyKey: `store:${key}`,
        requirePublished: true,
      },
      { ...STORE_ACTOR, ip },
    );
    // a reused key from a different customer must not reveal someone else's order
    if (duplicate && order.shippingPhone !== phone) throw conflict("Idempotency-Key was already used for a different order");

    return {
      orderNumber: order.orderNumber,
      status: order.status,
      subtotal: money(order.subtotal).toFixed(2),
      deliveryCharge: money(order.deliveryCharge).toFixed(2),
      total: money(order.total).toFixed(2),
      paymentMethod: order.paymentMethod,
      paymentRequired: order.paymentMethod === "SSLCOMMERZ",
      metaEventId: `purchase:${order.id}`,
      duplicate,
    };
  },
});

// ───────────── order lookup ─────────────

route({
  method: "get",
  path: "/orders/:orderNumber",
  summary: "Order status lookup (requires the phone number used on the order)",
  description: "Returns 404 for unknown order numbers and phone mismatches alike, so order numbers cannot be enumerated.",
  access: "public",
  middleware: [storefrontLimiter],
  params: z.object({ orderNumber: z.string().trim().min(3).max(30) }),
  query: z.object({ phone: z.string().trim().min(1).max(30) }),
  handler: async ({ params, query }) => {
    const phone = normalizeBdPhone(query.phone);
    const order = phone
      ? await prisma.order.findUnique({
          where: { orderNumber: params.orderNumber.toUpperCase() },
          include: {
            customer: { select: { phone: true } },
            items: { select: { productName: true, variantName: true, color: true, size: true, imageUrl: true, quantity: true, unitPrice: true, discount: true, lineTotal: true } },
            shipments: { where: { isReturn: false }, orderBy: { createdAt: "desc" }, include: { provider: { select: { name: true } } } },
          },
        })
      : null;
    if (!order || !phone || (order.shippingPhone !== phone && order.customer.phone !== phone)) throw notFound("Order");

    const overrides = await getSetting("statusLabels");
    const label = { ...STATUS_LABELS[order.status], ...(overrides[order.status] ?? {}) };
    const shipment = order.shipments.find((s) => !["CANCELLED", "FAILED"].includes(s.status)) ?? null;
    return {
      orderNumber: order.orderNumber,
      status: order.status,
      statusLabel: { en: label.en, bn: label.bn },
      createdAt: order.createdAt,
      confirmedAt: order.confirmedAt,
      shippedAt: order.shippedAt,
      deliveredAt: order.deliveredAt,
      cancelledAt: order.cancelledAt,
      items: order.items.map((i) => ({
        productName: i.productName, variantName: i.variantName, color: i.color, size: i.size, imageUrl: i.imageUrl, quantity: i.quantity,
        unitPrice: money(i.unitPrice).toFixed(2), discount: money(i.discount).toFixed(2), lineTotal: money(i.lineTotal).toFixed(2),
      })),
      totals: {
        subtotal: money(order.subtotal).toFixed(2),
        discount: money(order.discountTotal).toFixed(2),
        deliveryCharge: money(order.deliveryCharge).toFixed(2),
        total: money(order.total).toFixed(2),
        paid: money(order.paidAmount).toFixed(2),
        due: max0(money(order.total).minus(order.paidAmount)).toFixed(2),
      },
      payment: { method: order.paymentMethod, status: order.paymentStatus },
      shipment: shipment ? { courier: shipment.provider.name, trackingCode: shipment.trackingCode, status: shipment.status } : null,
    };
  },
});
