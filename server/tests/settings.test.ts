import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { staff, type Client } from "./helpers.js";
import { makeOrder, makeProduct } from "./fixtures.js";
import { prisma } from "../src/lib/prisma.js";
import { clearSettingsCache } from "../src/lib/settings.js";

let admin: Client;
let analyst: Client; // no settings.* ; orders/customers/products/shipments view
let marketer: Client; // orders.view + products.view only (no customers/shipments)
let support: Client;
const snapshot = new Map<string, unknown>();

beforeAll(async () => {
  admin = await staff(["admin"]);
  analyst = await staff(["analyst"]);
  marketer = await staff(["marketing_manager"]);
  support = await staff(["customer_support"]);
  for (const key of ["orders", "meta", "statusLabels"]) snapshot.set(key, (await prisma.setting.findUnique({ where: { key } }))?.value ?? null);
});

afterAll(async () => {
  // test files share one database – restore the groups changed here
  for (const [key, value] of snapshot) {
    if (value === null) await prisma.setting.deleteMany({ where: { key } });
    else await prisma.setting.update({ where: { key }, data: { value: value as object } });
  }
  clearSettingsCache();
});

describe("settings", () => {
  it("returns every group with defaults merged and enforces permissions", async () => {
    expect((await analyst.get("/api/v1/settings")).status).toBe(403);
    const res = await admin.get("/api/v1/settings");
    expect(res.status).toBe(200);
    expect(Object.keys(res.body.data).sort()).toEqual(["cms", "finance", "inventory", "meta", "notifications", "orders", "statusLabels", "store"]);
    expect(res.body.data.store.currency).toBe("BDT");
    expect(res.body.data.meta).toEqual(expect.objectContaining({ capiEnabled: expect.any(Boolean) }));
    expect((await analyst.put("/api/v1/settings/orders", { duplicateWindowHours: 12 })).status).toBe(403);
  });

  it("validates per group and audits before/after", async () => {
    const bad = await admin.put("/api/v1/settings/orders", { confirmationRiskThreshold: 500 });
    expect(bad.status).toBe(422);
    const unknownKey = await admin.put("/api/v1/settings/orders", { somethingElse: true });
    expect(unknownKey.status).toBe(422);
    const negative = await admin.put("/api/v1/settings/orders", { defaultPackagingCost: "-5" });
    expect(negative.status).toBe(422);
    // CAPI tokens are not settings – only pixelId + capiEnabled are accepted for meta
    const token = await admin.put("/api/v1/settings/meta", { pixelId: "123456789012345", accessToken: "EAAB..." });
    expect(token.status).toBe(422);
    expect((await admin.put("/api/v1/settings/nope", {})).status).toBe(422);

    const ok = await admin.put("/api/v1/settings/orders", { confirmationRiskThreshold: 55, defaultPackagingCost: "25.50" });
    expect(ok.status).toBe(200);
    expect(ok.body.data.confirmationRiskThreshold).toBe(55);
    expect(ok.body.data.duplicateWindowHours).toBe(24); // untouched keys keep their value

    const meta = await admin.put("/api/v1/settings/meta", { pixelId: "123456789012345", capiEnabled: true });
    expect(meta.body.data).toEqual({ pixelId: "123456789012345", capiEnabled: true });

    const labels = await admin.put("/api/v1/settings/statusLabels", { PENDING: { bn: "অপেক্ষমাণ" } });
    expect(labels.status).toBe(200);
    expect((await admin.put("/api/v1/settings/statusLabels", { NOT_A_STATUS: { en: "x" } })).status).toBe(422);

    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: "settings.updated", entityId: "orders", userId: admin.user.id }, orderBy: { createdAt: "desc" } });
    expect((log.after as { confirmationRiskThreshold: number }).confirmationRiskThreshold).toBe(55);
    expect((log.before as { confirmationRiskThreshold: number }).confirmationRiskThreshold).not.toBe(55);
  });
});

describe("global search", () => {
  it("finds orders by phone in any format and scopes groups by permission", async () => {
    const product = await makeProduct(admin, { stock: [5], name: "Searchable Jamdani Orna" });
    const res = await makeOrder(admin, product.variants[0].id);
    expect(res.status).toBe(201);
    const order = await prisma.order.findUniqueOrThrow({ where: { id: res.body.data.id } });
    const phone = order.shippingPhone; // 017XXXXXXXX
    const intl = `+880 ${phone.slice(1, 5)}-${phone.slice(5)}`;

    const full = await admin.get(`/api/v1/search?q=${encodeURIComponent(intl)}`);
    expect(full.status).toBe(200);
    expect(Object.keys(full.body.data).sort()).toEqual(["customers", "orders", "products", "shipments"]);
    expect(full.body.data.orders.map((o: { id: string }) => o.id)).toContain(order.id);
    expect(full.body.data.customers.map((c: { phone: string }) => c.phone)).toContain(phone);

    const partial = await admin.get(`/api/v1/search?q=${phone.slice(-6)}`);
    expect(partial.body.data.orders.map((o: { id: string }) => o.id)).toContain(order.id);

    const byNumber = await support.get(`/api/v1/search?q=${order.orderNumber.toLowerCase()}`);
    expect(byNumber.body.data.orders[0].orderNumber).toBe(order.orderNumber);
    expect(byNumber.body.data.products).toBeDefined(); // support has products.view

    // marketing: no customers.view / shipments.view → those groups are absent
    const scoped = await marketer.get(`/api/v1/search?q=${encodeURIComponent(intl)}`);
    expect(Object.keys(scoped.body.data).sort()).toEqual(["orders", "products"]);

    const products = await analyst.get("/api/v1/search?q=jamdani");
    expect(products.body.data.products.some((p: { id: string }) => p.id === product.id)).toBe(true);
    expect(JSON.stringify(products.body.data.products)).not.toMatch(/costPrice/);

    expect((await admin.get("/api/v1/search?q=a")).status).toBe(422);
    expect(full.body.data.orders.length).toBeLessThanOrEqual(8);
  });
});

describe("saved filters", () => {
  it("lists own + shared filters and only lets the owner delete", async () => {
    const mine = await marketer.post("/api/v1/saved-filters", { name: "Pending Dhaka", module: "orders", filters: { status: ["PENDING"], district: "Dhaka" } });
    const shared = await marketer.post("/api/v1/saved-filters", { name: "Team: COD due", module: "orders", filters: { paymentStatus: "UNPAID" }, isShared: true });
    expect(mine.status).toBe(201);
    expect(shared.status).toBe(201);
    expect((await marketer.post("/api/v1/saved-filters", { name: "x", module: "Bad Module!", filters: {} })).status).toBe(422);

    const own = await marketer.get("/api/v1/saved-filters?module=orders");
    const ownIds = own.body.data.map((f: { id: string }) => f.id);
    expect(ownIds).toEqual(expect.arrayContaining([mine.body.data.id, shared.body.data.id]));

    const other = await support.get("/api/v1/saved-filters?module=orders");
    const otherIds = other.body.data.map((f: { id: string }) => f.id);
    expect(otherIds).toContain(shared.body.data.id);
    expect(otherIds).not.toContain(mine.body.data.id);
    expect(other.body.data.find((f: { id: string }) => f.id === shared.body.data.id).isOwner).toBe(false);

    expect((await support.delete(`/api/v1/saved-filters/${shared.body.data.id}`)).status).toBe(403);
    expect((await support.delete(`/api/v1/saved-filters/${mine.body.data.id}`)).status).toBe(404);
    expect((await marketer.delete(`/api/v1/saved-filters/${mine.body.data.id}`)).status).toBe(200);
    expect((await marketer.get("/api/v1/saved-filters?module=customers")).body.data).toEqual([]);
  });
});
