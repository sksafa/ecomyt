import { beforeAll, describe, expect, it } from "vitest";
import { staff, type Client } from "./helpers.js";
import { dhakaArea, makeOrder, makeProduct, stockOf, testPhone } from "./fixtures.js";
import { prisma } from "../src/lib/prisma.js";
import { recognizeDelivery } from "../src/modules/finance/ledger.service.js";

let admin: Client;
let agent: Client;

beforeAll(async () => {
  admin = await staff(["admin"]);
  agent = await staff(["confirmation_agent"]);
});

describe("order creation", () => {
  it("creates an order, matches the customer by phone, snapshots cost and reserves stock", async () => {
    const product = await makeProduct(admin, { price: "2270", cost: "1120", stock: [5] });
    const v = product.variants[0];
    const area = await dhakaArea("Gulshan");
    const phone = testPhone();
    const res = await admin.post("/api/v1/orders", {
      customer: { name: "Safawat", phone: `+88${phone}` },
      shipping: { addressLine: "House 12, Road 5, Gulshan 2", areaId: area.id },
      items: [{ variantId: v.id, quantity: 2 }],
      channel: "FACEBOOK",
    });
    expect(res.status).toBe(201);

    const order = await prisma.order.findUniqueOrThrow({ where: { id: res.body.data.id }, include: { items: true, customer: true } });
    expect(order.customer.phone).toBe(phone); // +880 normalised
    expect(order.subtotal.toFixed(2)).toBe("4540.00");
    expect(order.deliveryCharge.toFixed(2)).toBe("70.00"); // INSIDE_DHAKA, 600g < 1kg
    expect(order.total.toFixed(2)).toBe("4610.00");
    expect(order.codAmount.toFixed(2)).toBe("4610.00");
    expect(order.productCostTotal.toFixed(2)).toBe("2240.00");
    expect(order.items[0].unitCost.toFixed(2)).toBe("1120.00");
    expect(order.stockReserved).toBe(true);

    const level = await stockOf(v.id);
    expect(level.available).toBe(3);
    expect(level.reserved).toBe(2);

    // later cost change does not rewrite the snapshot
    await prisma.product.update({ where: { id: product.id }, data: { costPrice: 9999 } });
    const again = await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.id } });
    expect(again.unitCost.toFixed(2)).toBe("1120.00");
  });

  it("rejects orders beyond available stock without persisting anything", async () => {
    const product = await makeProduct(admin, { stock: [1] });
    const before = await prisma.order.count();
    const res = await makeOrder(admin, product.variants[0].id, {}, 2);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("INSUFFICIENT_STOCK");
    expect(await prisma.order.count()).toBe(before);
    expect((await stockOf(product.variants[0].id)).available).toBe(1);
  });

  it("never oversells under concurrent orders", async () => {
    const product = await makeProduct(admin, { stock: [5] });
    const v = product.variants[0].id;
    const results = await Promise.all(Array.from({ length: 12 }, () => makeOrder(admin, v)));
    const ok = results.filter((r) => r.status === 201).length;
    const rejected = results.filter((r) => r.status === 409).length;
    expect(ok).toBe(5);
    expect(rejected).toBe(7);
    const level = await stockOf(v);
    expect(level.available).toBe(0);
    expect(level.reserved).toBe(5);
  });

  it("is idempotent with an Idempotency-Key header", async () => {
    const product = await makeProduct(admin, { stock: [10] });
    const area = await dhakaArea();
    const body = { customer: { name: "Idem Potent", phone: testPhone() }, shipping: { addressLine: "Road 1, Banani, Dhaka", areaId: area.id }, items: [{ variantId: product.variants[0].id, quantity: 1 }] };
    const key = `idem-${Date.now()}`;
    const [a, b] = await Promise.all([
      admin.post("/api/v1/orders", body).set("Idempotency-Key", key),
      admin.post("/api/v1/orders", body).set("Idempotency-Key", key),
    ]);
    const c = await admin.post("/api/v1/orders", body).set("Idempotency-Key", key);
    const ids = new Set([a, b, c].filter((r) => r.status === 201).map((r) => r.body.data.id));
    expect(ids.size).toBe(1);
    expect((await stockOf(product.variants[0].id)).reserved).toBe(1);
    const reused = await admin.post("/api/v1/orders", { ...body, items: [{ variantId: product.variants[0].id, quantity: 2 }] }).set("Idempotency-Key", key);
    expect(reused.status).toBe(409);
  });

  it("flags a possible duplicate and routes it to confirmation", async () => {
    const product = await makeProduct(admin, { stock: [10] });
    const area = await dhakaArea();
    const phone = testPhone();
    const body = { customer: { name: "Repeat Caller", phone }, shipping: { addressLine: "Mirpur 10, Block C, Road 4", areaId: area.id }, items: [{ variantId: product.variants[0].id, quantity: 1 }] };
    const first = await admin.post("/api/v1/orders", body);
    const second = await admin.post("/api/v1/orders", body);
    expect(first.body.data.status).toBe("PENDING");
    expect(second.body.data.status).toBe("CONFIRMATION_REQUIRED");
    const detail = await admin.get(`/api/v1/orders/${second.body.data.id}`);
    expect(detail.body.data.risk.flags.map((f: { code: string }) => f.code)).toContain("POSSIBLE_DUPLICATE");
    expect(detail.body.data.risk.flags[0].bn).toBeTruthy();
  });

  it("requires permission to override prices or the delivery charge", async () => {
    const product = await makeProduct(admin, { stock: [10] });
    const v = product.variants[0].id;
    const role = await admin.post("/api/v1/roles", { key: `creator_${Date.now()}`, name: "Creator", permissions: ["orders.view", "orders.create"] });
    // admins cannot manage roles – create via super admin
    const sa = await staff(["super_admin"]);
    const r = role.status === 201 ? role : await sa.post("/api/v1/roles", { key: `creator_${Date.now()}`, name: "Creator", permissions: ["orders.view", "orders.create"] });
    const creator = await staff([r.body.data.key]);
    expect((await makeOrder(creator, v, { items: [{ variantId: v, quantity: 1, unitPrice: "100" }] })).status).toBe(403);
    expect((await makeOrder(creator, v, { deliveryCharge: "0" })).status).toBe(403);
    expect((await makeOrder(creator, v)).status).toBe(201);
    const ok = await makeOrder(admin, v, { items: [{ variantId: v, quantity: 1, unitPrice: "2000" }], deliveryCharge: "0" });
    expect(ok.status).toBe(201);
    const o = await prisma.order.findUniqueOrThrow({ where: { id: ok.body.data.id } });
    expect(o.total.toFixed(2)).toBe("2000.00");
  });

  it("validates phone numbers", async () => {
    const product = await makeProduct(admin);
    const res = await makeOrder(admin, product.variants[0].id, { customer: { name: "Bad Phone", phone: "02123456789" } });
    expect(res.status).toBe(400);
  });
});

describe("order lifecycle", () => {
  it("walks the happy path and recognises revenue only on delivery", async () => {
    const product = await makeProduct(admin, { price: "2270", cost: "1120", stock: [3] });
    const v = product.variants[0].id;
    const created = await makeOrder(admin, v);
    const id = created.body.data.id;
    const move = (status: string, client: Client = admin, reason?: string) => client.post(`/api/v1/orders/${id}/status`, { status, reason });

    expect((await move("DELIVERED")).body.error.code).toBe("INVALID_TRANSITION");
    expect((await move("CONFIRMED", agent)).status).toBe(200);
    expect((await move("PROCESSING", agent)).status).toBe(403); // agent lacks orders.status
    expect((await move("PROCESSING")).status).toBe(200);
    expect((await move("READY_TO_SHIP")).status).toBe(200);
    expect((await move("COURIER_BOOKED")).body.error.code).toBe("WORKFLOW_REQUIRED");
    expect(await prisma.financialEntry.count({ where: { orderId: id } })).toBe(0);

    expect((await move("SHIPPED")).status).toBe(200);
    let level = await stockOf(v);
    expect(level.reserved).toBe(0);
    expect(level.available).toBe(2);

    expect((await move("DELIVERED")).status).toBe(200);
    const order = await prisma.order.findUniqueOrThrow({ where: { id } });
    expect(order.paymentStatus).toBe("PAID");
    expect(order.paidAmount.toFixed(2)).toBe(order.total.toFixed(2));
    const entries = await prisma.financialEntry.findMany({ where: { orderId: id } });
    const byType = Object.fromEntries(entries.map((e) => [e.type, e.amount.toFixed(2)]));
    expect(byType.SALES_REVENUE).toBe("2270.00");
    expect(byType.SHIPPING_REVENUE).toBe("70.00");
    expect(byType.COGS).toBe("-1120.00");
    expect(byType.PACKAGING_COST).toBe("-20.00");

    // replaying the recognition (e.g. a duplicate webhook) never double-posts
    await prisma.$transaction((tx) => recognizeDelivery(tx, order, new Date()));
    expect(await prisma.financialEntry.count({ where: { orderId: id } })).toBe(entries.length);
    expect(await prisma.payment.count({ where: { orderId: id } })).toBe(1);

    const customer = await prisma.customer.findUniqueOrThrow({ where: { id: order.customerId } });
    expect(customer.deliveredOrders).toBe(1);
    expect(customer.lifetimeValue.toFixed(2)).toBe(order.total.toFixed(2));

    const history = await prisma.orderStatusHistory.findMany({ where: { orderId: id }, orderBy: { createdAt: "asc" } });
    expect(history.map((h) => h.toStatus)).toEqual(["PENDING", "CONFIRMED", "PROCESSING", "READY_TO_SHIP", "SHIPPED", "DELIVERED"]);

    const detail = await admin.get(`/api/v1/orders/${id}`);
    expect(detail.body.data.profit.basis).toBe("DELIVERED");
    expect(detail.body.data.profit.grossMargin.amount).toBe("1150.00");
    expect(detail.body.data.profit.courierFee.estimated).toBe(true);
  });

  it("requires a reason to cancel and releases reserved stock", async () => {
    const product = await makeProduct(admin, { stock: [4] });
    const v = product.variants[0].id;
    const created = await makeOrder(admin, v, {}, 3);
    expect((await stockOf(v)).available).toBe(1);
    const id = created.body.data.id;
    expect((await admin.post(`/api/v1/orders/${id}/status`, { status: "CANCELLED" })).status).toBe(400);
    expect((await admin.post(`/api/v1/orders/${id}/status`, { status: "CANCELLED", reason: "Customer changed mind" })).status).toBe(200);
    const level = await stockOf(v);
    expect(level.available).toBe(4);
    expect(level.reserved).toBe(0);
    expect((await admin.post(`/api/v1/orders/${id}/status`, { status: "CONFIRMED" })).body.error.code).toBe("INVALID_TRANSITION");
    const movements = await prisma.inventoryMovement.findMany({ where: { orderId: id }, orderBy: { createdAt: "asc" } });
    expect(movements.map((m) => m.type)).toEqual(["RESERVE", "RELEASE"]);
  });

  it("handles return-to-origin: stock comes back into inspection, no revenue booked", async () => {
    const product = await makeProduct(admin, { stock: [2] });
    const v = product.variants[0].id;
    const id = (await makeOrder(admin, v)).body.data.id;
    for (const s of ["CONFIRMED", "READY_TO_SHIP", "SHIPPED", "RETURNED"]) {
      expect((await admin.post(`/api/v1/orders/${id}/status`, { status: s })).status).toBe(200);
    }
    const level = await stockOf(v);
    expect(level.available).toBe(1);
    expect(level.returned).toBe(1);
    const ret = await prisma.returnRequest.findFirstOrThrow({ where: { orderId: id } });
    expect(ret.isRto).toBe(true);
    expect(ret.status).toBe("RECEIVED");
    const entries = await prisma.financialEntry.findMany({ where: { orderId: id } });
    expect(entries.map((e) => e.type)).toEqual(["PACKAGING_COST"]);
    const customer = await prisma.order.findUniqueOrThrow({ where: { id }, include: { customer: true } });
    expect(customer.customer.returnedOrders).toBe(1);
  });

  it("edits items before shipping, re-reserving stock, and locks edits after", async () => {
    const product = await makeProduct(admin, { stock: [5, 5] });
    const [a, b] = product.variants;
    const id = (await makeOrder(admin, a.id, {}, 2)).body.data.id;
    const edit = await admin.patch(`/api/v1/orders/${id}`, { items: [{ variantId: b.id, quantity: 3 }], reason: "Customer wants another colour" });
    expect(edit.status).toBe(200);
    expect((await stockOf(a.id)).available).toBe(5);
    expect((await stockOf(b.id)).reserved).toBe(3);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: id, action: "order.updated" } });
    expect(audit.reason).toBe("Customer wants another colour");

    for (const s of ["CONFIRMED", "READY_TO_SHIP", "SHIPPED"]) await admin.post(`/api/v1/orders/${id}/status`, { status: s });
    const locked = await admin.patch(`/api/v1/orders/${id}`, { discount: "100" });
    expect(locked.body.error.code).toBe("ORDER_LOCKED");
  });

  it("reports per-order results for bulk status changes", async () => {
    const product = await makeProduct(admin, { stock: [5] });
    const o1 = (await makeOrder(admin, product.variants[0].id)).body.data.id;
    const o2 = (await makeOrder(admin, product.variants[0].id)).body.data.id;
    await admin.post(`/api/v1/orders/${o2}/status`, { status: "CANCELLED", reason: "test" });
    const res = await admin.post("/api/v1/orders/bulk/status", { ids: [o1, o2], status: "CONFIRMED" });
    expect(res.body.data.succeeded).toBe(1);
    expect(res.body.data.failed).toBe(1);
  });
});

describe("order queries & visibility", () => {
  it("searches by phone in any format and returns status counts", async () => {
    const product = await makeProduct(admin);
    const phone = testPhone();
    const area = await dhakaArea();
    const created = await admin.post("/api/v1/orders", {
      customer: { name: "Searchable Person", phone },
      shipping: { addressLine: "Dhanmondi 27, House 3", areaId: area.id },
      items: [{ variantId: product.variants[0].id, quantity: 1 }],
    });
    const viaIntl = await admin.get(`/api/v1/orders?q=${encodeURIComponent(`+88 ${phone}`)}`);
    expect(viaIntl.body.data.map((o: { id: string }) => o.id)).toContain(created.body.data.id);
    const byNumber = await admin.get(`/api/v1/orders?q=${created.body.data.orderNumber}`);
    expect(byNumber.body.data[0].id).toBe(created.body.data.id);
    expect(byNumber.body.meta.statusCounts.ALL).toBeGreaterThanOrEqual(1);
  });

  it("hides cost and margin from users without finance.view", async () => {
    const product = await makeProduct(admin);
    const id = (await makeOrder(admin, product.variants[0].id)).body.data.id;
    const asAgent = await agent.get(`/api/v1/orders/${id}`);
    expect(asAgent.body.data.amounts.productMargin).toBeUndefined();
    expect(asAgent.body.data.items[0].unitCost).toBeUndefined();
    expect(asAgent.body.data.profit).toBeUndefined();
    const asAdmin = await admin.get(`/api/v1/orders/${id}`);
    expect(asAdmin.body.data.amounts.productMargin).toBe("1150.00");
  });

  it("exports CSV only with orders.export and neutralises formula injection", async () => {
    const product = await makeProduct(admin);
    const area = await dhakaArea();
    const created = await admin.post("/api/v1/orders", {
      customer: { name: "=HYPERLINK(\"http://evil\")", phone: testPhone() },
      shipping: { addressLine: "Banani Road 11, House 4", areaId: area.id },
      items: [{ variantId: product.variants[0].id, quantity: 1 }],
    });
    expect((await agent.get("/api/v1/orders/export")).status).toBe(403);
    const csv = await admin.get(`/api/v1/orders/export?format=csv&ids=${created.body.data.id}`);
    expect(csv.status).toBe(200);
    expect(csv.text).toContain("'=HYPERLINK");
    expect(await prisma.auditLog.count({ where: { action: "order.exported" } })).toBeGreaterThan(0);
  });
});

describe("customers", () => {
  it("anonymises a customer with orders instead of deleting history", async () => {
    const product = await makeProduct(admin);
    const id = (await makeOrder(admin, product.variants[0].id)).body.data.id;
    const order = await prisma.order.findUniqueOrThrow({ where: { id } });
    const res = await admin.delete(`/api/v1/customers/${order.customerId}`).send({ reason: "Customer requested erasure" });
    expect(res.body.data.result).toBe("anonymized");
    const after = await prisma.order.findUniqueOrThrow({ where: { id } });
    expect(after.shippingAddress).toBe("[erased]");
    expect(after.total.toFixed(2)).toBe(order.total.toFixed(2));
  });

  it("lists segments and finds customers by phone", async () => {
    const segs = await admin.get("/api/v1/customers/segments");
    expect(segs.body.data.map((s: { key: string }) => s.key)).toContain("repeat");
    const product = await makeProduct(admin);
    const phone = testPhone();
    const area = await dhakaArea();
    await admin.post("/api/v1/orders", { customer: { name: "Phone Lookup", phone }, shipping: { addressLine: "Uttara Sector 7, Road 3", areaId: area.id }, items: [{ variantId: product.variants[0].id, quantity: 1 }] });
    const found = await admin.get(`/api/v1/customers/by-phone/${encodeURIComponent("+880" + phone.slice(1))}`);
    expect(found.body.data.name).toBe("Phone Lookup");
  });
});
