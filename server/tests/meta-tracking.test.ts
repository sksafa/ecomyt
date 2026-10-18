import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { api, staff, unique, type Client } from "./helpers.js";
import { makeOrder, makeProduct, testPhone } from "./fixtures.js";
import { prisma } from "../src/lib/prisma.js";
import { env } from "../src/config/env.js";
import { setSetting, clearSettingsCache } from "../src/lib/settings.js";
import { normalizePhoneForMeta, normalizeEmailForMeta, splitName } from "../src/modules/marketing/meta-capi.js";

// Meta Pixel + Conversions API: one purchase → one Purchase conversion.
// The Graph API is replaced by a recording stub; nothing is sent to Meta from tests.

const sha = (v: string) => createHash("sha256").update(v).digest("hex");
const STORE = "http://localhost:3000";

type GraphCall = { url: string; body: { data: Record<string, any>[]; access_token: string; test_event_code?: string } };
let graph: GraphCall[] = [];
let graphReply: () => Response = () => new Response(JSON.stringify({ events_received: 1, fbtrace_id: "trace" }), { status: 200 });

const realFetch = globalThis.fetch;
function stubGraph() {
  graph = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    if (String(url).includes("/events")) {
      graph.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      return graphReply();
    }
    return realFetch(url, init);
  });
}
const purchases = () => graph.filter((g) => g.body.data[0].event_name === "Purchase");
const waitFor = async <T>(fn: () => Promise<T | null | undefined | false>, ms = 3000): Promise<T> => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 40));
  }
};
const settle = () => new Promise((r) => setTimeout(r, 250)); // after-commit listeners run on setImmediate

let admin: Client;
let marketer: Client;
let variantId: string;
let sku: string;
const saved = { token: env.META_CAPI_ACCESS_TOKEN, code: env.META_TEST_EVENT_CODE };

async function enableMeta(on = true) {
  env.META_CAPI_ACCESS_TOKEN = on ? "server-secret-token" : "";
  env.META_TEST_EVENT_CODE = on ? "TEST12345" : "";
  await setSetting("meta", { capiEnabled: on, pixelId: on ? "1234567890" : "", purchaseValue: "ORDER_TOTAL" }, null);
  clearSettingsCache();
}

function checkoutBody(extra: Record<string, unknown> = {}) {
  return {
    customer: { name: "Md. Safawat Hossain", phone: testPhone(), email: "  Safawat.H@Example.COM " },
    shipping: { addressLine: "Jobbar Molla Tower, Kalachadpur, Gulshan" },
    items: [{ variantId, quantity: 2 }],
    deliveryOption: "OUTSIDE_DHAKA",
    paymentMethod: "COD",
    eventSourceUrl: `${STORE}/checkout?utm_source=facebook`,
    attribution: { fbc: "fb.1.1700000000000.IwAR-click", fbp: "fb.1.1700000000000.42", lastSource: "facebook" },
    ...extra,
  };
}
const checkout = (body: object, key = `meta-${unique()}-key`) =>
  api.post("/api/v1/storefront/checkout").set("Idempotency-Key", key).set("User-Agent", "Mozilla/5.0 (iPhone) Test").send(body);

beforeAll(async () => {
  admin = await staff(["admin"]);
  marketer = await staff(["marketing_manager"]);
  const p = await makeProduct(admin, { price: "2270", stock: [500] });
  variantId = p.variants[0].id;
  sku = p.variants[0].sku;
});
beforeEach(async () => {
  graphReply = () => new Response(JSON.stringify({ events_received: 1, fbtrace_id: "trace" }), { status: 200 });
  stubGraph();
  await enableMeta(true);
});
afterEach(() => vi.unstubAllGlobals());
afterAll(async () => {
  env.META_CAPI_ACCESS_TOKEN = saved.token;
  env.META_TEST_EVENT_CODE = saved.code;
  await setSetting("meta", { capiEnabled: false, pixelId: "", purchaseValue: "ORDER_TOTAL" }, null);
});

describe("Meta customer data normalisation", () => {
  it("formats match keys the way Meta specifies before hashing", () => {
    expect(normalizePhoneForMeta("+880 1712-345678")).toBe("8801712345678");
    expect(normalizePhoneForMeta("01712345678")).toBe("8801712345678");
    expect(normalizePhoneForMeta("12345")).toBeNull();
    expect(normalizeEmailForMeta("  Safawat.H@Example.COM ")).toBe("safawat.h@example.com");
    expect(normalizeEmailForMeta("not-an-email")).toBeNull();
    expect(splitName("Md. Safawat Hossain")).toEqual({ fn: "md", ln: "hossain" });
    expect(splitName("Nusrat")).toEqual({ fn: "nusrat", ln: null });
    expect(splitName("নুসরাত জাহান")).toEqual({ fn: "নুসরাত", ln: "জাহান" });
  });
});

describe("cash-on-delivery purchase", () => {
  it("browser and server get the same event id and identical parameters; customer data is hashed", async () => {
    const res = await checkout(checkoutBody());
    expect(res.status).toBe(201);
    const order = await prisma.order.findUniqueOrThrow({ where: { orderNumber: res.body.data.orderNumber }, include: { items: true } });
    const browser = res.body.data.metaPurchase;
    expect(browser).toMatchObject({ eventName: "Purchase", eventId: `purchase:${order.id}` });
    expect(order.metaPurchaseEventId).toBe(browser.eventId);
    expect(order.pixelPurchaseClaimedAt).not.toBeNull();

    const log = await waitFor(() => prisma.metaEventLog.findFirst({ where: { eventName: "Purchase", eventId: browser.eventId, status: "SENT" } }));
    expect(log.eventsReceived).toBe(1);
    expect(log.testEventCode).toBe("TEST12345");
    expect(purchases()).toHaveLength(1);

    const call = purchases()[0];
    expect(call.url).toBe("https://graph.facebook.com/v21.0/1234567890/events");
    expect(call.url).not.toContain("token"); // token travels in the body, never in URLs/logs
    expect(call.body.access_token).toBe("server-secret-token");
    expect(call.body.test_event_code).toBe("TEST12345");
    const ev = call.body.data[0];
    expect(ev).toMatchObject({ event_name: "Purchase", event_id: browser.eventId, action_source: "website", event_source_url: `${STORE}/checkout?utm_source=facebook` });
    expect(Math.abs(ev.event_time - Math.floor(order.createdAt.getTime() / 1000))).toBeLessThanOrEqual(1);

    // identical value / contents on both sides; value = order total incl. delivery (setting ORDER_TOTAL)
    expect(ev.custom_data).toEqual(browser.data);
    expect(browser.data).toMatchObject({
      currency: "BDT", value: 4660, order_total: 4660, product_value: 4540, delivery_charge: 120,
      content_type: "product", content_ids: [sku], contents: [{ id: sku, quantity: 2, item_price: 2270 }], num_items: 2, order_id: order.orderNumber,
    });

    const u = ev.user_data;
    expect(u.ph).toEqual([sha(`88${order.shippingPhone}`)]);
    expect(u.em).toEqual([sha("safawat.h@example.com")]);
    expect(u.fn).toEqual([sha("md")]);
    expect(u.ln).toEqual([sha("hossain")]);
    expect(u.country).toEqual([sha("bd")]);
    expect(u.external_id).toEqual([sha(order.customerId)]);
    expect(u.fbc).toBe("fb.1.1700000000000.IwAR-click");
    expect(u.fbp).toBe("fb.1.1700000000000.42");
    expect(u.client_user_agent).toBe("Mozilla/5.0 (iPhone) Test");
    expect(u.client_ip_address).toBeTruthy();
    const raw = JSON.stringify(call.body);
    expect(raw).not.toContain(order.shippingPhone);
    expect(raw.toLowerCase()).not.toContain("safawat.h@example.com");
    expect(raw.toLowerCase()).not.toContain("hossain");

    // the stored log keeps parameters and which match keys were used – no hashes or PII
    expect((log.payload as { match_keys: string[] }).match_keys).toEqual(expect.arrayContaining(["ph", "em", "fn", "ln", "fbc", "fbp"]));
    expect(JSON.stringify(log.payload)).not.toContain(sha(`88${order.shippingPhone}`));
  });

  it("double submits, retries and reloads produce exactly one Purchase on each side", async () => {
    const body = checkoutBody();
    const key = `dup-${unique()}-key`;
    const results = await Promise.all([checkout(body, key), checkout(body, key), checkout(body, key)]);
    const retry = await checkout(body, key); // e.g. browser retried after a lost response / page reload
    const all = [...results, retry];
    for (const r of all) expect(r.status).toBe(201);
    expect(new Set(all.map((r) => r.body.data.orderNumber)).size).toBe(1);
    const withPayload = all.filter((r) => r.body.data.metaPurchase);
    expect(withPayload).toHaveLength(1); // only the response that created the order lets the browser fire Purchase

    const orderNumber = all[0].body.data.orderNumber;
    const order = await prisma.order.findUniqueOrThrow({ where: { orderNumber } });
    await waitFor(() => prisma.metaEventLog.findFirst({ where: { orderId: order.id, status: "SENT" } }));
    await settle();
    expect(purchases().filter((g) => g.body.data[0].event_id === order.metaPurchaseEventId)).toHaveLength(1);
    expect(await prisma.metaEventLog.count({ where: { orderId: order.id, eventName: "Purchase" } })).toBe(1);

    // revisiting the thank-you page / asking again never hands out the browser event again
    const again = await api.post(`/api/v1/storefront/orders/${orderNumber}/purchase-event`).send({ phone: order.shippingPhone });
    expect(again.body.data.purchase).toBeNull();
    const stranger = await api.post(`/api/v1/storefront/orders/${orderNumber}/purchase-event`).send({ phone: "01999999999" });
    expect(stranger.status).toBe(404);
  });

  it("can exclude delivery from the value – on both sides at once", async () => {
    await setSetting("meta", { purchaseValue: "PRODUCT_VALUE" }, null);
    clearSettingsCache();
    const res = await checkout(checkoutBody({ deliveryOption: "INSIDE_DHAKA" }));
    expect(res.body.data.metaPurchase.data).toMatchObject({ value: 4540, product_value: 4540, delivery_charge: 70, order_total: 4610 });
    const order = await prisma.order.findUniqueOrThrow({ where: { orderNumber: res.body.data.orderNumber } });
    await waitFor(() => prisma.metaEventLog.findFirst({ where: { orderId: order.id, status: "SENT" } }));
    const ev = purchases().find((g) => g.body.data[0].event_id === order.metaPurchaseEventId)!.body.data[0];
    expect(ev.custom_data.value).toBe(4540);
  });
});

describe("delivery guarantees", () => {
  it("never marks an event delivered unless Meta confirms it, retries transient errors, and stays single", async () => {
    let reply = 0;
    const replies = [
      () => new Response(JSON.stringify({ error: { message: "Service temporarily unavailable", code: 2 } }), { status: 503 }),
      () => new Response(JSON.stringify({ events_received: 0, messages: [] }), { status: 200 }),
      () => new Response(JSON.stringify({ events_received: 1, fbtrace_id: "ok" }), { status: 200 }),
    ];
    graphReply = () => replies[Math.min(reply++, replies.length - 1)]();

    const res = await checkout(checkoutBody());
    const order = await prisma.order.findUniqueOrThrow({ where: { orderNumber: res.body.data.orderNumber } });
    const first = await waitFor(() => prisma.metaEventLog.findFirst({ where: { orderId: order.id, status: "FAILED" } }));
    expect(first.error).toMatch(/503/);
    expect(first.sentAt).toBeNull();

    // admin retry #1 → Meta answers 200 but received 0 events → still FAILED (not delivered)
    const r1 = await marketer.post(`/api/v1/marketing/meta/events/${first.id}/retry`);
    expect(r1.body.data.status).toBe("FAILED");
    expect((await prisma.metaEventLog.findUniqueOrThrow({ where: { id: first.id } })).error).toMatch(/0 events/);

    // retry #2 → delivered; same event id every time, one log row, three attempts
    const r2 = await marketer.post(`/api/v1/marketing/meta/events/${first.id}/retry`);
    expect(r2.body.data.status).toBe("SENT");
    const row = await prisma.metaEventLog.findUniqueOrThrow({ where: { id: first.id } });
    expect(row).toMatchObject({ status: "SENT", attempts: 3, eventsReceived: 1, fbtraceId: "ok" });
    expect(new Set(purchases().map((g) => g.body.data[0].event_id))).toEqual(new Set([order.metaPurchaseEventId]));

    // a further retry or re-trigger is a no-op
    const r3 = await marketer.post(`/api/v1/marketing/meta/events/${first.id}/retry`);
    expect(r3.body.data.status).toBe("DUPLICATE");
    await admin.post(`/api/v1/orders/${order.id}/status`, { status: "CONFIRMED" });
    await settle();
    expect(purchases()).toHaveLength(3);
    expect((await marketer.post(`/api/v1/marketing/meta/events/${first.id}/retry`)).status).toBe(200);
    expect((await api.post(`/api/v1/marketing/meta/events/${first.id}/retry`)).status).toBe(401);
  });

  it("treats a rejected token as a permanent failure", async () => {
    graphReply = () => new Response(JSON.stringify({ error: { message: "Invalid OAuth access token", code: 190 } }), { status: 400 });
    const res = await checkout(checkoutBody());
    const order = await prisma.order.findUniqueOrThrow({ where: { orderNumber: res.body.data.orderNumber } });
    const row = await waitFor(() => prisma.metaEventLog.findFirst({ where: { orderId: order.id, status: "FAILED" } }));
    expect(row.error).toMatch(/400.*Invalid OAuth access token.*190/);
    expect(row.sentAt).toBeNull();
  });

  it("records SKIPPED while not configured and sends once configuration is complete", async () => {
    await enableMeta(false);
    const res = await checkout(checkoutBody());
    expect(res.body.data.metaPurchase).not.toBeNull(); // the browser Pixel can still fire (it is configured separately)
    const order = await prisma.order.findUniqueOrThrow({ where: { orderNumber: res.body.data.orderNumber } });
    const row = await waitFor(() => prisma.metaEventLog.findFirst({ where: { orderId: order.id, status: "SKIPPED" } }));
    expect(graph).toHaveLength(0);
    await enableMeta(true);
    const r = await marketer.post(`/api/v1/marketing/meta/events/${row.id}/retry`);
    expect(r.body.data.status).toBe("SENT");
    expect(purchases()[0].body.data[0].event_id).toBe(order.metaPurchaseEventId);
  });
});

describe("online payment purchase", () => {
  async function onlineOrder() {
    const res = await checkout(checkoutBody({ paymentMethod: "SSLCOMMERZ" }));
    const order = await prisma.order.findUniqueOrThrow({ where: { orderNumber: res.body.data.orderNumber } });
    const init = await api.post("/api/v1/payments/online/init").send({ orderNumber: order.orderNumber, phone: order.shippingPhone, gateway: "sandbox" });
    return { res, order, tranId: init.body.data.transactionId as string };
  }

  it("fires only after the payment is verified – once on each side", async () => {
    const { res, order, tranId } = await onlineOrder();
    expect(res.body.data.metaPurchase).toBeNull(); // not a purchase yet
    await settle();
    expect(purchases()).toHaveLength(0);
    const early = await api.post(`/api/v1/storefront/orders/${order.orderNumber}/purchase-event`).send({ phone: order.shippingPhone });
    expect(early.body.data).toMatchObject({ purchase: null, reason: "Online payment not completed yet" });

    const done = await api.post("/api/v1/payments/sandbox/complete").send({ tranId, outcome: "success" });
    expect(done.body.data.redirectUrl).toContain("payment=success");
    await waitFor(() => prisma.metaEventLog.findFirst({ where: { orderId: order.id, status: "SENT" } }));

    // the returning browser claims its Purchase once; refreshing the confirmation page gets nothing
    const claim = await api.post(`/api/v1/storefront/orders/${order.orderNumber}/purchase-event`).send({ phone: order.shippingPhone });
    expect(claim.body.data.purchase).toMatchObject({ eventId: order.metaPurchaseEventId });
    const refresh = await api.post(`/api/v1/storefront/orders/${order.orderNumber}/purchase-event`).send({ phone: `+88${order.shippingPhone}` });
    expect(refresh.body.data.purchase).toBeNull();

    const ev = purchases()[0].body.data[0];
    expect(ev.event_id).toBe(claim.body.data.purchase.eventId);
    expect(ev.custom_data).toEqual(claim.body.data.purchase.data);
    expect(purchases()).toHaveLength(1);
  });

  it("sends nothing for a failed payment", async () => {
    const { order, tranId } = await onlineOrder();
    await api.post("/api/v1/payments/sandbox/complete").send({ tranId, outcome: "fail" });
    await settle();
    expect(purchases()).toHaveLength(0);
    expect(await prisma.metaEventLog.count({ where: { orderId: order.id } })).toBe(0);
  });

  it("counts an unpaid online order that staff confirm (customer switched to COD) – server side only", async () => {
    const { order } = await onlineOrder();
    await admin.post(`/api/v1/orders/${order.id}/status`, { status: "CONFIRMED" });
    await waitFor(() => prisma.metaEventLog.findFirst({ where: { orderId: order.id, status: "SENT" } }));
    expect(purchases()).toHaveLength(1);
    const claim = await api.post(`/api/v1/storefront/orders/${order.orderNumber}/purchase-event`).send({ phone: order.shippingPhone });
    expect(claim.body.data.purchase).toBeNull();
  });
});

describe("other events", () => {
  it("never sends Purchase for staff-created orders", async () => {
    const res = await makeOrder(admin, variantId, { channel: "WEBSITE" });
    await admin.post(`/api/v1/orders/${res.body.data.id}/status`, { status: "CONFIRMED" });
    await settle();
    expect(purchases()).toHaveLength(0);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: res.body.data.id } })).metaPurchaseEventId).toBeNull();
  });

  it("mirrors ViewContent / InitiateCheckout server side with the browser's event id and catalogue prices", async () => {
    const eventId = `vc.${unique()}.abc`;
    const body = { eventName: "ViewContent", eventId, eventSourceUrl: `${STORE}/products/demo`, items: [{ variantId, quantity: 1 }], fbp: "fb.1.1.2" };
    const r = await api.post("/api/v1/storefront/events").set("User-Agent", "UA-test").send({ ...body, value: 1, price: 1 });
    expect(r.status).toBe(202);
    expect(r.body.data.accepted).toBe(true);
    await api.post("/api/v1/storefront/events").send(body); // repeated beacon
    await settle();
    const vc = graph.filter((g) => g.body.data[0].event_name === "ViewContent");
    expect(vc).toHaveLength(1);
    expect(vc[0].body.data[0]).toMatchObject({ event_id: eventId, event_source_url: `${STORE}/products/demo` });
    expect(vc[0].body.data[0].custom_data).toMatchObject({ value: 2270, currency: "BDT", content_ids: [sku] });
    expect(vc[0].body.data[0].user_data).toEqual({ fbp: "fb.1.1.2", client_ip_address: expect.any(String), client_user_agent: "UA-test" });

    const foreign = await api.post("/api/v1/storefront/events").send({ ...body, eventId: `vc.${unique()}.x`, eventSourceUrl: "https://evil.example/p" });
    expect(foreign.body.data.accepted).toBe(false);
    await enableMeta(false);
    const off = await api.post("/api/v1/storefront/events").send({ ...body, eventId: `vc.${unique()}.y` });
    expect(off.body.data.accepted).toBe(false);
  });

  it("shows the tracking status on the order for marketing users only", async () => {
    const res = await checkout(checkoutBody());
    const order = await prisma.order.findUniqueOrThrow({ where: { orderNumber: res.body.data.orderNumber } });
    await waitFor(() => prisma.metaEventLog.findFirst({ where: { orderId: order.id, status: "SENT" } }));
    const asAdmin = await admin.get(`/api/v1/orders/${order.id}`);
    expect(asAdmin.body.data.metaTracking).toMatchObject({ eventId: order.metaPurchaseEventId, server: { status: "SENT", attempts: 1 } });
    expect(asAdmin.body.data.metaTracking.browserClaimedAt).toBeTruthy();
    const agent = await staff(["confirmation_agent"]);
    expect((await agent.get(`/api/v1/orders/${order.id}`)).body.data.metaTracking).toBeUndefined();
  });
});
