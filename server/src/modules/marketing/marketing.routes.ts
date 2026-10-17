import multer from "multer";
import { z } from "zod";
import { createModule, dateRangeQuery, idParam, moneySchema, pageMeta, pageQuery, withMeta } from "../../http/route.js";
import { prisma, Prisma } from "../../lib/prisma.js";
import { audit } from "../../lib/audit.js";
import { assertFound, badRequest, unprocessable } from "../../lib/errors.js";
import { money } from "../../lib/money.js";
import { dateOnly } from "../../lib/time.js";
import type { AdPlatform } from "../../generated/prisma/enums.js";
import { AD_PLATFORMS, importAdSpendCsv, upsertAdSpend } from "./ad-spend.js";
import { attributionReport, campaignReport, reconciliationReport, resolveRange } from "./marketing.service.js";
import { getMetaConfig, META_GRAPH_VERSION, sendMetaEvent } from "./meta-capi.js";
import { randomToken } from "../../lib/crypto.js";

export const marketingModule = createModule("/marketing", "Marketing");
const { route } = marketingModule;

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024, files: 1 } });
const platformEnum = z.enum(AD_PLATFORMS as [AdPlatform, ...AdPlatform[]]);
const modelQuery = z.object({ model: z.enum(["first", "last"]).default("last") });
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

// ───────────── reports ─────────────

route({
  method: "get",
  path: "/attribution",
  summary: "Orders by source / medium / campaign with delivered-only revenue, CPA, ROAS and estimated net profit",
  description: "Verified figures come from our orders; platform-reported purchases/revenue are returned separately under `platform`. Orders without attribution are grouped as \"(direct / unknown)\".",
  access: "marketing.view",
  query: dateRangeQuery.extend(modelQuery.shape),
  handler: ({ query }) => attributionReport(query),
});

route({
  method: "get",
  path: "/campaigns",
  summary: "Campaign quality: delivery rate, return rate, average order value",
  access: "marketing.view",
  query: dateRangeQuery.extend(modelQuery.shape),
  handler: ({ query }) => campaignReport(query),
});

route({
  method: "get",
  path: "/reconciliation",
  summary: "Platform-reported vs verified orders per campaign; recorded ADVERTISING expenses vs imported spend",
  access: "marketing.view",
  query: dateRangeQuery,
  handler: ({ query }) => reconciliationReport(query),
});

// ───────────── ad spend ─────────────

route({
  method: "post",
  path: "/ad-spend/import",
  summary: "Import ad spend CSV (multipart field `file`, max 2 MB)",
  description: [
    "Columns (case-insensitive): date, platform, campaign_id, campaign_name, adset_id, ad_id, spend, impressions, clicks, reported_purchases, reported_revenue.",
    "Meta Ads Manager export headers are accepted too (Day / Reporting starts, Campaign name, Campaign ID, Ad set ID, Ad ID, Amount spent (BDT), Impressions, Link clicks, Purchases, Purchases conversion value).",
    "Optional form field `platform` (default META) applies when the file has no platform column.",
    "Rows are upserted by (platform, date, campaign id, ad set id, ad id) – re-importing never duplicates. Invalid rows are reported and skipped.",
    "Analytics only: imported spend never creates ledger entries; record ad bills as ADVERTISING expenses for the P&L.",
  ].join("\n\n"),
  access: "marketing.manage",
  middleware: [upload.single("file")],
  handler: async ({ req, user, ip }) => {
    if (!req.file) throw badRequest("No file uploaded (field name: file)");
    const name = req.file.originalname.toLowerCase();
    if (!name.endsWith(".csv") && !/csv|text\/plain|excel/.test(req.file.mimetype)) throw badRequest("Upload a .csv file");
    const p = String((req.body as Record<string, unknown> | undefined)?.platform ?? "META").toUpperCase();
    const platform = platformEnum.safeParse(p);
    if (!platform.success) throw badRequest("platform must be one of META, GOOGLE, TIKTOK, OTHER");
    const text = req.file.buffer.toString("utf8");
    if (text.includes("\u0000")) throw badRequest("The file is not a text CSV");

    const result = await importAdSpendCsv(text, platform.data);
    if ("headerErrors" in result) throw unprocessable("INVALID_CSV", "The CSV header is not usable", result.headerErrors);
    await audit(prisma, {
      userId: user.id, action: "marketing.ad_spend_imported", entityType: "AdSpendRecord", entityId: result.importBatch, ip,
      after: { file: req.file.originalname, importBatch: result.importBatch, totalRows: result.totalRows, created: result.created, updated: result.updated, failed: result.failed, totalSpend: result.totalSpend },
    });
    return result;
  },
});

const adSpendBody = z.object({
  platform: platformEnum.default("META"),
  date: isoDate,
  campaignId: z.string().trim().max(100).default(""),
  campaignName: z.string().trim().max(300).nullish(),
  adsetId: z.string().trim().max(100).default(""),
  adId: z.string().trim().max(100).default(""),
  spend: moneySchema,
  impressions: z.number().int().min(0).default(0),
  clicks: z.number().int().min(0).default(0),
  reportedPurchases: z.number().int().min(0).default(0),
  reportedRevenue: moneySchema.default("0"),
});

route({
  method: "post",
  path: "/ad-spend",
  summary: "Record ad spend manually (upserts the same platform/date/campaign/ad set/ad)",
  access: "marketing.manage",
  status: 201,
  body: adSpendBody,
  handler: async ({ body, user, ip }) => {
    if (!body.campaignId && !body.campaignName) throw badRequest("campaignId or campaignName is required");
    const spend = money(body.spend);
    const reportedRevenue = money(body.reportedRevenue);
    if (spend.isNegative() || reportedRevenue.isNegative()) throw badRequest("Amounts cannot be negative");
    const { row, created } = await upsertAdSpend(prisma, {
      platform: body.platform, date: body.date, campaignId: body.campaignId, campaignName: body.campaignName ?? null,
      adsetId: body.adsetId, adId: body.adId, spend, impressions: body.impressions, clicks: body.clicks,
      reportedPurchases: body.reportedPurchases, reportedRevenue,
    }, "MANUAL", `manual_${randomToken(6)}`);
    await audit(prisma, { userId: user.id, action: created ? "marketing.ad_spend_created" : "marketing.ad_spend_updated", entityType: "AdSpendRecord", entityId: row.id, after: row, ip });
    return { ...row, created };
  },
});

route({
  method: "get",
  path: "/ad-spend",
  summary: "Ad spend records with totals",
  access: "marketing.view",
  query: pageQuery.extend(dateRangeQuery.shape).extend({
    platform: platformEnum.optional(),
    campaign: z.string().max(300).optional(),
    importBatch: z.string().max(100).optional(),
  }),
  handler: async ({ query }) => {
    const { from, to } = resolveRange(query.from, query.to);
    const where: Prisma.AdSpendRecordWhereInput = {
      date: { gte: dateOnly(from), lte: dateOnly(to) },
      ...(query.platform ? { platform: query.platform } : {}),
      ...(query.importBatch ? { importBatch: query.importBatch } : {}),
      ...(query.campaign
        ? { OR: [{ campaignId: query.campaign }, { campaignName: { contains: query.campaign, mode: "insensitive" } }] }
        : {}),
    };
    const [rows, total, agg] = await Promise.all([
      prisma.adSpendRecord.findMany({ where, orderBy: [{ date: "desc" }, { campaignName: "asc" }], skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
      prisma.adSpendRecord.count({ where }),
      prisma.adSpendRecord.aggregate({ where, _sum: { spend: true, impressions: true, clicks: true, reportedPurchases: true, reportedRevenue: true } }),
    ]);
    return withMeta(rows, {
      ...pageMeta(query.page, query.pageSize, total),
      from, to,
      totals: {
        spend: money(agg._sum.spend).toFixed(2),
        impressions: agg._sum.impressions ?? 0,
        clicks: agg._sum.clicks ?? 0,
        reportedPurchases: agg._sum.reportedPurchases ?? 0,
        reportedRevenue: money(agg._sum.reportedRevenue).toFixed(2),
      },
    });
  },
});

route({
  method: "delete",
  path: "/ad-spend/:id",
  summary: "Delete an ad spend record",
  access: "marketing.manage",
  params: idParam,
  handler: async ({ params, user, ip }) => {
    const before = assertFound(await prisma.adSpendRecord.findUnique({ where: { id: params.id } }), "Ad spend record");
    await prisma.adSpendRecord.delete({ where: { id: params.id } });
    await audit(prisma, { userId: user.id, action: "marketing.ad_spend_deleted", entityType: "AdSpendRecord", entityId: params.id, before, ip });
    return { deleted: true };
  },
});

// ───────────── Meta Pixel / Conversions API ─────────────

route({
  method: "get",
  path: "/meta/status",
  summary: "Meta Pixel / Conversions API configuration (never returns the token) and recent server events",
  access: "marketing.view",
  query: z.object({ limit: z.coerce.number().int().min(1).max(200).default(25) }),
  handler: async ({ query }) => {
    const cfg = await getMetaConfig();
    const since = new Date(Date.now() - 7 * 24 * 3600 * 1000);
    const [recent, byStatus] = await Promise.all([
      prisma.metaEventLog.findMany({ orderBy: { createdAt: "desc" }, take: query.limit }),
      prisma.metaEventLog.groupBy({ by: ["status"], where: { createdAt: { gte: since } }, _count: { _all: true } }),
    ]);
    return {
      pixelId: cfg.pixelId || null,
      pixelConfigured: Boolean(cfg.pixelId),
      capiEnabled: cfg.capiEnabled,
      accessTokenConfigured: Boolean(cfg.token),
      testEventCodeConfigured: Boolean(cfg.testEventCode),
      capiActive: cfg.active,
      inactiveReason: cfg.reason,
      graphApiVersion: META_GRAPH_VERSION,
      purchaseEventIdFormat: "purchase:<orderId>",
      last7Days: Object.fromEntries(byStatus.map((s) => [s.status, s._count._all])),
      recentEvents: recent.map((r) => ({ id: r.id, eventName: r.eventName, eventId: r.eventId, orderId: r.orderId, status: r.status, error: r.error, createdAt: r.createdAt })),
    };
  },
});

route({
  method: "post",
  path: "/meta/test",
  summary: "Send a test server event to Meta (only when the Conversions API is configured)",
  description: "Uses META_TEST_EVENT_CODE, or the `testEventCode` in the body, so it shows in Events Manager → Test events. Contains no customer data.",
  access: "marketing.manage",
  body: z.object({ testEventCode: z.string().trim().max(50).optional() }),
  handler: async ({ body, user, ip }) => {
    const cfg = await getMetaConfig();
    if (!cfg.active) throw unprocessable("META_NOT_CONFIGURED", cfg.reason ?? "Meta Conversions API is not configured");
    const testEventCode = body.testEventCode || cfg.testEventCode;
    // without a test code the event would count as real traffic in the pixel
    if (!testEventCode) throw unprocessable("TEST_CODE_REQUIRED", "Set META_TEST_EVENT_CODE or pass testEventCode (Events Manager → Test events)");
    const eventId = `test_${Date.now()}_${randomToken(4)}`;
    const result = await sendMetaEvent({
      eventName: "PageView",
      eventId,
      testEventCode,
      event: {
        event_name: "PageView",
        event_time: Math.floor(Date.now() / 1000),
        event_id: eventId,
        action_source: "website",
        event_source_url: "https://example.invalid/capi-test",
        user_data: { client_user_agent: "BentBound-CAPI-Test/1.0", client_ip_address: "127.0.0.1" },
      },
    });
    await audit(prisma, { userId: user.id, action: "marketing.meta_test_event", entityType: "MetaEventLog", entityId: result.logId ?? null, after: { status: result.status, eventId }, ip });
    return { eventId, ...result };
  },
});
