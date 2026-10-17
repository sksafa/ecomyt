import { beforeAll, describe, expect, it } from "vitest";
import { api, staff, type Client } from "./helpers.js";
import { makeOrder, makeProduct, stockOf } from "./fixtures.js";
import { prisma } from "../src/lib/prisma.js";
import { money } from "../src/lib/money.js";
import { dhakaDate } from "../src/lib/time.js";
import { sandboxSignature } from "../src/modules/payments/gateways.js";

let admin: Client;
let accountant: Client;
let bankId: string;
let bkashId: string;

const move = (id: string, status: string, reason?: string) => admin.post(`/api/v1/orders/${id}/status`, { status, reason });
async function deliver(id: string) {
  for (const s of ["CONFIRMED", "READY_TO_SHIP", "SHIPPED", "DELIVERED"]) expect((await move(id, s)).status).toBe(200);
}

beforeAll(async () => {
  admin = await staff(["admin"]);
  accountant = await staff(["accountant"]);
  bankId = (await prisma.account.findFirstOrThrow({ where: { type: "BANK" } })).id;
  bkashId = (await prisma.account.findFirstOrThrow({ where: { name: "bKash Merchant" } })).id;
});

describe("payments", () => {
  it("records an advance, reduces COD only after verification, and blocks duplicate transactions", async () => {
    const product = await makeProduct(admin, { price: "2270" });
    const id = (await makeOrder(admin, product.variants[0].id)).body.data.id;
    const trx = `BK${Date.now()}`;

    const p = await admin.post("/api/v1/payments", { orderId: id, method: "BKASH", amount: "500", transactionId: trx, senderNumber: "01711111111" });
    expect(p.status).toBe(201);
    expect(p.body.data.status).toBe("PENDING");
    expect((await prisma.order.findUniqueOrThrow({ where: { id } })).codAmount.toFixed(2)).toBe("2340.00");

    const v = await admin.post(`/api/v1/payments/${p.body.data.id}/verify`, { accountId: bkashId });
    expect(v.body.data.status).toBe("COMPLETED");
    const order = await prisma.order.findUniqueOrThrow({ where: { id } });
    expect(order.paidAmount.toFixed(2)).toBe("500.00");
    expect(order.codAmount.toFixed(2)).toBe("1840.00");
    expect(order.paymentStatus).toBe("PARTIALLY_PAID");
    const cash = await prisma.financialEntry.findFirstOrThrow({ where: { paymentId: p.body.data.id } });
    expect(cash.isCash && cash.accountId === bkashId && cash.type === "PAYMENT_RECEIVED").toBe(true);

    // verifying twice is harmless; same transaction id on another order is rejected
    await admin.post(`/api/v1/payments/${p.body.data.id}/verify`, {});
    expect(await prisma.financialEntry.count({ where: { paymentId: p.body.data.id } })).toBe(1);
    const other = (await makeOrder(admin, product.variants[0].id)).body.data.id;
    const dup = await admin.post("/api/v1/payments", { orderId: other, method: "BKASH", amount: "500", transactionId: trx });
    expect(dup.status).toBe(409);

    // cannot overpay
    const over = await admin.post("/api/v1/payments", { orderId: id, method: "NAGAD", amount: "5000", transactionId: `NG${Date.now()}`, verified: true });
    expect(over.status).toBe(409);
  });

  it("completes an online payment only after server-side validation of amount and signature", async () => {
    const product = await makeProduct(admin, { price: "1000" });
    const created = await makeOrder(admin, product.variants[0].id);
    const order = await prisma.order.findUniqueOrThrow({ where: { id: created.body.data.id } });

    const init = await api.post("/api/v1/payments/online/init").send({ orderNumber: order.orderNumber, phone: order.shippingPhone, gateway: "sandbox" });
    expect(init.status).toBe(200);
    const { transactionId, amount } = init.body.data;
    expect(amount).toBe(order.total.toFixed(2));
    expect((await api.post("/api/v1/payments/online/init").send({ orderNumber: order.orderNumber, phone: "01999999999", gateway: "sandbox" })).status).toBe(400);

    // forged redirect with a tampered amount is rejected
    const forged = await api.post("/api/v1/payments/callback/sandbox/success").type("form").send({ tran_id: transactionId, amount: "1", status: "VALID", signature: sandboxSignature(transactionId, "1", "VALID") });
    expect(forged.status).toBe(303);
    expect(forged.headers.location).toContain("payment=failed");
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).paidAmount.toFixed(2)).toBe("0.00");

    const init2 = await api.post("/api/v1/payments/online/init").send({ orderNumber: order.orderNumber, phone: order.shippingPhone, gateway: "sandbox" });
    const t2 = init2.body.data.transactionId;
    const ok = await api.post("/api/v1/payments/callback/sandbox/success").type("form").send({ tran_id: t2, amount: init2.body.data.amount, status: "VALID", signature: sandboxSignature(t2, init2.body.data.amount, "VALID") });
    expect(ok.headers.location).toContain("payment=success");
    // IPN for the same transaction afterwards is idempotent
    await api.post("/api/v1/payments/callback/sandbox/ipn").type("form").send({ tran_id: t2, amount: init2.body.data.amount, status: "VALID", signature: sandboxSignature(t2, init2.body.data.amount, "VALID") });
    const paid = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(paid.paymentStatus).toBe("PAID");
    expect(paid.codAmount.toFixed(2)).toBe("0.00");
    expect(await prisma.financialEntry.count({ where: { orderId: order.id, type: "PAYMENT_RECEIVED" } })).toBe(1);
  });

  it("offers only configured gateways and completes sandbox payments server-side", async () => {
    const opts = await api.get("/api/v1/payments/online/options");
    expect(opts.body.data.gateways.map((g: { code: string }) => g.code)).toEqual(["sandbox"]); // SSLCommerz not configured in tests

    const product = await makeProduct(admin, { price: "1500" });
    const created = await makeOrder(admin, product.variants[0].id);
    const order = await prisma.order.findUniqueOrThrow({ where: { id: created.body.data.id } });
    const init = await api.post("/api/v1/payments/online/init").send({ orderNumber: order.orderNumber, phone: order.shippingPhone, gateway: "sandbox" });
    const tranId = init.body.data.transactionId;

    const failed = await api.post("/api/v1/payments/sandbox/complete").send({ tranId, outcome: "fail" });
    expect(failed.body.data.redirectUrl).toContain("payment=failed");
    expect((await prisma.payment.findFirstOrThrow({ where: { transactionId: tranId } })).status).toBe("FAILED");

    const init2 = await api.post("/api/v1/payments/online/init").send({ orderNumber: order.orderNumber, phone: order.shippingPhone, gateway: "sandbox" });
    const ok = await api.post("/api/v1/payments/sandbox/complete").send({ tranId: init2.body.data.transactionId, outcome: "success" });
    expect(ok.body.data.redirectUrl).toContain("payment=success");
    await api.post("/api/v1/payments/sandbox/complete").send({ tranId: init2.body.data.transactionId, outcome: "success" });
    const paid = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(paid.paymentStatus).toBe("PAID");
    expect(await prisma.financialEntry.count({ where: { orderId: order.id, type: "PAYMENT_RECEIVED" } })).toBe(1);
  });

  it("cancelling a prepaid order raises a refund that still needs approval", async () => {
    const product = await makeProduct(admin);
    const id = (await makeOrder(admin, product.variants[0].id)).body.data.id;
    await admin.post("/api/v1/payments", { orderId: id, method: "CASH", amount: "300", verified: true, accountId: bankId });
    await move(id, "CANCELLED", "Out of stock colour");
    const refund = await prisma.refund.findFirstOrThrow({ where: { orderId: id } });
    expect(refund.status).toBe("PENDING");
    expect(refund.amount.toFixed(2)).toBe("300.00");
    expect((await admin.post(`/api/v1/refunds/${refund.id}/pay`, { accountId: bankId })).body.error.code).toBe("NOT_APPROVED");
  });
});

describe("returns, refunds and exchanges", () => {
  it("processes a customer return end to end with correct stock and ledger effects", async () => {
    const product = await makeProduct(admin, { price: "2270", cost: "1120", stock: [3] });
    const v = product.variants[0].id;
    const id = (await makeOrder(admin, v, {}, 2)).body.data.id;
    await deliver(id);
    const order = await prisma.order.findUniqueOrThrow({ where: { id }, include: { items: true } });
    expect((await stockOf(v)).available).toBe(1);

    const created = await admin.post("/api/v1/returns", { orderId: id, type: "RETURN", reason: "Colour different from photo", items: [{ orderItemId: order.items[0].id, quantity: 2 }] });
    expect(created.status).toBe(201);
    expect((await prisma.order.findUniqueOrThrow({ where: { id } })).status).toBe("RETURN_REQUESTED");
    const rid = created.body.data.id;

    // cannot over-return
    expect((await admin.post("/api/v1/returns", { orderId: id, type: "RETURN", reason: "again", items: [{ orderItemId: order.items[0].id, quantity: 1 }] })).status).toBe(422);

    const support = await staff(["customer_support"]);
    expect((await support.post(`/api/v1/returns/${rid}/approve`, {})).status).toBe(403);
    expect((await admin.post(`/api/v1/returns/${rid}/approve`, {})).status).toBe(200);
    expect((await admin.post(`/api/v1/returns/${rid}/pickup`, {})).status).toBe(200);
    expect((await prisma.order.findUniqueOrThrow({ where: { id } })).status).toBe("RETURN_IN_TRANSIT");
    expect((await admin.post(`/api/v1/returns/${rid}/receive`, { returnShippingCost: "60" })).status).toBe(200);
    expect((await prisma.order.findUniqueOrThrow({ where: { id } })).status).toBe("RETURNED");
    let level = await stockOf(v);
    expect(level.returned).toBe(2);
    expect(await prisma.returnRequest.count({ where: { orderId: id } })).toBe(1); // no phantom RTO record

    const items = (await admin.get(`/api/v1/returns/${rid}`)).body.data.items;
    const insp = await admin.post(`/api/v1/returns/${rid}/inspect`, { items: [{ returnItemId: items[0].id, condition: "GOOD", disposition: "RESTOCK" }] });
    expect(insp.status).toBe(200);
    level = await stockOf(v);
    expect(level.returned).toBe(0);
    expect(level.available).toBe(3);

    const refund = await admin.post(`/api/v1/returns/${rid}/refund`, { amount: order.paidAmount.toFixed(2), method: "BKASH" });
    expect(refund.status).toBe(201);
    expect((await admin.post(`/api/v1/returns/${rid}/complete`)).body.error.code).toBe("REFUND_OPEN");
    expect((await accountant.post(`/api/v1/refunds/${refund.body.data.id}/approve`, {})).status).toBe(200);
    expect((await accountant.post(`/api/v1/refunds/${refund.body.data.id}/pay`, { accountId: bankId, reference: "BK-REF-1" })).status).toBe(200);
    expect((await admin.post(`/api/v1/returns/${rid}/complete`)).status).toBe(200);

    const after = await prisma.order.findUniqueOrThrow({ where: { id } });
    expect(after.paymentStatus).toBe("REFUNDED");
    const entries = await prisma.financialEntry.findMany({ where: { orderId: id } });
    const pnl = entries.filter((e) => e.type !== "REFUND" && e.type !== "PAYMENT_RECEIVED").reduce((s, e) => s.plus(e.amount), money(0));
    // revenue 4540 + shipping 70 − COGS 2240 − packaging 20 − refund 4610 + restock 2240 − return shipping 60 = −80
    expect(pnl.toFixed(2)).toBe("-80.00");
    const refundCash = entries.find((e) => e.type === "REFUND")!;
    expect(refundCash.isCash && refundCash.accountId === bankId).toBe(true);
  });

  it("creates an exchange order with the returned value credited", async () => {
    const product = await makeProduct(admin, { price: "2000", stock: [5, 5] });
    const [a, b] = product.variants;
    const id = (await makeOrder(admin, a.id)).body.data.id;
    await deliver(id);
    const order = await prisma.order.findUniqueOrThrow({ where: { id }, include: { items: true } });
    const ex = await admin.post("/api/v1/returns", { orderId: id, type: "EXCHANGE", reason: "Wants other colour", items: [{ orderItemId: order.items[0].id, quantity: 1 }] });
    await admin.post(`/api/v1/returns/${ex.body.data.id}/approve`, {});
    const res = await admin.post(`/api/v1/returns/${ex.body.data.id}/exchange-order`, { items: [{ variantId: b.id, quantity: 1 }], deliveryCharge: "0" });
    expect(res.status).toBe(201);
    expect(res.body.data.credit).toBe("2000.00");
    expect(res.body.data.customerOwes).toBe("0.00");
    const replacement = await prisma.order.findUniqueOrThrow({ where: { id: res.body.data.exchangeOrder.id } });
    expect(replacement.sourceOrderId).toBe(id);
    expect(replacement.total.toFixed(2)).toBe("0.00");
    expect((await prisma.order.findUniqueOrThrow({ where: { id } })).status).toBe("EXCHANGED");
    expect((await stockOf(b.id)).reserved).toBe(1);
  });

  it("rejecting a return restores the order to DELIVERED", async () => {
    const product = await makeProduct(admin);
    const id = (await makeOrder(admin, product.variants[0].id)).body.data.id;
    await deliver(id);
    const order = await prisma.order.findUniqueOrThrow({ where: { id }, include: { items: true } });
    const r = await admin.post("/api/v1/returns", { orderId: id, type: "RETURN", reason: "Changed mind after 30 days", items: [{ orderItemId: order.items[0].id, quantity: 1 }] });
    expect((await admin.post(`/api/v1/returns/${r.body.data.id}/reject`, {})).status).toBe(422);
    expect((await admin.post(`/api/v1/returns/${r.body.data.id}/reject`, { note: "Outside return window" })).status).toBe(200);
    expect((await prisma.order.findUniqueOrThrow({ where: { id } })).status).toBe("DELIVERED");
  });
});

describe("expenses and profit & loss", () => {
  it("books expenses, reverses edits, and reports P&L that reconciles with the ledger", async () => {
    const today = dhakaDate();
    const before = (await accountant.get(`/api/v1/finance/profit-and-loss?from=${today}&to=${today}`)).body.data;

    const fb = await prisma.expenseCategory.findUniqueOrThrow({ where: { name: "Facebook Ads" } });
    const rent = await prisma.expenseCategory.findUniqueOrThrow({ where: { name: "Rent" } });
    const ad = await accountant.post("/api/v1/finance/expenses", { categoryId: fb.id, amount: "1500", date: today, description: "Boost – Eid collection", accountId: bankId });
    expect(ad.status).toBe(201);
    const r = await accountant.post("/api/v1/finance/expenses", { categoryId: rent.id, amount: "10000", date: today, description: "Studio rent", accountId: bankId });
    const edit = await accountant.put(`/api/v1/finance/expenses/${r.body.data.id}`, { categoryId: rent.id, amount: "12000", date: today, description: "Studio rent", accountId: bankId, reason: "Wrong amount" });
    expect(edit.status).toBe(200);

    const product = await makeProduct(admin, { price: "2270", cost: "1120" });
    const id = (await makeOrder(admin, product.variants[0].id)).body.data.id;
    await deliver(id);

    const after = (await accountant.get(`/api/v1/finance/profit-and-loss?from=${today}&to=${today}`)).body.data;
    const delta = (path: (x: typeof after) => string) => money(path(after)).minus(money(path(before))).toFixed(2);
    expect(delta((x) => x.revenue.productSales)).toBe("2270.00");
    expect(delta((x) => x.revenue.shippingCharges)).toBe("70.00");
    expect(delta((x) => x.costOfGoods.cogs)).toBe("-1120.00");
    expect(delta((x) => x.operatingCosts.advertising)).toBe("-1500.00");
    expect(delta((x) => x.operatingCosts.otherExpenses)).toBe("-12000.00");
    expect(delta((x) => x.operatingCosts.packaging)).toBe("-20.00");
    // net = 2270 + 70 − 1120 − 20 − 1500 − 12000
    expect(delta((x) => x.netProfit)).toBe("-12300.00");

    const agentP = await (await staff(["confirmation_agent"])).get(`/api/v1/finance/profit-and-loss`);
    expect(agentP.status).toBe(403);
  });
});
