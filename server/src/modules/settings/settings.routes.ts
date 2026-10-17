import { z } from "zod";
import { createModule, idParam, moneySchema } from "../../http/route.js";
import { prisma, Prisma } from "../../lib/prisma.js";
import { assertFound, badRequest, forbidden, notFound, validationError } from "../../lib/errors.js";
import { audit } from "../../lib/audit.js";
import { getSetting, setSetting, SETTING_DEFAULTS, type SettingKey } from "../../lib/settings.js";
import { normalizeBdPhone } from "../../lib/phone.js";
import { TRANSITIONS } from "../orders/order-status.js";
import { safeUrl } from "../cms/sections.js";

export const settingsModule = createModule("/settings", "Settings");
export const searchModule = createModule("/search", "Search");
export const savedFiltersModule = createModule("/saved-filters", "Saved filters");

// ═════════════ settings ═════════════

const SECRET_KEY = /secret|token|password|credential|apikey|api_key|accesskey/i;

/** Defensive: drop any secret-looking keys before returning settings to the browser. */
function stripSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripSecrets);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([k]) => !SECRET_KEY.test(k)).map(([k, v]) => [k, stripSecrets(v)]));
  }
  return value;
}

const money2 = moneySchema.refine((v) => !v.startsWith("-"), { message: "Must not be negative" });
const percent = moneySchema.refine((v) => Number(v) >= 0 && Number(v) <= 100, { message: "Must be between 0 and 100" });
const statusKeys = Object.keys(TRANSITIONS) as [string, ...string[]];

/** Per-group validators. Strict: unknown keys (e.g. a CAPI access token under `meta`) are rejected. */
const GROUP_SCHEMAS = {
  store: z.strictObject({
    name: z.string().trim().min(1).max(100),
    tagline: z.string().trim().max(200),
    phone: z.string().trim().max(30),
    email: z.string().trim().email().or(z.literal("")),
    address: z.string().trim().max(500),
    logoUrl: safeUrl.or(z.literal("")),
    currency: z.literal("BDT"),
    timezone: z.literal("Asia/Dhaka"),
  }).partial(),
  inventory: z.strictObject({
    reserveOn: z.enum(["ORDER_CREATED", "CONFIRMED"]),
    deductOn: z.enum(["COURIER_BOOKED", "SHIPPED"]),
    allowBackorder: z.boolean(),
  }).partial(),
  orders: z.strictObject({
    confirmationRiskThreshold: z.number().int().min(0).max(100),
    duplicateWindowHours: z.number().int().min(1).max(24 * 30),
    defaultPackagingCost: money2,
  }).partial(),
  finance: z.strictObject({
    codChargePercent: percent,
    estimatedCourierFee: z.partialRecord(z.enum(["INSIDE_DHAKA", "SUB_DHAKA", "OUTSIDE_DHAKA"]), money2),
    estimatedReturnFeeRatio: z.string().regex(/^\d+(\.\d{1,4})?$/).refine((v) => Number(v) <= 2, { message: "Ratio must be between 0 and 2" }),
  }).partial(),
  meta: z.strictObject({
    pixelId: z.string().trim().regex(/^\d{0,20}$/, "Pixel ID is numeric"),
    capiEnabled: z.boolean(),
  }).partial(),
  statusLabels: z.partialRecord(
    z.enum(statusKeys),
    z.strictObject({ en: z.string().trim().max(60), bn: z.string().trim().max(60), color: z.string().trim().regex(/^[a-z]{3,20}$/) }).partial(),
  ),
  notifications: z.strictObject({
    newOrderInApp: z.boolean(),
    lowStockInApp: z.boolean(),
    courierFailureInApp: z.boolean(),
    customerSmsOnConfirm: z.boolean(),
    customerSmsOnShip: z.boolean(),
    dailySummaryEmail: z.string().trim().email().or(z.literal("")),
    customerSmsLanguage: z.enum(["en", "bn"]),
  }).partial(),
  cms: z.strictObject({
    announcementBar: z.strictObject({ enabled: z.boolean(), text: z.string().trim().max(300), textBn: z.string().trim().max(300), link: safeUrl.or(z.literal("")) }).partial(),
    footer: z.strictObject({ about: z.string().trim().max(2000), facebookUrl: safeUrl.or(z.literal("")), instagramUrl: safeUrl.or(z.literal("")), whatsapp: z.string().trim().max(30) }).partial(),
    homepage: z.strictObject({ featuredCollectionSlugs: z.array(z.string().trim().min(1).max(100)).max(20) }).partial(),
  }).partial(),
} satisfies Record<SettingKey, z.ZodType>;

const GROUPS = Object.keys(SETTING_DEFAULTS) as SettingKey[];

settingsModule.route({
  method: "get",
  path: "/",
  summary: "All setting groups (stored values merged over defaults; secrets excluded)",
  access: "settings.view",
  handler: async () => Object.fromEntries(await Promise.all(GROUPS.map(async (g) => [g, stripSecrets(await getSetting(g))] as const))),
});

settingsModule.route({
  method: "get",
  path: "/:group",
  summary: "One setting group",
  access: "settings.view",
  params: z.object({ group: z.enum(GROUPS as [SettingKey, ...SettingKey[]]) }),
  handler: async ({ params }) => stripSecrets(await getSetting(params.group)),
});

settingsModule.route({
  method: "put",
  path: "/:group",
  summary: "Update a setting group (partial; validated per group)",
  description: "Groups: store, inventory, orders, finance, meta (pixelId + capiEnabled only – access tokens live in environment config), statusLabels, notifications, cms.",
  access: "settings.manage",
  params: z.object({ group: z.enum(GROUPS as [SettingKey, ...SettingKey[]]) }),
  body: z.record(z.string(), z.unknown()),
  handler: async ({ params, body, user, ip }) => {
    const parsed = GROUP_SCHEMAS[params.group].safeParse(body);
    if (!parsed.success) {
      throw validationError(parsed.error.issues.map((i) => ({ in: "body", path: i.path.join("."), message: i.message })));
    }
    const { before, after } = await setSetting(params.group, parsed.data as never, user.id);
    await audit(prisma, { userId: user.id, action: "settings.updated", entityType: "Setting", entityId: params.group, before, after, ip });
    return stripSecrets(after);
  },
});

// ═════════════ global search ═════════════

const LIMIT = 8;
const BN = "০১২৩৪৫৬৭৮৯";

/** Digits of a phone-like query in local form ("+880 1712-…" → "01712…"), or null if not phone-like. */
function phoneDigits(q: string): string | null {
  const ascii = q.replace(/[০-৯]/g, (d) => String(BN.indexOf(d)));
  if (!/^[\d\s+()-]+$/.test(ascii)) return null;
  let d = ascii.replace(/\D/g, "");
  if (d.startsWith("880")) d = d.slice(2);
  else if (d.startsWith("88") && d.length > 11) d = d.slice(2);
  return d.length >= 4 ? d : null;
}

searchModule.route({
  method: "get",
  path: "/",
  summary: "Global search across orders, customers, products and shipments",
  description: "Each group is searched only when the user holds its permission (orders.view, customers.view, products.view, shipments.view). At most 8 results per group.",
  access: "auth",
  query: z.object({ q: z.string().trim().min(2).max(100) }),
  handler: async ({ query, user }) => {
    const q = query.q;
    const can = (p: Parameters<typeof user.permissions.has>[0]) => user.permissions.has(p);
    const full = normalizeBdPhone(q);
    const digits = phoneDigits(q);
    const ci = { contains: q, mode: "insensitive" as const };

    const tasks: Record<string, Promise<unknown[]>> = {};

    if (can("orders.view")) {
      const or: Prisma.OrderWhereInput[] = [
        { orderNumber: { contains: q.toUpperCase().replace(/\s/g, "") } },
        { shippingName: ci },
        { shipments: { some: { OR: [{ trackingCode: q }, { consignmentId: q }] } } },
      ];
      if (full) or.push({ shippingPhone: full }, { customer: { phone: full } });
      else if (digits) or.push({ shippingPhone: { contains: digits } });
      tasks.orders = prisma.order
        .findMany({
          where: { OR: or },
          orderBy: { createdAt: "desc" },
          take: LIMIT,
          select: { id: true, orderNumber: true, status: true, shippingName: true, shippingPhone: true, total: true, createdAt: true },
        })
        .then((rows) => rows.map((o) => ({ ...o, total: o.total.toFixed(2) })));
    }

    if (can("customers.view")) {
      const or: Prisma.CustomerWhereInput[] = [{ name: ci }];
      if (full) or.push({ phone: full }, { altPhone: full });
      else if (digits) or.push({ phone: { contains: digits } });
      tasks.customers = prisma.customer.findMany({
        where: { deletedAt: null, OR: or },
        orderBy: { lastOrderAt: { sort: "desc", nulls: "last" } },
        take: LIMIT,
        select: { id: true, name: true, phone: true, totalOrders: true, lastOrderAt: true },
      });
    }

    if (can("products.view")) {
      tasks.products = prisma.product.findMany({
        where: {
          status: { not: "ARCHIVED" },
          OR: [
            { name: ci },
            { sku: ci },
            { barcode: q },
            { variants: { some: { OR: [{ sku: ci }, { barcode: q }] } } },
          ],
        },
        orderBy: { updatedAt: "desc" },
        take: LIMIT,
        select: { id: true, name: true, slug: true, sku: true, status: true, isPublished: true, images: { orderBy: { sortOrder: "asc" }, take: 1, select: { url: true } } },
      }).then((rows) => rows.map(({ images, ...p }) => ({ ...p, imageUrl: images[0]?.url ?? null })));
    }

    if (can("shipments.view")) {
      tasks.shipments = prisma.shipment.findMany({
        where: { OR: [{ trackingCode: ci }, { consignmentId: ci }] },
        orderBy: { createdAt: "desc" },
        take: LIMIT,
        select: { id: true, trackingCode: true, consignmentId: true, status: true, isReturn: true, orderId: true, order: { select: { orderNumber: true } }, provider: { select: { name: true } } },
      });
    }

    const keys = Object.keys(tasks);
    const results = await Promise.all(keys.map((k) => tasks[k]));
    return Object.fromEntries(keys.map((k, i) => [k, results[i]]));
  },
});

// ═════════════ saved filters ═════════════

const moduleName = z.string().trim().regex(/^[a-z][a-z0-9_-]{1,39}$/, "Invalid module name");

savedFiltersModule.route({
  method: "get",
  path: "/",
  summary: "Saved filters for a module (own + shared)",
  access: "auth",
  query: z.object({ module: moduleName }),
  handler: async ({ query, user }) => {
    const rows = await prisma.savedFilter.findMany({
      where: { module: query.module, OR: [{ userId: user.id }, { isShared: true }] },
      orderBy: [{ name: "asc" }],
      include: { user: { select: { id: true, name: true } } },
    });
    return rows.map(({ user: owner, ...f }) => ({ ...f, owner, isOwner: f.userId === user.id }));
  },
});

savedFiltersModule.route({
  method: "post",
  path: "/",
  summary: "Save a filter",
  access: "auth",
  status: 201,
  body: z.object({
    name: z.string().trim().min(1).max(80),
    module: moduleName,
    filters: z.record(z.string(), z.unknown()).refine((f) => JSON.stringify(f).length <= 10_000, { message: "Filters are too large" }),
    isShared: z.boolean().default(false),
  }),
  handler: async ({ body, user }) => {
    const count = await prisma.savedFilter.count({ where: { userId: user.id, module: body.module } });
    if (count >= 50) throw badRequest("You can keep at most 50 saved filters per module");
    const f = await prisma.savedFilter.create({ data: { ...body, filters: body.filters as Prisma.InputJsonValue, userId: user.id } });
    return { ...f, isOwner: true };
  },
});

savedFiltersModule.route({
  method: "delete",
  path: "/:id",
  summary: "Delete a saved filter (owner only)",
  access: "auth",
  params: idParam,
  handler: async ({ params, user }) => {
    const f = assertFound(await prisma.savedFilter.findUnique({ where: { id: params.id } }), "Saved filter");
    if (f.userId !== user.id) {
      if (!f.isShared) throw notFound("Saved filter"); // other users' private filters are invisible
      throw forbidden("Only the owner can delete this filter");
    }
    await prisma.savedFilter.delete({ where: { id: f.id } });
    return { id: f.id, deleted: true };
  },
});
