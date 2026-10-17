import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { api, staff, unique, type Client } from "./helpers.js";
import { dhakaArea, makeOrder, makeProduct, testPhone } from "./fixtures.js";
import { prisma } from "../src/lib/prisma.js";
import { env } from "../src/config/env.js";
import { setSetting, SETTING_DEFAULTS } from "../src/lib/settings.js";
import { money, sum } from "../src/lib/money.js";
import { startOfDhakaDay } from "../src/lib/time.js";
import { createOrder, systemActor } from "../src/modules/orders/orders.service.js";
import { purchaseEventId, sendMetaEvent } from "../src/modules/marketing/meta-capi.js";
import { parseCsv } from "../src/modules/marketing/ad-spend.js";

let admin: Client;
let marketer: Client;
let analyst: Client;

const sha = (v: string) => createHash("sha256").update(v).digest("hex");
const at = (date: string, hhmm: string) => new Date(startOfDhakaDay(date).getTime() + (Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3))) * 60_000);

async function waitFor<T>(fn: () => Promise<T | null | undefined | false>, timeoutMs = 3000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v as T;
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 50));
  }
}

const importCsv = (client: Client, csv: string, filename = "spend.csv", fields: Record<string, string> = {}) => {
  let req = api.post("/api/v1/marketing/ad-spend/import").set("Authorization", `Bearer ${client.token}`);
  for (const [k, v] of Object.entries(fields)) req = req.field(k, v);
  return req.attach("file", Buffer.from(csv, "utf8"), { filename, contentType: "text/csv" });
};

async function storefrontOrder(variantId: string, attribution?: Record<string, string>) {
  const area = await dhakaArea();
  const { order } = await createOrder(
    {
      customer: { name: "Web Buyer", phone: testPhone(), email: "Buyer@Example.com " },
      shipping: { addressLine: "House 7, Road 3, Gulshan 1, Dhaka", areaId: area.id },
      items: [{ variantId, quantity: 1 }],
      requirePublished: true,
      attribution,
    },
    systemActor("STOREFRONT"),
  );
  return order;
}

beforeAll(async () => {
  admin = await staff(["admin"]);
  marketer = await staff(["marketing_manager"]);
  analyst = await staff(["analyst"]);
});

afterAll(async () => {
  await setSetting("meta", { capiEnabled: false, pixelId: "" }, null);
});

describe("CSV parsing", () => {
  it("handles quotes, escaped quotes, CRLF and BOM", () => {
    const rows = parseCsv('﻿a,b\r\n"x, y","say ""hi"""\r\n\r\n1,2');
    expect(rows).toEqual([["a", "b"], ["x, y", 'say "hi"'], ["1", "2"]]);
  });
});

describe("ad spend import", () => {
  it("upserts rows, reports bad rows, and never duplicates on re-import", async () => {
    const c = `cmp_${unique()}`;
    const csv = [
      "Date,Platform,Campaign_ID,Campaign_Name,Adset_ID,Ad_ID,Spend,Impressions,Clicks,Reported_Purchases,Reported_Revenue",
      `2025-02-01,META,${c},Winter Orna,as1,ad1,"1,250.50",10000,300,4,9080`,
      `2025-02-01,META,${c},Winter Orna,as1,ad2,749.50,8000,200,2,4540`,
      `2025-02-02,meta,${c},Winter Orna,as1,ad1,500,5000,100,1,2270`,
      `2025-02-31,META,${c},Winter Orna,as1,ad1,100,1,1,0,0`, // invalid date
      `2025-02-03,META,${c},Winter Orna,as1,ad1,abc,1,1,0,0`, // invalid spend
      `2025-02-01,META,${c},Winter Orna,as1,ad1,99,1,1,0,0`, // duplicate key of row 2
      `2025-02-04,SNAPCHAT,${c},Winter Orna,as1,ad1,10,1,1,0,0`, // unknown platform
    ].join("\r\n");

    const ledgerBefore = await prisma.financialEntry.count();
    const first = await importCsv(marketer, csv);
    expect(first.status).toBe(200);
    expect(first.body.data).toMatchObject({ totalRows: 7, created: 3, updated: 0, failed: 4, totalSpend: "2500.00" });
    expect(first.body.data.errors.map((e: { row: number }) => e.row)).toEqual([5, 6, 7, 8]);
    expect(first.body.data.errors[2].messages[0]).toMatch(/Duplicate of row 2/);
    expect(await prisma.adSpendRecord.count({ where: { campaignId: c } })).toBe(3);

    const second = await importCsv(marketer, csv);
    expect(second.body.data).toMatchObject({ created: 0, updated: 3, failed: 4 });
    expect(await prisma.adSpendRecord.count({ where: { campaignId: c } })).toBe(3);
    const row = await prisma.adSpendRecord.findFirstOrThrow({ where: { campaignId: c, adId: "ad1", date: new Date("2025-02-01T00:00:00Z") } });
    expect(row.spend.toFixed(2)).toBe("1250.50");
    expect(row.importBatch).toBe(second.body.data.importBatch);

    // analytics only: no ledger rows
    expect(await prisma.financialEntry.count()).toBe(ledgerBefore);
    const auditRow = await prisma.auditLog.findFirst({ where: { action: "marketing.ad_spend_imported", entityId: second.body.data.importBatch } });
    expect(auditRow).not.toBeNull();
  });

  it("accepts Meta Ads Manager export headers", async () => {
    const name = `Ads Manager ${unique()}`;
    const csv = [
      "Reporting starts,Reporting ends,Campaign name,Campaign ID,Amount spent (BDT),Impressions,Link clicks,Purchases,Purchases conversion value",
      `2025-02-10,2025-02-10,${name},,300.00,1000,40,1,2270`,
    ].join("\n");
    const res = await importCsv(marketer, csv);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ created: 1, failed: 0 });
    const r = await prisma.adSpendRecord.findFirstOrThrow({ where: { campaignName: name } });
    expect(r.platform).toBe("META");
    expect(r.clicks).toBe(40);
    expect(r.reportedRevenue.toFixed(2)).toBe("2270.00");
  });

  it("rejects unusable headers and non-BDT spend", async () => {
    const res = await importCsv(marketer, "foo,bar\n1,2");
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("INVALID_CSV");
    const usd = await importCsv(marketer, "Day,Campaign name,Amount spent (USD)\n2025-02-10,X,3");
    expect(usd.status).toBe(422);
    expect(JSON.stringify(usd.body.error.details)).toMatch(/BDT/);
  });

  it("requires marketing.manage to import; manual record + list totals + delete", async () => {
    const denied = await importCsv(analyst, "date,campaign_id,spend\n2025-02-01,x,1");
    expect(denied.status).toBe(403);

    const c = `cmp_${unique()}`;
    const created = await marketer.post("/api/v1/marketing/ad-spend", { date: "2025-01-05", campaignId: c, campaignName: "Manual", spend: "100.10" });
    expect(created.status).toBe(201);
    const again = await marketer.post("/api/v1/marketing/ad-spend", { date: "2025-01-05", campaignId: c, campaignName: "Manual", spend: "200.20" });
    expect(again.body.data.created).toBe(false);
    await marketer.post("/api/v1/marketing/ad-spend", { date: "2025-01-06", campaignId: c, spend: "50", platform: "GOOGLE" });

    const list = await analyst.get(`/api/v1/marketing/ad-spend?from=2025-01-05&to=2025-01-06&campaign=${c}`);
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(2);
    expect(list.body.meta.totals.spend).toBe("250.20");

    const del = await marketer.delete(`/api/v1/marketing/ad-spend/${created.body.data.id}`);
    expect(del.status).toBe(200);
    expect(await prisma.adSpendRecord.count({ where: { campaignId: c } })).toBe(1);
  });
});

describe("attribution, campaigns and reconciliation", () => {
  const D = "2025-03-15";
  let campaignId: string;
  let campaignName: string;
  let delivered: Awaited<ReturnType<typeof prisma.order.findUniqueOrThrow>>[];

  beforeAll(async () => {
    campaignId = `cmp_${unique()}`;
    campaignName = `Eid Orna ${unique()}`;
    const product = await makeProduct(admin, { price: "2270", cost: "1120", stock: [50] });
    const v = product.variants[0].id;
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) {
      const res = await makeOrder(admin, v);
      expect(res.status).toBe(201);
      ids.push(res.body.data.id);
    }
    const [o1, o2, o3, o4] = ids;
    const attr = { lastSource: "Facebook", lastMedium: "paid", lastCampaign: campaignName, campaignId, firstSource: "instagram", firstMedium: "social", firstCampaign: campaignName };
    for (const id of [o1, o2, o3]) await prisma.marketingAttribution.create({ data: { orderId: id, ...attr } });
    // o1, o2 delivered on D; o3 cancelled; o4 has no attribution and stays pending
    for (const id of [o1, o2]) {
      await prisma.order.update({ where: { id }, data: { status: "DELIVERED", createdAt: at(D, "10:00"), confirmedAt: at(D, "11:00"), shippedAt: at(D, "12:00"), deliveredAt: at(D, "18:00") } });
    }
    await prisma.order.update({ where: { id: o3 }, data: { status: "CANCELLED", createdAt: at(D, "10:30"), cancelledAt: at(D, "11:30") } });
    await prisma.order.update({ where: { id: o4 }, data: { createdAt: at(D, "23:59") } });
    delivered = await Promise.all([o1, o2].map((id) => prisma.order.findUniqueOrThrow({ where: { id } })));

    await marketer.post("/api/v1/marketing/ad-spend", { date: D, campaignId, campaignName, spend: "1000", reportedPurchases: 5, reportedRevenue: "12000" });
  });

  it("groups by last touch with delivered-only revenue, CPA, ROAS and estimated profit", async () => {
    const res = await analyst.get(`/api/v1/marketing/attribution?from=${D}&to=${D}&model=last`);
    expect(res.status).toBe(200);
    const row = res.body.data.rows.find((r: { campaign: string }) => r.campaign === campaignName);
    expect(row).toMatchObject({ source: "facebook", medium: "paid", placed: 3, confirmed: 2, delivered: 2, cancelled: 1, returned: 0, returnRate: "0.00" });

    const revenue = sum(delivered.map((o) => o.total));
    expect(row.deliveredRevenue).toBe(revenue.toFixed(2));
    expect(row.platform).toMatchObject({ spend: "1000.00", reportedPurchases: 5, reportedRevenue: "12000.00" });
    expect(row.cpa).toBe("500.00");
    expect(row.roas).toBe(revenue.dividedBy(1000).toDecimalPlaces(2).toFixed(2));

    // delivered revenue − product cost − packaging − courier estimate (zone fee + COD %) − spend
    const fin = SETTING_DEFAULTS.finance;
    const zone = await prisma.deliveryZone.findUniqueOrThrow({ where: { id: delivered[0].zoneId! } });
    const courier = sum(delivered.map((o) => money(fin.estimatedCourierFee[zone.code]).plus(money(money(o.codAmount).times(fin.codChargePercent).dividedBy(100)))));
    const expected = revenue.minus(sum(delivered.map((o) => o.productCostTotal))).minus(sum(delivered.map((o) => o.packagingCost))).minus(courier).minus(1000);
    expect(row.estimatedNetProfit.estimated).toBe(true);
    expect(row.estimatedNetProfit.amount).toBe(money(expected).toFixed(2));

    const direct = res.body.data.rows.find((r: { source: string }) => r.source === "(direct / unknown)");
    expect(direct.placed).toBeGreaterThanOrEqual(1);
    expect(direct.platform.reportedPurchases).toBe(0);
  });

  it("supports the first-touch model", async () => {
    const res = await analyst.get(`/api/v1/marketing/attribution?from=${D}&to=${D}&model=first`);
    const row = res.body.data.rows.find((r: { campaign: string }) => r.campaign === campaignName);
    expect(row).toMatchObject({ source: "instagram", medium: "social", placed: 3, delivered: 2, cpa: "500.00" });
  });

  it("reports campaign quality", async () => {
    const res = await analyst.get(`/api/v1/marketing/campaigns?from=${D}&to=${D}`);
    expect(res.status).toBe(200);
    const row = res.body.data.rows.find((r: { campaign: string }) => r.campaign === campaignName);
    expect(row).toMatchObject({ placed: 3, deliveredOfPlaced: 2, cancelled: 1, deliveryRate: "66.67", cancellationRate: "33.33", returnRate: "0.00" });
    expect(row.avgOrderValue).toBe(money(sum(delivered.map((o) => o.total)).dividedBy(2)).toFixed(2));
  });

  it("reconciles platform-reported vs verified and expenses vs imported spend", async () => {
    let res = await analyst.get(`/api/v1/marketing/reconciliation?from=${D}&to=${D}`);
    expect(res.status).toBe(200);
    const camp = res.body.data.campaigns.find((c: { campaignId: string }) => c.campaignId === campaignId);
    expect(camp.platformReported).toEqual({ purchases: 5, revenue: "12000.00" });
    expect(camp.verified).toMatchObject({ placedOrders: 3, cancelledOrders: 1, deliveredOrders: 2 });
    expect(camp.reportedVsDelivered).toBe(3);
    expect(res.body.data.expenses.status).toBe("NO_EXPENSES");

    const category = await prisma.expenseCategory.findFirstOrThrow({ where: { type: "ADVERTISING" } });
    await prisma.expense.create({ data: { categoryId: category.id, amount: "1000", date: new Date(`${D}T00:00:00Z`), description: "Meta ads bill" } });
    res = await analyst.get(`/api/v1/marketing/reconciliation?from=${D}&to=${D}`);
    expect(res.body.data.expenses).toMatchObject({ recordedAdvertisingExpenses: "1000.00", importedSpend: "1000.00", difference: "0.00", status: "MATCHED" });

    await prisma.expense.create({ data: { categoryId: category.id, amount: "1000", date: new Date(`${D}T00:00:00Z`), description: "Meta ads bill (again)" } });
    res = await analyst.get(`/api/v1/marketing/reconciliation?from=${D}&to=${D}`);
    expect(res.body.data.expenses.status).toBe("EXPENSES_HIGHER");
  });
});

describe("Meta Conversions API", () => {
  let variantId: string;
  beforeAll(async () => {
    variantId = (await makeProduct(admin, { stock: [50] })).variants[0].id;
  });

  it("records SKIPPED when not configured, never sends twice, and ignores staff orders", async () => {
    const order = await storefrontOrder(variantId, { fbc: "fb.1.1700000000.abc", fbp: "fb.1.1700000000.123", lastSource: "facebook" });
    const log = await waitFor(() => prisma.metaEventLog.findUnique({ where: { eventName_eventId: { eventName: "Purchase", eventId: purchaseEventId(order.id) } } }));
    expect(log.status).toBe("SKIPPED");
    expect(log.error).toMatch(/disabled/);

    const again = await sendMetaEvent({ eventName: "Purchase", eventId: purchaseEventId(order.id), orderId: order.id });
    expect(again.status).toBe("DUPLICATE");
    expect(await prisma.metaEventLog.count({ where: { eventId: purchaseEventId(order.id) } })).toBe(1);

    const staffOrder = await makeOrder(admin, variantId, { channel: "WEBSITE" });
    await new Promise((r) => setTimeout(r, 300));
    expect(await prisma.metaEventLog.count({ where: { orderId: staffOrder.body.data.id } })).toBe(0);
  });

  it("sends a hashed, deduplicable Purchase when configured", async () => {
    const res = await makeOrder(admin, variantId, { customer: { name: "Hash Me", phone: testPhone(), email: "Hash.Me@Example.COM" } });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const orderId = res.body.data.id as string;
    await prisma.marketingAttribution.create({ data: { orderId, fbc: "fb.1.1700000000.xyz", fbp: "fb.1.1700000000.987", lastLandingPage: "https://bentandbound.com/p/orna" } });
    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { items: true } });

    const savedToken = env.META_CAPI_ACCESS_TOKEN;
    const savedCode = env.META_TEST_EVENT_CODE;
    env.META_CAPI_ACCESS_TOKEN = "secret-token";
    env.META_TEST_EVENT_CODE = "TEST123";
    await setSetting("meta", { capiEnabled: true, pixelId: "998877" }, null);
    try {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "temporary" } }), { status: 500 }))
        .mockResolvedValue(new Response(JSON.stringify({ events_received: 1, fbtrace_id: "t" }), { status: 200 }));
      const job = { eventName: "Purchase", eventId: purchaseEventId(orderId), orderId };

      const failed = await sendMetaEvent(job, fetchMock as unknown as typeof fetch);
      expect(failed).toMatchObject({ status: "FAILED", retryable: true });
      const sent = await sendMetaEvent(job, fetchMock as unknown as typeof fetch);
      expect(sent.status).toBe("SENT");
      const dup = await sendMetaEvent(job, fetchMock as unknown as typeof fetch);
      expect(dup.status).toBe("DUPLICATE");
      expect(fetchMock).toHaveBeenCalledTimes(2);

      const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
      expect(url).toBe("https://graph.facebook.com/v21.0/998877/events?access_token=secret-token");
      const payload = JSON.parse(String(init.body));
      expect(payload.test_event_code).toBe("TEST123");
      const ev = payload.data[0];
      expect(ev).toMatchObject({ event_name: "Purchase", event_id: `purchase:${orderId}`, action_source: "website", event_source_url: "https://bentandbound.com/p/orna" });
      expect(ev.user_data.ph).toEqual([sha(`88${order.shippingPhone}`)]);
      expect(ev.user_data.em).toEqual([sha("hash.me@example.com")]);
      expect(ev.user_data.fbc).toBe("fb.1.1700000000.xyz");
      expect(ev.user_data.fbp).toBe("fb.1.1700000000.987");
      expect(ev.custom_data).toMatchObject({ currency: "BDT", value: Number(order.total.toFixed(2)), content_ids: order.items.map((i) => i.sku) });
      expect(String(init.body)).not.toContain(order.shippingPhone);
      expect(String(init.body).toLowerCase()).not.toContain("hash.me@example.com");

      const status = await analyst.get("/api/v1/marketing/meta/status");
      expect(status.status).toBe(200);
      expect(status.body.data).toMatchObject({ pixelId: "998877", capiActive: true, accessTokenConfigured: true });
      expect(JSON.stringify(status.body)).not.toContain("secret-token");
    } finally {
      env.META_CAPI_ACCESS_TOKEN = savedToken;
      env.META_TEST_EVENT_CODE = savedCode;
      await setSetting("meta", { capiEnabled: false, pixelId: "" }, null);
    }
  });

  it("refuses the test event when not configured", async () => {
    const res = await marketer.post("/api/v1/marketing/meta/test", {});
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("META_NOT_CONFIGURED");
    expect((await analyst.post("/api/v1/marketing/meta/test", {})).status).toBe(403);
  });
});
