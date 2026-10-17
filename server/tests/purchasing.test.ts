import { beforeAll, describe, expect, it } from "vitest";
import { staff, unique, type Client } from "./helpers.js";
import { makeProduct, stockOf } from "./fixtures.js";
import { prisma } from "../src/lib/prisma.js";

let admin: Client;
let warehouse: Client; // purchasing.view, no finance.view
let accountant: Client; // purchasing.view + finance.view, no purchasing.manage

beforeAll(async () => {
  admin = await staff(["admin"]);
  warehouse = await staff(["warehouse"]);
  accountant = await staff(["accountant"]);
});

async function makeSupplier(name = `Supplier ${unique()}`) {
  const res = await admin.post("/api/v1/suppliers", { name, phone: "01711000000", contactName: "Rahim" });
  expect(res.status).toBe(201);
  return res.body.data as { id: string };
}

async function makeMaterial(unitCost = "180") {
  const res = await admin.post("/api/v1/materials", { name: `Cotton voile ${unique()}`, unit: "yard", unitCost });
  expect(res.status).toBe(201);
  return res.body.data as { id: string; unitCost: string };
}

describe("suppliers & materials", () => {
  it("creates, updates and soft-deactivates suppliers with permission checks", async () => {
    expect((await warehouse.post("/api/v1/suppliers", { name: "Nope Ltd" })).status).toBe(403);
    const s = await makeSupplier();
    const upd = await admin.put(`/api/v1/suppliers/${s.id}`, { notes: "Pays on delivery" });
    expect(upd.body.data.notes).toBe("Pays on delivery");
    const del = await admin.delete(`/api/v1/suppliers/${s.id}`);
    expect(del.body.data.isActive).toBe(false);
    expect(await prisma.supplier.findUnique({ where: { id: s.id } })).not.toBeNull();
    const list = await warehouse.get("/api/v1/suppliers?active=false");
    expect(list.status).toBe(200);
    expect(list.body.data.some((x: { id: string }) => x.id === s.id)).toBe(true);
    // inactive suppliers cannot receive new POs
    const po = await admin.post("/api/v1/purchase-orders", { supplierId: s.id, items: [{ materialId: (await makeMaterial()).id, quantity: 1, unitCost: "10" }] });
    expect(po.status).toBe(422);
    expect(await prisma.auditLog.count({ where: { entityId: s.id, action: { startsWith: "supplier." } } })).toBe(3);
  });

  it("calculates product cost with Decimal strings", async () => {
    const m = await makeMaterial("180.50");
    const res = await warehouse.post("/api/v1/materials/calculate-cost", {
      components: [
        { materialId: m.id, quantity: "1.5" },
        { description: "Hand embroidery labour", quantity: 1, unitCost: "350" },
        { description: "Packaging box", quantity: "0.333", unitCost: "0.10" },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body.data.lines.map((l: { lineTotal: string }) => l.lineTotal)).toEqual(["270.75", "350.00", "0.03"]);
    expect(res.body.data.total).toBe("620.78");
    expect(res.body.data.lines[0].unitCost).toBe("180.50");
    const bad = await admin.post("/api/v1/materials/calculate-cost", { components: [{ description: "x", quantity: 1 }] });
    expect(bad.status).toBe(422);
  });
});

describe("purchase orders & receiving", () => {
  it("computes totals server-side, edits drafts only, receives via inventory movements and blocks over-receiving", async () => {
    const supplier = await makeSupplier();
    const material = await makeMaterial("180");
    const product = await makeProduct(admin, { cost: "1120", stock: [2] });
    const variantId = product.variants[0].id;

    const create = await admin.post("/api/v1/purchase-orders", {
      supplierId: supplier.id,
      shippingCost: "0",
      items: [
        { variantId, quantity: 8, unitCost: "1000" },
        { materialId: material.id, quantity: "5", unitCost: "200" },
      ],
    });
    expect(create.status).toBe(201);
    const po = create.body.data;
    expect(po.status).toBe("DRAFT");
    expect(po.number).toMatch(/^PO\d+$/);
    expect(po.subtotal).toBe("9000.00");

    // fractional quantity for a variant is rejected
    const frac = await admin.put(`/api/v1/purchase-orders/${po.id}`, { items: [{ variantId, quantity: "1.5", unitCost: "1000" }] });
    expect(frac.status).toBe(400);

    const edited = await admin.put(`/api/v1/purchase-orders/${po.id}`, {
      items: [
        { variantId, quantity: 10, unitCost: "1000" },
        { materialId: material.id, quantity: "5", unitCost: "200" },
      ],
      shippingCost: "0",
    });
    expect(edited.status).toBe(200);
    expect(edited.body.data.subtotal).toBe("11000.00");
    expect(edited.body.data.total).toBe("11000.00");

    // cannot receive a draft
    const vItem = edited.body.data.items.find((i: { variantId: string | null }) => i.variantId === variantId);
    const mItem = edited.body.data.items.find((i: { materialId: string | null }) => i.materialId === material.id);
    expect((await admin.post(`/api/v1/purchase-orders/${po.id}/receive`, { items: [{ itemId: vItem.id, quantity: 1 }] })).status).toBe(422);

    expect((await warehouse.post(`/api/v1/purchase-orders/${po.id}/order`)).status).toBe(403);
    const ordered = await admin.post(`/api/v1/purchase-orders/${po.id}/order`);
    expect(ordered.body.data.status).toBe("ORDERED");
    expect((await admin.put(`/api/v1/purchase-orders/${po.id}`, { notes: "late edit" })).status).toBe(422);

    // partial receipt
    const r1 = await admin.post(`/api/v1/purchase-orders/${po.id}/receive`, { items: [{ itemId: vItem.id, quantity: 4 }] });
    expect(r1.status).toBe(200);
    expect(r1.body.data.status).toBe("PARTIALLY_RECEIVED");
    expect((await stockOf(variantId)).available).toBe(6);
    const movement = await prisma.inventoryMovement.findFirstOrThrow({ where: { variantId, type: "RECEIVE", purchaseOrderId: po.id } });
    expect(movement.availableDelta).toBe(4);
    expect(movement.availableAfter).toBe(6);

    // over-receive: only 6 outstanding
    const over = await admin.post(`/api/v1/purchase-orders/${po.id}/receive`, { items: [{ itemId: vItem.id, quantity: 7 }] });
    expect(over.status).toBe(422);
    expect(over.body.error.code).toBe("OVER_RECEIVE");
    expect((await stockOf(variantId)).available).toBe(6);

    // all-or-nothing: a valid line plus an over-received line changes nothing
    const mixed = await admin.post(`/api/v1/purchase-orders/${po.id}/receive`, { items: [{ itemId: mItem.id, quantity: 1 }, { itemId: vItem.id, quantity: 99 }] });
    expect(mixed.status).toBe(422);
    expect((await prisma.material.findUniqueOrThrow({ where: { id: material.id } })).stockQty.toString()).toBe("0");

    // final receipt with weighted-average cost update: (6×1120 + 6×1000) / 12 = 1060
    const r2 = await admin.post(`/api/v1/purchase-orders/${po.id}/receive`, {
      items: [{ itemId: vItem.id, quantity: 6 }, { itemId: mItem.id, quantity: "5" }],
      updateCost: true,
    });
    expect(r2.status).toBe(200);
    expect(r2.body.data.status).toBe("RECEIVED");
    expect(r2.body.data.receivedAt).toBeTruthy();
    expect((await stockOf(variantId)).available).toBe(12);
    const variant = await prisma.productVariant.findUniqueOrThrow({ where: { id: variantId } });
    expect(variant.costPrice?.toFixed(2)).toBe("1060.00");
    const mat = await prisma.material.findUniqueOrThrow({ where: { id: material.id } });
    expect(mat.stockQty.toString()).toBe("5");
    expect(mat.unitCost.toFixed(2)).toBe("200.00");
    expect(await prisma.inventoryMovement.count({ where: { purchaseOrderId: po.id, type: "RECEIVE" } })).toBe(2);

    // nothing more to receive, and received POs cannot be cancelled
    expect((await admin.post(`/api/v1/purchase-orders/${po.id}/receive`, { items: [{ itemId: vItem.id, quantity: 1 }] })).status).toBe(422);
    expect((await admin.post(`/api/v1/purchase-orders/${po.id}/cancel`, { reason: "oops" })).status).toBe(422);
    expect(await prisma.auditLog.count({ where: { entityId: po.id, action: "purchase_order.received" } })).toBe(2);

    const detail = await warehouse.get(`/api/v1/purchase-orders/${po.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.payments).toBeUndefined(); // no finance.view
  });

  it("cancels only when nothing was received", async () => {
    const supplier = await makeSupplier();
    const material = await makeMaterial();
    const po = (await admin.post("/api/v1/purchase-orders", { supplierId: supplier.id, items: [{ materialId: material.id, quantity: 3, unitCost: "50" }] })).body.data;
    await admin.post(`/api/v1/purchase-orders/${po.id}/order`);
    const cancelled = await admin.post(`/api/v1/purchase-orders/${po.id}/cancel`, { reason: "Supplier out of stock" });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data.status).toBe("CANCELLED");

    const po2 = (await admin.post("/api/v1/purchase-orders", { supplierId: supplier.id, items: [{ materialId: material.id, quantity: 3, unitCost: "50" }] })).body.data;
    await admin.post(`/api/v1/purchase-orders/${po2.id}/order`);
    await admin.post(`/api/v1/purchase-orders/${po2.id}/receive`, { items: [{ itemId: po2.items[0].id, quantity: 1 }] });
    expect((await admin.post(`/api/v1/purchase-orders/${po2.id}/cancel`, {})).status).toBe(422);
  });
});

describe("supplier payments", () => {
  it("records a cash-out ledger entry, updates PO paid amount and supplier balance, and blocks overpayment", async () => {
    const supplier = await makeSupplier();
    const material = await makeMaterial();
    const draft = (await admin.post("/api/v1/purchase-orders", { supplierId: supplier.id, shippingCost: "150", items: [{ materialId: material.id, quantity: 20, unitCost: "250" }] })).body.data;
    expect(draft.total).toBe("5150.00");
    const cash = await prisma.account.findFirstOrThrow({ where: { name: "Cash in Hand" } });

    // drafts are not payable and do not count toward the balance
    const early = await admin.post(`/api/v1/suppliers/${supplier.id}/payments`, { amount: "100", method: "CASH", accountId: cash.id, purchaseOrderId: draft.id, paidAt: "2026-10-01" });
    expect(early.status).toBe(422);
    let s = await admin.get(`/api/v1/suppliers/${supplier.id}`);
    expect(s.body.data.balance.outstanding).toBe("0.00");

    await admin.post(`/api/v1/purchase-orders/${draft.id}/order`);
    s = await admin.get(`/api/v1/suppliers/${supplier.id}`);
    expect(s.body.data.balance).toEqual({ purchased: "5150.00", paid: "0.00", outstanding: "5150.00" });
    expect(s.body.data.purchaseHistory).toHaveLength(1);

    // accountant may view but not pay; warehouse may not see balances or payments
    expect((await accountant.post(`/api/v1/suppliers/${supplier.id}/payments`, { amount: "100", method: "CASH", accountId: cash.id, paidAt: "2026-10-01" })).status).toBe(403);
    expect((await warehouse.get(`/api/v1/suppliers/${supplier.id}/payments`)).status).toBe(403);
    expect((await warehouse.get(`/api/v1/suppliers/${supplier.id}`)).body.data.balance).toBeUndefined();

    const pay = await admin
      .post(`/api/v1/suppliers/${supplier.id}/payments`, { amount: "2000.50", method: "BKASH", accountId: cash.id, purchaseOrderId: draft.id, paidAt: "2026-10-02", reference: "TRX123" })
      .set("Idempotency-Key", `sp-${unique()}`);
    expect(pay.status).toBe(201);
    const paymentId = pay.body.data.id;

    const entry = await prisma.financialEntry.findUniqueOrThrow({ where: { idempotencyKey: `supplier_payment:${paymentId}` } });
    expect(entry.type).toBe("SUPPLIER_PAYMENT");
    expect(entry.amount.toFixed(2)).toBe("-2000.50");
    expect(entry.isCash).toBe(true);
    expect(entry.accountId).toBe(cash.id);

    const po = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: draft.id } });
    expect(po.paidAmount.toFixed(2)).toBe("2000.50");

    const over = await admin.post(`/api/v1/suppliers/${supplier.id}/payments`, { amount: "3149.51", method: "CASH", accountId: cash.id, purchaseOrderId: draft.id, paidAt: "2026-10-03" });
    expect(over.status).toBe(422);
    expect(over.body.error.code).toBe("OVERPAYMENT");

    // advance not tied to a PO
    expect((await admin.post(`/api/v1/suppliers/${supplier.id}/payments`, { amount: "500", method: "CASH", accountId: cash.id, paidAt: "2026-10-03" })).status).toBe(201);

    s = await accountant.get(`/api/v1/suppliers/${supplier.id}`);
    expect(s.body.data.balance).toEqual({ purchased: "5150.00", paid: "2500.50", outstanding: "2649.50" });
    const list = await accountant.get(`/api/v1/suppliers/${supplier.id}/payments`);
    expect(list.body.data).toHaveLength(2);
    expect(await prisma.auditLog.count({ where: { entityId: paymentId, action: "supplier_payment.created" } })).toBe(1);
  });
});
