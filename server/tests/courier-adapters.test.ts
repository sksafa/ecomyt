import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../src/lib/prisma.js";
import { encrypt, encryptJson } from "../src/lib/crypto.js";
import { steadfastAdapter } from "../src/modules/couriers/adapters/steadfast.js";
import { pathaoAdapter } from "../src/modules/couriers/adapters/pathao.js";
import { redxAdapter } from "../src/modules/couriers/adapters/redx.js";
import { ecourierAdapter } from "../src/modules/couriers/adapters/ecourier.js";
import { contextFor } from "../src/modules/couriers/registry.js";
import { handleWebhook } from "../src/modules/couriers/shipments.service.js";
import type { CourierContext } from "../src/modules/couriers/types.js";
import { staff } from "./helpers.js";
import { makeOrder, makeProduct } from "./fixtures.js";

// Contract tests: the real adapters run against a stubbed fetch – no courier is ever contacted.
type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };
let calls: Call[] = [];
function stubFetch(responder: (call: Call) => unknown) {
  calls = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    const call = { url: String(url), method: init.method ?? "GET", headers: (init.headers ?? {}) as Record<string, string>, body: init.body ? JSON.parse(String(init.body)) : null };
    calls.push(call);
    const body = responder(call);
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  });
}
afterEach(() => vi.unstubAllGlobals());

async function ctxFor(code: string, credentials: Record<string, string>, config: Record<string, unknown> = {}, webhookSecret = "whsec-test"): Promise<CourierContext> {
  const p = await prisma.courierProvider.update({ where: { code }, data: { credentials: encryptJson(credentials), config: config as never, webhookSecret: encrypt(webhookSecret) } });
  return contextFor(p);
}

const req = {
  merchantReference: "BB100500", recipientName: "Safawat", recipientPhone: "01814246749", recipientAddress: "Jobbar Molla Tower, Gulshan, Dhaka",
  districtName: "Dhaka", areaName: "Gulshan", codAmount: "2270.00", weightGrams: 300, itemDescription: "offwhite100 x1", itemQuantity: 1, note: "Call first",
};

describe("Steadfast adapter", () => {
  it("creates an order with header auth and maps the response", async () => {
    const ctx = await ctxFor("STEADFAST", { apiKey: "k", secretKey: "s" });
    stubFetch(() => ({ status: 200, consignment: { consignment_id: 1424107, invoice: "BB100500", tracking_code: "15BAEB8A", status: "in_review" } }));
    const r = await steadfastAdapter.createShipment(ctx, req);
    expect(calls[0].url).toBe("https://portal.packzy.com/api/v1/create_order");
    expect(calls[0].headers["Api-Key"]).toBe("k");
    expect(calls[0].body).toMatchObject({ invoice: "BB100500", recipient_phone: "01814246749", cod_amount: 2270 });
    expect(r).toMatchObject({ consignmentId: "1424107", trackingCode: "15BAEB8A", status: "BOOKED" });
    const log = await prisma.courierApiLog.findFirstOrThrow({ where: { operation: "create", providerId: ctx.providerId }, orderBy: { createdAt: "desc" } });
    expect(JSON.stringify(log.request)).not.toContain("01814246749"); // phone masked in logs
  });

  it("treats a duplicate invoice as a permanent failure", async () => {
    const ctx = await ctxFor("STEADFAST", { apiKey: "k", secretKey: "s" });
    stubFetch(() => ({ status: 400, message: "THIS_INVOICE_ALREADY_EXISTS" }));
    await expect(steadfastAdapter.createShipment(ctx, req)).rejects.toMatchObject({ retryable: false });
  });

  it("accepts webhooks only with the bearer token", async () => {
    const ctx = await ctxFor("STEADFAST", { apiKey: "k", secretKey: "s" });
    const body = { consignment_id: 1, status: "delivered" };
    const raw = Buffer.from(JSON.stringify(body));
    expect(steadfastAdapter.verifyWebhook!(ctx, { headers: { authorization: "Bearer whsec-test" }, rawBody: raw, body })).toBe(true);
    expect(steadfastAdapter.verifyWebhook!(ctx, { headers: { authorization: "Bearer nope" }, rawBody: raw, body })).toBe(false);
    expect(steadfastAdapter.verifyWebhook!(ctx, { headers: {}, query: { token: "whsec-test" }, rawBody: raw, body })).toBe(true);
  });
});

describe("unsigned webhooks are confirmed through the courier API", () => {
  it("applies the status the API reports, not the one in the webhook body", async () => {
    const admin = await staff(["admin"]);
    const product = await makeProduct(admin);
    const id = (await makeOrder(admin, product.variants[0].id)).body.data.id;
    await admin.post(`/api/v1/orders/${id}/status`, { status: "CONFIRMED" });
    await admin.post(`/api/v1/orders/${id}/status`, { status: "READY_TO_SHIP" });
    const provider = await prisma.courierProvider.update({ where: { code: "STEADFAST" }, data: { isEnabled: true, credentials: encryptJson({ apiKey: "k", secretKey: "s" }), webhookSecret: encrypt("whsec-test") } });
    const order = await prisma.order.findUniqueOrThrow({ where: { id } });
    const shipment = await prisma.shipment.create({ data: { orderId: id, providerId: provider.id, status: "BOOKED", consignmentId: "777", trackingCode: "TRK777", idempotencyKey: `test:${id}`, codAmount: order.codAmount, weightGrams: 300 } });
    await prisma.order.update({ where: { id }, data: { status: "COURIER_BOOKED" } });

    // the webhook claims "delivered", but the API still says "in_review"
    stubFetch(() => ({ status: 200, delivery_status: "in_review" }));
    const body = { consignment_id: 777, status: "delivered", delivery_charge: 1 };
    const res = await handleWebhook("STEADFAST", { headers: { authorization: "Bearer whsec-test" }, rawBody: Buffer.from(JSON.stringify(body)), body });
    expect(res.applied).toBe(0);
    expect(calls[0].url).toContain("/status_by_cid/777");
    expect((await prisma.shipment.findUniqueOrThrow({ where: { id: shipment.id } })).status).toBe("BOOKED");

    stubFetch(() => ({ status: 200, delivery_status: "delivered" }));
    const body2 = { consignment_id: 777, status: "delivered", updated_at: new Date().toISOString() };
    const res2 = await handleWebhook("STEADFAST", { headers: { authorization: "Bearer whsec-test" }, rawBody: Buffer.from(JSON.stringify(body2)), body: body2 });
    expect(res2.applied).toBe(1);
    expect((await prisma.order.findUniqueOrThrow({ where: { id } })).status).toBe("DELIVERED");
    await prisma.courierProvider.update({ where: { code: "STEADFAST" }, data: { isEnabled: false } });
  });
});

describe("Pathao adapter", () => {
  it("authenticates once, caches the token and sends the documented order fields", async () => {
    const ctx = await ctxFor("PATHAO", { clientId: "cid", clientSecret: "csec" }, { storeId: 1234 });
    ctx.sandbox = true;
    stubFetch((c) =>
      c.url.endsWith("/external/login")
        ? { access_token: "tok", expires_in: 3600 }
        : { data: { consignment_id: "DL121224VS8TTJ", merchant_order_id: "BB100500", order_status: "Pending", delivery_fee: 80 } },
    );
    const r = await pathaoAdapter.createShipment(ctx, req);
    await pathaoAdapter.createShipment(ctx, { ...req, merchantReference: "BB100501" });
    expect(calls.filter((c) => c.url.endsWith("/external/login"))).toHaveLength(1);
    expect(calls[1].url).toBe("https://courier-api-sandbox.pathao.com/aladdin/api/v1/orders");
    expect(calls[1].headers.Authorization).toBe("Bearer tok");
    expect(calls[1].body).toMatchObject({ store_id: 1234, merchant_order_id: "BB100500", amount_to_collect: 2270, item_weight: 0.5, delivery_type: 48 });
    expect(r).toMatchObject({ consignmentId: "DL121224VS8TTJ", deliveryFee: "80" });
  });

  it("answers the integration handshake and verifies the shared secret", async () => {
    const ctx = await ctxFor("PATHAO", { clientId: "cid", clientSecret: "csec" }, { storeId: 1 });
    const body = { event: "webhook_integration" };
    const w = { headers: { "x-pathao-signature": "whsec-test" }, rawBody: Buffer.from("{}"), body };
    expect(pathaoAdapter.verifyWebhook!(ctx, w)).toBe(true);
    expect(pathaoAdapter.verifyWebhook!(ctx, { ...w, headers: { "x-pathao-signature": "x" } })).toBe(false);
    const hs = pathaoAdapter.webhookHandshake!(ctx, w);
    expect(hs?.status).toBe(202);
    expect(hs?.headers?.["X-Pathao-Merchant-Webhook-Integration-Secret"]).toBe("f3992ecc-59da-4cbe-a049-a13da2018d51");
    const [e] = pathaoAdapter.parseWebhook!(ctx, { ...w, body: { event: "order.delivered", consignment_id: "DL1", merchant_order_id: "BB1" } });
    expect(e.status).toBe("DELIVERED");
  });
});

describe("RedX adapter", () => {
  it("resolves the delivery area id by name and books with it", async () => {
    const ctx = await ctxFor("REDX", { accessToken: "jwt" });
    stubFetch((c) => (c.url.includes("/areas") ? { areas: [{ id: 1, name: "Banani" }, { id: 7, name: "Gulshan" }] } : { tracking_id: "20A312THJDJ8" }));
    const r = await redxAdapter.createShipment(ctx, req);
    expect(calls[0].url).toContain("district_name=Dhaka");
    expect(calls[1].headers["API-ACCESS-TOKEN"]).toBe("Bearer jwt");
    expect(calls[1].body).toMatchObject({ delivery_area_id: 7, delivery_area: "Gulshan", merchant_invoice_id: "BB100500", cash_collection_amount: "2270" });
    expect(r.trackingCode).toBe("20A312THJDJ8");
  });

  it("refuses to guess an unknown area and verifies the URL token", async () => {
    const ctx = await ctxFor("REDX", { accessToken: "jwt" });
    stubFetch(() => ({ areas: [{ id: 1, name: "Banani" }] }));
    await expect(redxAdapter.createShipment(ctx, { ...req, districtName: "Sylhet", areaName: "Zindabazar" })).rejects.toMatchObject({ retryable: false });
    const w = { headers: {}, query: { token: "whsec-test" }, rawBody: Buffer.from("{}"), body: { tracking_number: "X", status: "agent-returning" } };
    expect(redxAdapter.verifyWebhook!(ctx, w)).toBe(true);
    expect(redxAdapter.parseWebhook!(ctx, w)[0].status).toBe("RETURNING");
  });
});

describe("eCourier adapter", () => {
  it("can find an existing parcel by our reference (safe retries)", async () => {
    const ctx = await ctxFor("ECOURIER", { apiKey: "k", apiSecret: "s", userId: "u" }, { packageCode: "#2416" });
    stubFetch(() => ({ query_data: [{ ecr: "ECR1030102170392", product_id: "BB100500", status: [["Initiated API", "", "2026-10-17 10:00:00"], ["Picked Up", "", "2026-10-17 15:00:00"]] }] }));
    const found = await ecourierAdapter.findByReference!(ctx, "BB100500");
    expect(found).toMatchObject({ consignmentId: "ECR1030102170392", status: "PICKED_UP" });
    expect(calls[0].headers["USER-ID"]).toBe("u");
    expect(calls[0].body).toEqual({ product_id: "BB100500" });
  });
});

beforeAll(() => undefined);
