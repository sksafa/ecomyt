import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { api, staff, type Client } from "./helpers.js";
import { makeOrder, makeProduct, stockOf } from "./fixtures.js";
import { prisma } from "../src/lib/prisma.js";
import { retryBookingJob } from "../src/modules/couriers/shipments.service.js";

let admin: Client;
let mockId: string;

const setFailMode = (failMode: string) => admin.put(`/api/v1/couriers/providers/${mockId}`, { config: { failMode } });

async function readyOrder(stock = 5, qty = 1) {
  const product = await makeProduct(admin, { stock: [stock] });
  const v = product.variants[0].id;
  const id = (await makeOrder(admin, v, {}, qty)).body.data.id as string;
  await admin.post(`/api/v1/orders/${id}/status`, { status: "CONFIRMED" });
  return { id, variantId: v };
}

const simulate = (shipmentId: string, status: string, extra: Record<string, unknown> = {}) =>
  admin.post("/api/v1/couriers/mock/simulate", { shipmentId, status, ...extra });

beforeAll(async () => {
  admin = await staff(["admin"]);
  mockId = (await prisma.courierProvider.findUniqueOrThrow({ where: { code: "MOCK" } })).id;
});
afterEach(async () => {
  await setFailMode("none");
});

describe("courier booking", () => {
  it("books a shipment and moves the order to COURIER_BOOKED", async () => {
    const { id } = await readyOrder();
    const res = await admin.post("/api/v1/couriers/shipments", { orderId: id });
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe("BOOKED");
    expect(res.body.data.trackingCode).toMatch(/^MK/);
    const order = await prisma.order.findUniqueOrThrow({ where: { id } });
    expect(order.status).toBe("COURIER_BOOKED");
    const history = await prisma.orderStatusHistory.findMany({ where: { orderId: id }, orderBy: { createdAt: "asc" } });
    expect(history.map((h) => h.toStatus)).toEqual(["PENDING", "CONFIRMED", "READY_TO_SHIP", "COURIER_BOOKED"]);
  });

  it("never creates two live shipments for one order (double click / concurrency)", async () => {
    const { id } = await readyOrder();
    const results = await Promise.all([1, 2, 3].map(() => admin.post("/api/v1/couriers/shipments", { orderId: id })));
    const ids = new Set(results.filter((r) => r.status === 201).map((r) => r.body.data.id));
    expect(ids.size).toBe(1);
    expect(await prisma.shipment.count({ where: { orderId: id } })).toBe(1);
    const again = await admin.post("/api/v1/couriers/shipments", { orderId: id });
    expect(again.body.data.alreadyBooked).toBe(true);
  });

  it("keeps a temporarily failing booking pending and retries it", async () => {
    const { id } = await readyOrder();
    await setFailMode("retryable");
    const res = await admin.post("/api/v1/couriers/shipments", { orderId: id });
    expect(res.body.data.status).toBe("PENDING");
    expect(res.body.data.lastError).toMatch(/unavailable/);
    expect(res.body.data.nextRetryAt).toBeTruthy();
    expect((await prisma.order.findUniqueOrThrow({ where: { id } })).status).toBe("CONFIRMED");

    await setFailMode("none");
    const order = await prisma.order.findUniqueOrThrow({ where: { id } });
    await retryBookingJob({ shipmentId: res.body.data.id, reference: order.orderNumber });
    const s = await prisma.shipment.findUniqueOrThrow({ where: { id: res.body.data.id } });
    expect(s.status).toBe("BOOKED");
    expect(s.attempts).toBe(2);
  });

  it("does not duplicate the parcel when the courier created it but the response was lost", async () => {
    const { id } = await readyOrder();
    await setFailMode("lost_response");
    const first = await admin.post("/api/v1/couriers/shipments", { orderId: id });
    expect(first.body.data.status).toBe("PENDING");
    await setFailMode("none");
    const retried = await admin.post(`/api/v1/couriers/shipments/${first.body.data.id}/retry`);
    expect(retried.body.data.status).toBe("BOOKED");
    // the retry found the existing parcel by reference instead of creating a second one
    const creates = await prisma.courierApiLog.count({ where: { shipmentId: first.body.data.id, operation: "create", success: true } });
    expect(creates).toBe(1);
  });

  it("marks permanent failures FAILED, notifies staff, and allows rebooking", async () => {
    const { id } = await readyOrder();
    await setFailMode("fatal");
    const res = await admin.post("/api/v1/couriers/shipments", { orderId: id });
    expect(res.body.data.status).toBe("FAILED");
    expect(await prisma.notification.count({ where: { type: "courier.booking_failed", dedupeKey: { startsWith: `courier-failed:${res.body.data.id}` } } })).toBeGreaterThan(0);
    await setFailMode("none");
    const rebook = await admin.post("/api/v1/couriers/shipments", { orderId: id });
    expect(rebook.body.data.status).toBe("BOOKED");
    expect(rebook.body.data.idempotencyKey).toMatch(/:fwd:2$/);
  });

  it("refuses to book orders that are not confirmed, and checks permission", async () => {
    const product = await makeProduct(admin);
    const id = (await makeOrder(admin, product.variants[0].id)).body.data.id;
    expect((await admin.post("/api/v1/couriers/shipments", { orderId: id })).body.error.code).toBe("ORDER_NOT_READY");
    const agent = await staff(["confirmation_agent"]);
    expect((await agent.post("/api/v1/couriers/shipments", { orderId: id })).status).toBe(403);
  });
});

describe("courier status sync", () => {
  it("drives the order through pickup and delivery, booking fees once", async () => {
    const { id, variantId } = await readyOrder(3);
    const shipmentId = (await admin.post("/api/v1/couriers/shipments", { orderId: id })).body.data.id;

    expect((await simulate(shipmentId, "picked_up", { eventId: "evt-1" })).body.data.applied).toBe(1);
    expect((await prisma.order.findUniqueOrThrow({ where: { id } })).status).toBe("SHIPPED");
    const level = await stockOf(variantId);
    expect(level.reserved).toBe(0);
    expect(level.available).toBe(2);

    const delivered = await simulate(shipmentId, "delivered", { eventId: "evt-2", deliveryCharge: "60" });
    expect(delivered.body.data.applied).toBe(1);
    const order = await prisma.order.findUniqueOrThrow({ where: { id } });
    expect(order.status).toBe("DELIVERED");
    expect(order.paymentStatus).toBe("PAID");

    // duplicate webhook
    const dup = await simulate(shipmentId, "delivered", { eventId: "evt-2", deliveryCharge: "60" });
    expect(dup.body.data.duplicates).toBe(1);
    const fees = await prisma.financialEntry.findMany({ where: { shipmentId, type: "COURIER_FEE" } });
    expect(fees).toHaveLength(1);
    expect(fees[0].amount.toFixed(2)).toBe("-60.00");
    expect(await prisma.payment.count({ where: { orderId: id } })).toBe(1);

    // stale, out-of-order event is recorded but not applied
    const stale = await simulate(shipmentId, "in_transit", { eventId: "evt-0", updatedAt: new Date(Date.now() - 3_600_000).toISOString() });
    expect(stale.body.data.applied).toBe(0);
    expect((await prisma.shipment.findUniqueOrThrow({ where: { id: shipmentId } })).status).toBe("DELIVERED");
  });

  it("rejects webhooks with a bad signature", async () => {
    const res = await api.post("/api/v1/webhooks/couriers/mock").set("x-mock-signature", "bad").send({ consignment_id: "x", status: "delivered" });
    expect(res.status).toBe(401);
    const unknown = await api.post("/api/v1/webhooks/couriers/nope").send({});
    expect(unknown.status).toBe(404);
  });

  it("handles a return-to-origin with return fee", async () => {
    const { id, variantId } = await readyOrder(2);
    const shipmentId = (await admin.post("/api/v1/couriers/shipments", { orderId: id })).body.data.id;
    await simulate(shipmentId, "picked_up");
    await simulate(shipmentId, "returning");
    expect((await prisma.order.findUniqueOrThrow({ where: { id } })).status).toBe("RETURN_IN_TRANSIT");
    await simulate(shipmentId, "returned", { returnCharge: "30", deliveryCharge: "60" });
    const order = await prisma.order.findUniqueOrThrow({ where: { id } });
    expect(order.status).toBe("RETURNED");
    expect((await stockOf(variantId)).returned).toBe(1);
    const types = (await prisma.financialEntry.findMany({ where: { orderId: id } })).map((e) => e.type).sort();
    expect(types).toEqual(["COURIER_FEE", "PACKAGING_COST", "RETURN_FEE"]);
  });

  it("cancels a booked shipment and returns the order to READY_TO_SHIP", async () => {
    const { id } = await readyOrder();
    const shipmentId = (await admin.post("/api/v1/couriers/shipments", { orderId: id })).body.data.id;
    expect((await admin.post(`/api/v1/orders/${id}/status`, { status: "CANCELLED", reason: "x" })).body.error.code).toBe("SHIPMENT_ACTIVE");
    const res = await admin.post(`/api/v1/couriers/shipments/${shipmentId}/cancel`, { reason: "Customer cancelled on call" });
    expect(res.body.data.status).toBe("CANCELLED");
    expect((await prisma.order.findUniqueOrThrow({ where: { id } })).status).toBe("READY_TO_SHIP");
    expect((await admin.post(`/api/v1/orders/${id}/status`, { status: "CANCELLED", reason: "Customer cancelled" })).status).toBe(200);
  });

  it("refuses to cancel after pickup", async () => {
    const { id } = await readyOrder();
    const shipmentId = (await admin.post("/api/v1/couriers/shipments", { orderId: id })).body.data.id;
    await simulate(shipmentId, "picked_up");
    expect((await admin.post(`/api/v1/couriers/shipments/${shipmentId}/cancel`, { reason: "too late" })).status).toBe(409);
  });
});

describe("COD settlement", () => {
  it("records a settlement once, books cash and fee adjustments, and reconciles orders", async () => {
    const { id } = await readyOrder();
    const shipmentId = (await admin.post("/api/v1/couriers/shipments", { orderId: id })).body.data.id;
    await simulate(shipmentId, "picked_up");
    await simulate(shipmentId, "delivered", { deliveryCharge: "60" });
    const order = await prisma.order.findUniqueOrThrow({ where: { id } });
    const account = await prisma.account.findFirstOrThrow({ where: { type: "BANK" } });

    const summary = await admin.get("/api/v1/couriers/cod/summary");
    expect(summary.body.data.find((r: { provider: { code: string } }) => r.provider.code === "MOCK").unsettledShipments).toBeGreaterThan(0);

    const body = {
      providerId: mockId, accountId: account.id, receivedAt: new Date().toISOString(),
      receivedAmount: money(order.total).minus(65).toFixed(2),
      items: [{ shipmentId, collected: order.total.toFixed(2), deliveryFee: "65", codCharge: "0" }],
    };
    const res = await admin.post("/api/v1/couriers/settlements", body);
    expect(res.status).toBe(201);
    expect(res.body.data.variance).toBe("0.00");
    expect((await admin.post("/api/v1/couriers/settlements", body)).status).toBe(409);

    const entries = await prisma.financialEntry.findMany({ where: { OR: [{ shipmentId }, { settlementId: res.body.data.id }] } });
    const cash = entries.find((e) => e.type === "SETTLEMENT_RECEIVED")!;
    expect(cash.isCash).toBe(true);
    expect(cash.accountId).toBe(account.id);
    const courierFees = entries.filter((e) => e.type === "COURIER_FEE").reduce((s, e) => s + Number(e.amount), 0);
    expect(courierFees).toBe(-65); // 60 booked on delivery + 5 adjustment from the settlement
    expect((await prisma.order.findUniqueOrThrow({ where: { id } })).financeStatus).toBe("RECONCILED");
  });
});

import { money } from "../src/lib/money.js";
