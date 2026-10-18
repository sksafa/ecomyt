import { z } from "zod";
import { createModule, idParam, pageMeta, pageQuery, withMeta } from "../../http/route.js";
import { prisma, Prisma } from "../../lib/prisma.js";
import { assertFound, badRequest, conflict } from "../../lib/errors.js";
import { audit, diff } from "../../lib/audit.js";
import { getSetting, setSetting } from "../../lib/settings.js";
import { slugify } from "../products/products.routes.js";
import { partialNoDefaults, safeUrl, sanitizeSections, sectionsSchema } from "./sections.js";

export const cmsModule = createModule("/cms", "Content (CMS)");
const { route } = cmsModule;

const ACCESS = "cms.manage" as const;
const optText = (max: number) => z.string().trim().max(max).nullish();
const isoDate = z.string().datetime({ offset: true });

/** Generic audited CRUD for the simple content tables. */
function crud<Row extends { id: string }>(opts: {
  path: string;
  entity: string;
  label: string;
  schema: z.ZodObject<z.ZodRawShape>;
  listQuery?: z.ZodObject<z.ZodRawShape>;
  delegate: {
    findMany: (args: object) => Promise<Row[]>;
    count: (args: object) => Promise<number>;
    findUnique: (args: { where: { id: string } }) => Promise<Row | null>;
    create: (args: { data: never }) => Promise<Row>;
    update: (args: { where: { id: string }; data: never }) => Promise<Row>;
    delete: (args: { where: { id: string } }) => Promise<Row>;
  };
  where?: (q: Record<string, unknown>) => object;
  orderBy: object;
  toData?: (body: Record<string, unknown>) => Record<string, unknown>;
  validate?: (data: Record<string, unknown>, before?: Row) => void;
}) {
  const key = opts.entity.charAt(0).toLowerCase() + opts.entity.slice(1);
  const toData = opts.toData ?? ((b) => b);

  route({
    method: "get",
    path: opts.path,
    summary: `List ${opts.label}`,
    access: ACCESS,
    query: (opts.listQuery ?? z.object({})).extend(pageQuery.shape),
    handler: async ({ query }) => {
      const q = query as Record<string, unknown> & { page: number; pageSize: number };
      const where = opts.where?.(q) ?? {};
      const [rows, total] = await Promise.all([
        opts.delegate.findMany({ where, orderBy: opts.orderBy, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
        opts.delegate.count({ where }),
      ]);
      return withMeta(rows, pageMeta(q.page, q.pageSize, total));
    },
  });

  route({
    method: "get",
    path: `${opts.path}/:id`,
    summary: `Get one of ${opts.label}`,
    access: ACCESS,
    params: idParam,
    handler: async ({ params }) => assertFound(await opts.delegate.findUnique({ where: { id: params.id } }), opts.entity),
  });

  route({
    method: "post",
    path: opts.path,
    summary: `Create ${opts.label}`,
    access: ACCESS,
    status: 201,
    body: opts.schema,
    handler: async ({ body, user, ip }) => {
      const data = toData(body as Record<string, unknown>);
      opts.validate?.(data);
      const row = await opts.delegate.create({ data: data as never });
      await audit(prisma, { userId: user.id, action: `${key}.created`, entityType: opts.entity, entityId: row.id, after: row, ip });
      return row;
    },
  });

  route({
    method: "put",
    path: `${opts.path}/:id`,
    summary: `Update ${opts.label}`,
    access: ACCESS,
    params: idParam,
    body: partialNoDefaults(opts.schema),
    handler: async ({ params, body, user, ip }) => {
      const before = assertFound(await opts.delegate.findUnique({ where: { id: params.id } }), opts.entity);
      const data = toData(body as Record<string, unknown>);
      opts.validate?.({ ...before, ...data }, before);
      const row = await opts.delegate.update({ where: { id: params.id }, data: data as never });
      const d = diff(before as unknown as Record<string, unknown>, data);
      if (d.changed) await audit(prisma, { userId: user.id, action: `${key}.updated`, entityType: opts.entity, entityId: row.id, before: d.before, after: d.after, ip });
      return row;
    },
  });

  route({
    method: "delete",
    path: `${opts.path}/:id`,
    summary: `Delete ${opts.label}`,
    access: ACCESS,
    params: idParam,
    handler: async ({ params, user, ip }) => {
      const before = assertFound(await opts.delegate.findUnique({ where: { id: params.id } }), opts.entity);
      await opts.delegate.delete({ where: { id: params.id } });
      await audit(prisma, { userId: user.id, action: `${key}.deleted`, entityType: opts.entity, entityId: params.id, before, ip });
      return { id: params.id, deleted: true };
    },
  });
}

const toDate = (v: unknown) => (v === undefined ? undefined : v ? new Date(v as string) : null);

// ───────────── banners ─────────────

crud({
  path: "/banners",
  entity: "Banner",
  label: "banners",
  schema: z.object({
    title: z.string().trim().min(1).max(200),
    subtitle: optText(500),
    imageUrl: safeUrl.pipe(z.string().min(1)),
    mobileImageUrl: safeUrl.nullish(),
    linkUrl: safeUrl.nullish(),
    ctaLabel: optText(60),
    placement: z.string().trim().regex(/^[A-Z0-9_]{2,40}$/, "Use UPPER_SNAKE_CASE, e.g. HOME_HERO").default("HOME_HERO"),
    sortOrder: z.number().int().min(-10_000).max(10_000).default(0),
    isActive: z.boolean().default(true),
    startsAt: isoDate.nullish(),
    endsAt: isoDate.nullish(),
  }),
  listQuery: z.object({ placement: z.string().optional() }),
  where: (q) => (q.placement ? { placement: q.placement } : {}),
  orderBy: [{ placement: "asc" }, { sortOrder: "asc" }, { createdAt: "desc" }],
  toData: (b) => ({ ...b, ...(b.startsAt !== undefined ? { startsAt: toDate(b.startsAt) } : {}), ...(b.endsAt !== undefined ? { endsAt: toDate(b.endsAt) } : {}) }),
  validate: (d) => {
    if (d.startsAt && d.endsAt && (d.endsAt as Date) <= (d.startsAt as Date)) throw badRequest("endsAt must be after startsAt");
  },
  delegate: prisma.banner as never,
});

// ───────────── testimonials ─────────────

crud({
  path: "/testimonials",
  entity: "Testimonial",
  label: "testimonials",
  schema: z.object({
    name: z.string().trim().min(1).max(100),
    location: optText(100),
    quote: z.string().trim().min(1).max(2000),
    rating: z.number().int().min(1).max(5).default(5),
    imageUrl: safeUrl.nullish(),
    isActive: z.boolean().default(true),
    sortOrder: z.number().int().min(-10_000).max(10_000).default(0),
  }),
  orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
  delegate: prisma.testimonial as never,
});

// ───────────── FAQs ─────────────

crud({
  path: "/faqs",
  entity: "Faq",
  label: "FAQs",
  schema: z.object({
    question: z.string().trim().min(1).max(500),
    answer: z.string().trim().min(1).max(10_000),
    category: optText(80),
    sortOrder: z.number().int().min(-10_000).max(10_000).default(0),
    isActive: z.boolean().default(true),
  }),
  listQuery: z.object({ category: z.string().optional() }),
  where: (q) => (q.category ? { category: q.category } : {}),
  orderBy: [{ category: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
  delegate: prisma.faq as never,
});

// ───────────── pages / landing pages ─────────────

const pageSchema = z.object({
  title: z.string().trim().min(1).max(200),
  slug: z.string().trim().max(100).optional(),
  type: z.enum(["PAGE", "LANDING", "POLICY"]).default("PAGE"),
  status: z.enum(["DRAFT", "PUBLISHED"]).default("DRAFT"),
  sections: sectionsSchema.default([]),
  seoTitle: optText(200),
  seoDescription: optText(500),
  ogImageUrl: safeUrl.nullish(),
});

const shapePage = <T extends { sections: unknown }>(p: T) => ({ ...p, sections: sanitizeSections(p.sections) });

async function assertSlugFree(slug: string, excludeId?: string) {
  const existing = await prisma.page.findUnique({ where: { slug } });
  if (existing && existing.id !== excludeId) throw conflict(`A page with slug "${slug}" already exists`);
}

route({
  method: "get",
  path: "/pages",
  summary: "List pages and landing pages",
  access: ACCESS,
  query: pageQuery.extend({
    type: z.enum(["PAGE", "LANDING", "POLICY"]).optional(),
    status: z.enum(["DRAFT", "PUBLISHED"]).optional(),
    search: z.string().trim().max(100).optional(),
  }),
  handler: async ({ query }) => {
    const where: Prisma.PageWhereInput = {
      ...(query.type ? { type: query.type } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.search ? { OR: [{ title: { contains: query.search, mode: "insensitive" } }, { slug: { contains: query.search.toLowerCase() } }] } : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.page.findMany({
        where, orderBy: { updatedAt: "desc" }, skip: (query.page - 1) * query.pageSize, take: query.pageSize,
        select: { id: true, slug: true, title: true, type: true, status: true, publishedAt: true, createdAt: true, updatedAt: true },
      }),
      prisma.page.count({ where }),
    ]);
    return withMeta(rows, pageMeta(query.page, query.pageSize, total));
  },
});

route({
  method: "get",
  path: "/pages/:id",
  summary: "Page with sections (rich text sanitised)",
  access: ACCESS,
  params: idParam,
  handler: async ({ params }) => shapePage(assertFound(await prisma.page.findUnique({ where: { id: params.id } }), "Page")),
});

route({
  method: "post",
  path: "/pages",
  summary: "Create a page / landing page",
  description: "`sections` is an ordered array of typed blocks: hero, rich_text, product_grid, image_banner, testimonials, faq, countdown, order_form, features, video.",
  access: ACCESS,
  status: 201,
  body: pageSchema,
  handler: async ({ body, user, ip }) => {
    const slug = slugify(body.slug || body.title);
    await assertSlugFree(slug);
    const page = await prisma.page.create({
      data: {
        ...body,
        slug,
        sections: body.sections as Prisma.InputJsonValue,
        publishedAt: body.status === "PUBLISHED" ? new Date() : null,
      },
    });
    await audit(prisma, { userId: user.id, action: "page.created", entityType: "Page", entityId: page.id, after: { slug, title: page.title, type: page.type, status: page.status, sections: body.sections.length }, ip });
    return shapePage(page);
  },
});

route({
  method: "put",
  path: "/pages/:id",
  summary: "Update a page (sections are replaced when given)",
  access: ACCESS,
  params: idParam,
  body: partialNoDefaults(pageSchema),
  handler: async ({ params, body, user, ip }) => {
    const before = assertFound(await prisma.page.findUnique({ where: { id: params.id } }), "Page");
    const slug = body.slug !== undefined ? slugify(body.slug || body.title || before.title) : undefined;
    if (slug && slug !== before.slug) await assertSlugFree(slug, before.id);
    const publishing = body.status === "PUBLISHED" && before.status !== "PUBLISHED";
    const data = {
      ...body,
      ...(slug ? { slug } : {}),
      ...(body.sections ? { sections: body.sections as Prisma.InputJsonValue } : {}),
      ...(publishing ? { publishedAt: new Date() } : {}),
    };
    const page = await prisma.page.update({ where: { id: params.id }, data });
    const d = diff(
      { title: before.title, slug: before.slug, type: before.type, status: before.status, seoTitle: before.seoTitle, seoDescription: before.seoDescription, ogImageUrl: before.ogImageUrl, sections: before.sections } as Record<string, unknown>,
      { ...body, ...(slug ? { slug } : {}) } as Record<string, unknown>,
    );
    if (d.changed) await audit(prisma, { userId: user.id, action: "page.updated", entityType: "Page", entityId: page.id, before: d.before, after: d.after, ip });
    return shapePage(page);
  },
});

route({
  method: "delete",
  path: "/pages/:id",
  summary: "Delete a page",
  access: ACCESS,
  params: idParam,
  handler: async ({ params, user, ip }) => {
    const before = assertFound(await prisma.page.findUnique({ where: { id: params.id } }), "Page");
    await prisma.page.delete({ where: { id: params.id } });
    await audit(prisma, { userId: user.id, action: "page.deleted", entityType: "Page", entityId: params.id, before: { slug: before.slug, title: before.title, status: before.status }, ip });
    return { id: params.id, deleted: true };
  },
});

// ───────────── content settings ─────────────

const cmsSettingsSchema = z.object({
  announcementBar: z
    .object({ enabled: z.boolean(), text: z.string().trim().max(300), textBn: z.string().trim().max(300), link: safeUrl.or(z.literal("")) })
    .partial()
    .optional(),
  footer: z
    .object({ about: z.string().trim().max(2000), facebookUrl: safeUrl.or(z.literal("")), instagramUrl: safeUrl.or(z.literal("")), whatsapp: z.string().trim().max(30) })
    .partial()
    .optional(),
  homepage: z
    .object({
      featuredCollectionSlugs: z.array(z.string().trim().min(1).max(100)).max(20),
      /** product sold on the homepage landing page ("" = automatic) */
      landingProductSlug: z.string().trim().max(200).regex(/^[a-z0-9-]*$/, "Choose a product from the list"),
    })
    .partial()
    .optional(),
  contact: z.object({ phone: z.string().trim().max(30), email: z.string().trim().email().or(z.literal("")), address: z.string().trim().max(500) }).partial().optional(),
});

async function contentSettings() {
  const [cms, store] = await Promise.all([getSetting("cms"), getSetting("store")]);
  return { ...cms, contact: { phone: store.phone, email: store.email, address: store.address } };
}

route({
  method: "get",
  path: "/settings",
  summary: "Storefront content settings (announcement bar, footer, homepage, contact info)",
  access: ACCESS,
  handler: () => contentSettings(),
});

route({
  method: "put",
  path: "/settings",
  summary: "Update storefront content settings",
  access: ACCESS,
  body: cmsSettingsSchema,
  handler: async ({ body, user, ip }) => {
    const { contact, ...cms } = body;
    if (Object.keys(cms).length) {
      const r = await setSetting("cms", cms as never, user.id);
      await audit(prisma, { userId: user.id, action: "settings.updated", entityType: "Setting", entityId: "cms", before: r.before, after: r.after, ip });
    }
    if (contact && Object.keys(contact).length) {
      const r = await setSetting("store", contact, user.id);
      await audit(prisma, { userId: user.id, action: "settings.updated", entityType: "Setting", entityId: "store", before: r.before, after: r.after, ip });
    }
    return contentSettings();
  },
});
