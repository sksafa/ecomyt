import { beforeAll, describe, expect, it } from "vitest";
import { api, staff, unique, type Client } from "./helpers.js";
import { dhakaArea, makeProduct, stockOf, testPhone } from "./fixtures.js";
import { prisma } from "../src/lib/prisma.js";
import { clearSettingsCache } from "../src/lib/settings.js";

let admin: Client;
let published: Awaited<ReturnType<typeof makeProduct>>;
let hidden: Awaited<ReturnType<typeof makeProduct>>;
let collectionSlug: string;

const COST_KEYS = /"(costPrice|unitCost|costTotal|productCostTotal|costComponents|computedCost|available|reserved|damaged|lowStockThreshold)"/;

beforeAll(async () => {
  admin = await staff(["admin"]);
  published = await makeProduct(admin, { price: "2270", cost: "1120", stock: [5, 0], name: `Nakshi Orna ${unique()}` });
  hidden = await makeProduct(admin, { price: "1990", cost: "900", stock: [5] });
  await prisma.product.update({ where: { id: hidden.id }, data: { isPublished: false } });
  const col = await admin.post("/api/v1/collections", { name: `Eid Edit ${unique()}`, isFeatured: true });
  collectionSlug = col.body.data.slug;
  await prisma.productCollection.createMany({
    data: [
      { productId: published.id, collectionId: col.body.data.id },
      { productId: hidden.id, collectionId: col.body.data.id },
    ],
  });
});

async function checkoutBody(variantId: string, extra: Record<string, unknown> = {}) {
  return {
    customer: { name: "Farzana Akter", phone: testPhone() },
    shipping: { addressLine: "House 7, Road 11, Banani, Dhaka" },
    items: [{ variantId, quantity: 1 }],
    deliveryOption: "INSIDE_DHAKA",
    paymentMethod: "COD",
    ...extra,
  };
}

describe("public catalogue", () => {
  it("lists only published products with public fields (no cost, no stock numbers)", async () => {
    const res = await api.get(`/api/v1/storefront/products?collection=${collectionSlug}`);
    expect(res.status).toBe(200);
    const ids = res.body.data.map((p: { id: string }) => p.id);
    expect(ids).toEqual([published.id]);
    expect(JSON.stringify(res.body)).not.toMatch(COST_KEYS);
    const p = res.body.data[0];
    expect(p.price).toBe("2270.00");
    expect(p.inStock).toBe(true);
    expect(p.variants.map((v: { inStock: boolean }) => v.inStock)).toEqual([true, false]);
    expect(p.variants[0].lowStock).toBe(true); // 5 ≤ default threshold 5

    const search = await api.get(`/api/v1/storefront/products?search=Nakshi`);
    expect(search.body.data.some((x: { id: string }) => x.id === published.id)).toBe(true);
    const sorted = await api.get(`/api/v1/storefront/products?sort=price_asc&pageSize=48`);
    const prices = sorted.body.data.map((x: { price: string }) => Number(x.price));
    expect([...prices].sort((a, b) => a - b)).toEqual(prices);
  });

  it("returns product detail by slug and 404 for unpublished products", async () => {
    const slug = (await prisma.product.findUniqueOrThrow({ where: { id: published.id } })).slug;
    const res = await api.get(`/api/v1/storefront/products/${slug}`);
    expect(res.status).toBe(200);
    expect(res.body.data.product.id).toBe(published.id);
    expect(Array.isArray(res.body.data.related)).toBe(true);
    expect(JSON.stringify(res.body)).not.toMatch(COST_KEYS);

    const hiddenSlug = (await prisma.product.findUniqueOrThrow({ where: { id: hidden.id } })).slug;
    expect((await api.get(`/api/v1/storefront/products/${hiddenSlug}`)).status).toBe(404);
  });

  it("serves collections, categories and home", async () => {
    const cols = await api.get("/api/v1/storefront/collections");
    const mine = cols.body.data.find((c: { slug: string }) => c.slug === collectionSlug);
    expect(mine.productCount).toBe(1);
    const col = await api.get(`/api/v1/storefront/collections/${collectionSlug}`);
    expect(col.body.data.products.map((p: { id: string }) => p.id)).toEqual([published.id]);
    expect((await api.get("/api/v1/storefront/collections/does-not-exist")).status).toBe(404);
    expect((await api.get("/api/v1/storefront/categories")).status).toBe(200);
    const home = await api.get("/api/v1/storefront/home");
    expect(home.status).toBe(200);
    expect(JSON.stringify(home.body)).not.toMatch(COST_KEYS);
  });

  it("resolves product_grid and order_form blocks on published pages", async () => {
    const slug = `landing-${unique()}`;
    await prisma.page.create({
      data: {
        slug, title: "Direct order", type: "LANDING", status: "PUBLISHED", publishedAt: new Date(),
        sections: [
          { type: "product_grid", title: "Eid picks", collectionSlug, limit: 8 },
          { type: "order_form", productId: published.id },
          { type: "order_form", productId: hidden.id },
        ],
      },
    });
    const res = await api.get(`/api/v1/storefront/pages/${slug}`);
    expect(res.status).toBe(200);
    const [grid, form, hiddenForm] = res.body.data.sections;
    expect(grid.products.map((p: { id: string }) => p.id)).toEqual([published.id]);
    expect(form.product.id).toBe(published.id);
    expect(form.product.variants).toHaveLength(2);
    expect(hiddenForm.product).toBeNull();
    expect(JSON.stringify(res.body)).not.toMatch(COST_KEYS);
  });
});

describe("checkout", () => {
  it("creates exactly one order per Idempotency-Key, ignores client prices and stores attribution", async () => {
    const variantId = published.variants[0].id;
    const key = `chk-${unique()}-${Date.now()}`;
    const body = await checkoutBody(variantId, {
      items: [{ variantId, quantity: 1, unitPrice: "1", discount: "2269" }],
      deliveryCharge: "0",
      total: "1",
      attribution: {
        firstSource: "facebook", firstMedium: "paid_social", firstCampaign: "eid_launch", firstLandingPage: "/lp/eid",
        lastSource: "facebook", lastMedium: "paid_social", lastCampaign: "eid_retarget", lastLandingPage: "/products/nakshi",
        referrer: "https://m.facebook.com/", fbclid: "IwAR123", fbc: "fb.1.1700000000.IwAR123", fbp: "fb.1.1700000000.98765",
        lastTouchAt: new Date().toISOString(),
      },
      clientEventId: "evt-123",
    });
    const before = (await stockOf(variantId)).reserved;

    const [a, b] = await Promise.all([
      api.post("/api/v1/storefront/checkout").set("Idempotency-Key", key).send(body),
      api.post("/api/v1/storefront/checkout").set("Idempotency-Key", key).send(body),
    ]);
    const c = await api.post("/api/v1/storefront/checkout").set("Idempotency-Key", key).send(body);
    for (const r of [a, b, c]) expect(r.status).toBe(201);
    expect(new Set([a, b, c].map((r) => r.body.data.orderNumber)).size).toBe(1);
    expect(await prisma.order.count({ where: { idempotencyKey: `store:${key}` } })).toBe(1);
    expect((await stockOf(variantId)).reserved).toBe(before + 1);

    const order = await prisma.order.findUniqueOrThrow({ where: { orderNumber: a.body.data.orderNumber }, include: { items: true, attribution: true } });
    expect(order.channel).toBe("WEBSITE");
    expect(order.items[0].unitPrice.toFixed(2)).toBe("2270.00");
    expect(order.items[0].discount.toFixed(2)).toBe("0.00");
    expect(order.subtotal.toFixed(2)).toBe("2270.00");
    expect(order.deliveryCharge.greaterThan(0)).toBe(true);
    expect(a.body.data.total).toBe(order.total.toFixed(2));
    expect(a.body.data.deliveryCharge).toBe(order.deliveryCharge.toFixed(2));
    expect(a.body.data.paymentMethod).toBe("COD");
    expect(a.body.data.metaEventId).toBe(`purchase:${order.id}`);
    expect(order.attribution?.lastCampaign).toBe("eid_retarget");
    expect(order.attribution?.firstLandingPage).toBe("/lp/eid");
    expect(order.attribution?.fbclid).toBe("IwAR123");
    expect(order.attribution?.fbp).toBe("fb.1.1700000000.98765");

    // the same key from a different customer never reveals the first order
    const other = await api.post("/api/v1/storefront/checkout").set("Idempotency-Key", key).send(await checkoutBody(variantId));
    expect(other.status).toBe(409);
  });

  it("requires an Idempotency-Key and rejects the honeypot", async () => {
    const variantId = published.variants[0].id;
    const count = await prisma.order.count();
    const noKey = await api.post("/api/v1/storefront/checkout").send(await checkoutBody(variantId));
    expect(noKey.status).toBe(400);
    const bot = await api.post("/api/v1/storefront/checkout").set("Idempotency-Key", `bot-${unique()}-x`).send(await checkoutBody(variantId, { website: "http://spam.example" }));
    expect(bot.status).toBe(400);
    expect(await prisma.order.count()).toBe(count);
  });

  it("rejects unpublished products, too many lines and excessive quantities", async () => {
    const res = await api.post("/api/v1/storefront/checkout").set("Idempotency-Key", `hid-${unique()}-x`).send(await checkoutBody(hidden.variants[0].id));
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("ITEM_UNAVAILABLE");
    const qty = await api.post("/api/v1/storefront/checkout").set("Idempotency-Key", `qty-${unique()}-x`).send(await checkoutBody(published.variants[0].id, { items: [{ variantId: published.variants[0].id, quantity: 11 }] }));
    expect(qty.status).toBe(422);
    const lines = Array.from({ length: 21 }, () => ({ variantId: published.variants[0].id, quantity: 1 }));
    const many = await api.post("/api/v1/storefront/checkout").set("Idempotency-Key", `many-${unique()}-x`).send(await checkoutBody(published.variants[0].id, { items: lines }));
    expect(many.status).toBe(422);
  });
});

describe("order lookup", () => {
  it("requires the matching phone (any BD format) and returns 404 otherwise", async () => {
    const body = await checkoutBody(published.variants[0].id);
    const placed = await api.post("/api/v1/storefront/checkout").set("Idempotency-Key", `look-${unique()}-x`).send(body);
    expect(placed.status).toBe(201);
    const { orderNumber } = placed.body.data;
    const local = body.customer.phone; // 017XXXXXXXX

    const ok = await api.get(`/api/v1/storefront/orders/${orderNumber}`).query({ phone: `+88${local.slice(0, 5)} ${local.slice(5)}` });
    expect(ok.status).toBe(200);
    expect(ok.body.data.orderNumber).toBe(orderNumber);
    expect(ok.body.data.items[0].unitPrice).toBe("2270.00");
    expect(ok.body.data.payment).toEqual({ method: "COD", status: "UNPAID" });
    expect(ok.body.data.shipment).toBeNull();
    expect(ok.body.data.statusLabel.bn).toBeTruthy();
    expect(JSON.stringify(ok.body)).not.toMatch(COST_KEYS);

    const wrong = await api.get(`/api/v1/storefront/orders/${orderNumber}`).query({ phone: testPhone() });
    expect(wrong.status).toBe(404);
    const garbage = await api.get(`/api/v1/storefront/orders/${orderNumber}`).query({ phone: "abc" });
    expect(garbage.status).toBe(404);
    const unknown = await api.get(`/api/v1/storefront/orders/BB999999999`).query({ phone: local });
    expect(unknown.status).toBe(404);
    expect(wrong.body.error.message).toBe(unknown.body.error.message);
  });
});

describe("checkout delivery options", () => {
  const checkout = (body: object) => api.post("/api/v1/storefront/checkout").set("Idempotency-Key", `dlv-${unique()}-xx`).send(body);

  it("requires a valid option and prices it from the stored settings (never from the client)", async () => {
    const options = await api.get("/api/v1/storefront/delivery-options");
    expect(options.status).toBe(200);
    expect(options.body.data).toEqual([
      expect.objectContaining({ code: "INSIDE_DHAKA", charge: "70.00", isDefault: false }),
      expect.objectContaining({ code: "OUTSIDE_DHAKA", charge: "120.00", isDefault: true }),
    ]);

    const variantId = published.variants[0].id;
    const missing = await checkout({ ...(await checkoutBody(variantId)), deliveryOption: undefined });
    expect(missing.status).toBe(422);
    const bogus = await checkout(await checkoutBody(variantId, { deliveryOption: "MARS" }));
    expect(bogus.status).toBe(422);

    // a tampered client-side delivery charge is ignored
    const inside = await checkout(await checkoutBody(variantId, { deliveryOption: "INSIDE_DHAKA", deliveryCharge: "0" }));
    expect(inside.status).toBe(201);
    expect(inside.body.data.deliveryCharge).toBe("70.00");
    expect(inside.body.data.total).toBe((Number(inside.body.data.subtotal) + 70).toFixed(2));
    const o1 = await prisma.order.findUniqueOrThrow({ where: { orderNumber: inside.body.data.orderNumber }, include: { zone: true } });
    expect(o1.deliveryOption).toBe("INSIDE_DHAKA");
    expect(o1.deliveryCharge.toFixed(2)).toBe("70.00");
    expect(o1.zone?.code).toBe("INSIDE_DHAKA");

    const outside = await checkout(await checkoutBody(variantId, { deliveryOption: "OUTSIDE_DHAKA" }));
    expect(outside.body.data.deliveryCharge).toBe("120.00");
    expect(outside.body.data.total).toBe((Number(outside.body.data.subtotal) + 120).toFixed(2));
    const o2 = await prisma.order.findUniqueOrThrow({ where: { orderNumber: outside.body.data.orderNumber } });
    expect(o2.deliveryOption).toBe("OUTSIDE_DHAKA");

    const lookup = await api.get(`/api/v1/storefront/orders/${o2.orderNumber}?phone=${o2.shippingPhone}`);
    expect(lookup.body.data.totals.deliveryOption).toBe("OUTSIDE_DHAKA");
  });

  it("uses the charges an admin saves, persisted in the database", async () => {
    const admin = await staff(["admin"]);
    const agent = await staff(["confirmation_agent"]);
    expect((await agent.put("/api/v1/settings/checkout", { insideDhakaCharge: "1" })).status).toBe(403);
    expect((await admin.put("/api/v1/settings/checkout", { insideDhakaCharge: "-5" })).status).toBe(422);
    expect((await admin.put("/api/v1/settings/checkout", { insideDhakaCharge: "abc" })).status).toBe(422);

    try {
      const saved = await admin.put("/api/v1/settings/checkout", { insideDhakaCharge: "80", outsideDhakaCharge: "150.50" });
      expect(saved.status).toBe(200);
      const row = await prisma.setting.findUniqueOrThrow({ where: { key: "checkout" } });
      expect(row.value).toMatchObject({ insideDhakaCharge: "80", outsideDhakaCharge: "150.50" });

      clearSettingsCache(); // as after a restart: values come from the database
      const options = await api.get("/api/v1/storefront/delivery-options");
      expect(options.body.data.map((o: { charge: string }) => o.charge)).toEqual(["80.00", "150.50"]);

      const res = await checkout(await checkoutBody(published.variants[0].id, { deliveryOption: "OUTSIDE_DHAKA" }));
      expect(res.body.data.deliveryCharge).toBe("150.50");
      expect(res.body.data.total).toBe((Number(res.body.data.subtotal) + 150.5).toFixed(2));
    } finally {
      await admin.put("/api/v1/settings/checkout", { insideDhakaCharge: "70.00", outsideDhakaCharge: "120.00" });
    }
  });
});
