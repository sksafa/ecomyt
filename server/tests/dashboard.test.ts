import { beforeAll, describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { staff, unique, type Client } from "./helpers.js";
import { makeOrder, makeProduct } from "./fixtures.js";
import { prisma } from "../src/lib/prisma.js";
import { money } from "../src/lib/money.js";
import { dhakaDate } from "../src/lib/time.js";

let admin: Client; // everything incl. finance.view, audit.view, reports.export
let manager: Client; // order_manager: dashboard.view + reports.view, no finance, no export
let accountant: Client; // finance.view + reports.export, no audit.view

const move = (id: string, status: string, reason?: string) => admin.post(`/api/v1/orders/${id}/status`, { status, reason });
async function deliver(id: string) {
  for (const s of ["CONFIRMED", "READY_TO_SHIP", "SHIPPED", "DELIVERED"]) expect((await move(id, s)).status).toBe(200);
}
const today = dhakaDate();
const summary = async (c: Client, qs = "") => {
  const res = await c.get(`/api/v1/dashboard/summary${qs}`);
  expect(res.status).toBe(200);
  return res.body.data;
};
const delta = (after: string, before: string) => money(after).minus(money(before)).toFixed(2);

beforeAll(async () => {
  admin = await staff(["admin"]);
  manager = await staff(["order_manager"]);
  accountant = await staff(["accountant"]);
});

describe("dashboard summary", () => {
  it("counts placed / delivered / cancelled orders and moves the money KPIs by exactly the right amounts", async () => {
    const before = await summary(admin);
    const product = await makeProduct(admin, { price: "2000", cost: "900", stock: [20] });
    const v = product.variants[0].id;
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const res = await makeOrder(admin, v, { channel: "FACEBOOK" });
      expect(res.status).toBe(201);
      ids.push(res.body.data.id);
    }
    const [deliveredId, cancelledId] = ids;
    await deliver(deliveredId);
    expect((await move(cancelledId, "CANCELLED", "Customer changed mind")).status).toBe(200);

    const category = await prisma.expenseCategory.findFirstOrThrow({ where: { type: "ADVERTISING" } });
    const exp = await admin.post("/api/v1/finance/expenses", { categoryId: category.id, amount: "750", date: today, description: "Boosted post" });
    expect(exp.status).toBe(201);

    const after = await summary(admin);
    expect(after.range.to).toBe(today);
    expect(after.totalOrders - before.totalOrders).toBe(3);
    expect(after.ordersToday - before.ordersToday).toBe(3);
    expect(after.delivered - before.delivered).toBe(1);
    expect(after.deliveredInRange - before.deliveredInRange).toBe(1);
    expect(after.cancelled - before.cancelled).toBe(1);
    expect(after.everConfirmed - before.everConfirmed).toBe(1);
    expect(after.pending + after.awaitingConfirmation - before.pending - before.awaitingConfirmation).toBe(1);
    expect(after.returned - before.returned).toBe(0);

    const orders = await prisma.order.findMany({ where: { id: { in: ids } } });
    const byId = new Map(orders.map((o) => [o.id, o]));
    const d = byId.get(deliveredId)!;
    const nonCancelled = orders.filter((o) => o.id !== cancelledId).reduce((acc, o) => acc.plus(o.total), money(0));
    expect(delta(after.grossSales, before.grossSales)).toBe(nonCancelled.toFixed(2));
    expect(delta(after.deliveredSales, before.deliveredSales)).toBe(money(d.subtotal).minus(d.discountTotal).plus(d.deliveryCharge).toFixed(2));
    expect(delta(after.productCost, before.productCost)).toBe(d.productCostTotal.toFixed(2));
    expect(delta(after.advertisingSpend, before.advertisingSpend)).toBe("750.00");
    // gross profit moves by revenue − COGS; net profit additionally by packaging and ads
    expect(delta(after.grossProfit, before.grossProfit)).toBe(money(d.subtotal).minus(d.discountTotal).plus(d.deliveryCharge).minus(d.productCostTotal).toFixed(2));
    expect(delta(after.estimatedNetProfit, before.estimatedNetProfit)).toBe(
      money(d.subtotal).minus(d.discountTotal).plus(d.deliveryCharge).minus(d.productCostTotal).minus(d.packagingCost).minus(750).toFixed(2),
    );
    expect(after.definitions.totalOrders).toMatch(/placed/i);
    expect(after.definitions.scope).toMatch(/current status/i);

    // channel filter: only FACEBOOK orders count, and net profit is not available for a filtered view
    const fb = await summary(admin, "?channel=FACEBOOK");
    expect(fb.totalOrders).toBeGreaterThanOrEqual(3);
    expect(fb.estimatedNetProfit).toBeNull();
    const web = await summary(admin, "?channel=WEBSITE");
    expect(web.totalOrders).toBeLessThan(after.totalOrders);
    const byProduct = await summary(admin, `?productId=${product.id}`);
    expect(byProduct.totalOrders).toBe(3);
    expect(byProduct.delivered).toBe(1);
    expect(byProduct.deliveredSales).toBe(money(d.subtotal).minus(d.discountTotal).plus(d.deliveryCharge).toFixed(2));
  });

  it("hides every financial value without finance.view", async () => {
    const s = await summary(manager);
    expect(s.financeVisible).toBe(false);
    expect(typeof s.totalOrders).toBe("number");
    for (const k of ["grossSales", "deliveredSales", "collectedPayments", "outstandingCod", "advertisingSpend", "productCost", "courierExpenses", "returnCosts", "grossProfit", "estimatedNetProfit"]) {
      expect(s).not.toHaveProperty(k);
      expect(s.definitions).not.toHaveProperty(k);
    }
    const marketingOnly = await staff(["confirmation_agent"]); // no dashboard.view
    expect((await marketingOnly.get("/api/v1/dashboard/summary")).status).toBe(403);
  });

  it("validates the date range", async () => {
    expect((await admin.get("/api/v1/dashboard/summary?from=2026-02-10&to=2026-02-01")).status).toBe(400);
    expect((await admin.get("/api/v1/dashboard/summary?from=10-02-2026")).status).toBe(422);
  });
});

describe("dashboard charts", () => {
  it("buckets by Asia/Dhaka day, not UTC day", async () => {
    const product = await makeProduct(admin, { stock: [5] });
    const id = (await makeOrder(admin, product.variants[0].id)).body.data.id;
    // 2026-01-14 19:30 UTC is 2026-01-15 01:30 in Dhaka
    await prisma.order.update({ where: { id }, data: { createdAt: new Date("2026-01-14T19:30:00.000Z") } });

    const res = await admin.get("/api/v1/dashboard/charts?from=2026-01-14&to=2026-01-15&granularity=day");
    expect(res.status).toBe(200);
    const series = res.body.data.series.ordersOverTime;
    expect(series.map((b: { bucket: string }) => b.bucket)).toEqual(["2026-01-14", "2026-01-15"]);
    expect(series[0].placed).toBe(0);
    expect(series[1].placed).toBe(1);
    const sales = res.body.data.series.salesOverTime;
    const order = await prisma.order.findUniqueOrThrow({ where: { id } });
    expect(sales[1].placedValue).toBe(order.total.toFixed(2));

    const monthly = await admin.get("/api/v1/dashboard/charts?from=2026-01-01&to=2026-03-31&granularity=month");
    expect(monthly.body.data.series.ordersOverTime.map((b: { bucket: string }) => b.bucket)).toEqual(["2026-01", "2026-02", "2026-03"]);
    expect(monthly.body.data.series.ordersOverTime[0].placed).toBe(1);
  });

  it("returns default 30-day series with rates and product lists; financial series only with finance.view", async () => {
    const res = await admin.get("/api/v1/dashboard/charts");
    expect(res.status).toBe(200);
    const s = res.body.data.series;
    expect(s.ordersOverTime).toHaveLength(30);
    expect(s.ordersOverTime.at(-1).bucket).toBe(today);
    expect(s.ordersOverTime.at(-1).placed).toBeGreaterThanOrEqual(3);
    expect(s.ordersOverTime.at(-1).delivered).toBeGreaterThanOrEqual(1);
    expect(s.cancellationRate.cancelled).toBeGreaterThanOrEqual(1);
    expect(s.cancellationRate.ratePct).toBeGreaterThan(0);
    expect(Array.isArray(s.bestSelling)).toBe(true);
    expect(s.bestSelling.length).toBeGreaterThan(0);
    expect(Array.isArray(s.slowMoving)).toBe(true);
    for (const k of ["salesOverTime", "salesVsExpenses", "revenueByProduct", "revenueByChannel", "revenueByCourier", "averageOrderValue", "adCostPerDeliveredOrder", "customerAcquisitionCost", "productProfitability"]) {
      expect(s).toHaveProperty(k);
    }
    expect(s.revenueByChannel.find((c: { channel: string }) => c.channel === "FACEBOOK")).toBeTruthy();
    expect(Number(s.adCostPerDeliveredOrder.adSpend)).toBeGreaterThanOrEqual(750);

    const weekly = await admin.get("/api/v1/dashboard/charts?granularity=week");
    expect(weekly.status).toBe(200);
    // ISO weeks start on Monday
    for (const b of weekly.body.data.series.ordersOverTime) expect(new Date(`${b.start}T00:00:00Z`).getUTCDay()).toBe(1);

    const limited = await manager.get("/api/v1/dashboard/charts");
    expect(limited.status).toBe(200);
    expect(limited.body.data.series).toHaveProperty("ordersOverTime");
    expect(limited.body.data.series).not.toHaveProperty("salesOverTime");
    expect(limited.body.data.series).not.toHaveProperty("productProfitability");
    expect(limited.body.data.series.bestSelling[0]).not.toHaveProperty("revenue");
  });
});

describe("reports", () => {
  it("lists report types and rejects unknown types", async () => {
    const list = await manager.get("/api/v1/reports");
    expect(list.status).toBe(200);
    expect(list.body.data.find((r: { type: string }) => r.type === "profit-and-loss").available).toBe(false);
    expect((await admin.get("/api/v1/reports/nope")).status).toBe(422);
  });

  it("orders report paginates and strips money columns without finance.view", async () => {
    const full = await admin.get(`/api/v1/reports/orders?from=${today}&to=${today}&pageSize=2`);
    expect(full.status).toBe(200);
    expect(full.body.data.rows.length).toBeLessThanOrEqual(2);
    expect(full.body.meta.total).toBeGreaterThanOrEqual(3);
    expect(full.body.meta.pageSize).toBe(2);
    expect(full.body.data.columns.map((c: { key: string }) => c.key)).toContain("total");
    expect(full.body.data.rows[0]).toHaveProperty("total");
    expect(full.body.data.totals).toHaveProperty("grossSales");

    const limited = await manager.get(`/api/v1/reports/orders?from=${today}&to=${today}`);
    expect(limited.status).toBe(200);
    expect(limited.body.data.columns.map((c: { key: string }) => c.key)).not.toContain("total");
    expect(limited.body.data.rows[0]).not.toHaveProperty("total");
    expect(limited.body.data.rows[0]).not.toHaveProperty("productCost");
    expect(limited.body.data.totals).not.toHaveProperty("grossSales");
    expect(limited.body.data.totals.orders).toBe(full.body.meta.total);
  });

  it("delivered-sales and product-sales agree with the orders that were delivered", async () => {
    const product = await makeProduct(admin, { price: "1500", cost: "600", stock: [10] });
    const id = (await makeOrder(admin, product.variants[0].id, {}, 2)).body.data.id;
    await deliver(id);
    const order = await prisma.order.findUniqueOrThrow({ where: { id } });

    const ds = await admin.get(`/api/v1/reports/delivered-sales?from=${today}&to=${today}&pageSize=200`);
    expect(ds.status).toBe(200);
    const row = ds.body.data.rows.find((r: { orderNumber: string }) => r.orderNumber === order.orderNumber);
    expect(row.productRevenue).toBe(money(order.subtotal).minus(order.discountTotal).toFixed(2));
    expect(row.productCost).toBe("1200.00");

    const ps = await admin.get(`/api/v1/reports/product-sales?from=${today}&to=${today}&productId=${product.id}`);
    expect(ps.status).toBe(200);
    expect(ps.body.data.rows).toHaveLength(1);
    expect(ps.body.data.rows[0]).toMatchObject({ unitsOrdered: 2, unitsDelivered: 2, deliveredCost: "1200.00" });
    expect(ps.body.data.rows[0].deliveredProfit).toBe(money(ps.body.data.rows[0].deliveredRevenue).minus(1200).toFixed(2));
  });

  it("marketing report groups by last-touch campaign and computes delivered-order ROAS from matched platform spend", async () => {
    const u = unique();
    const product = await makeProduct(admin, { price: "1000", cost: "400", stock: [10] });
    const ids = [(await makeOrder(admin, product.variants[0].id)).body.data.id, (await makeOrder(admin, product.variants[0].id)).body.data.id];
    for (const orderId of ids) await prisma.marketingAttribution.create({ data: { orderId, lastSource: "facebook", lastCampaign: `eid-${u}`, campaignId: `cid-${u}` } });
    await deliver(ids[0]);
    expect((await move(ids[1], "CANCELLED", "Fake order")).status).toBe(200);
    const date = new Date(`${today}T00:00:00.000Z`);
    await prisma.adSpendRecord.create({ data: { platform: "META", date, campaignId: `cid-${u}`, campaignName: `Eid Collection ${u}`, spend: "500" } });
    await prisma.adSpendRecord.create({ data: { platform: "META", date, campaignId: `orphan-${u}`, campaignName: `Orphan ${u}`, spend: "120" } });

    const res = await admin.get(`/api/v1/reports/marketing?from=${today}&to=${today}`);
    expect(res.status).toBe(200);
    const row = res.body.data.rows.find((r: { campaign: string }) => r.campaign === `eid-${u}`);
    const delivered = await prisma.order.findUniqueOrThrow({ where: { id: ids[0] } });
    const revenue = money(delivered.subtotal).minus(delivered.discountTotal).plus(delivered.deliveryCharge);
    expect(row).toMatchObject({ source: "facebook", orders: 2, delivered: 1, cancelled: 1, adSpend: "500.00" });
    expect(row.deliveredRevenue).toBe(revenue.toFixed(2));
    expect(row.deliveredRoas).toBe(revenue.dividedBy(500).toFixed(2));
    const orphan = res.body.data.rows.find((r: { campaign: string }) => r.campaign === `Orphan ${u}`);
    expect(orphan).toMatchObject({ source: "(unattributed ad spend)", adSpend: "120.00" });
    expect(res.body.data.columns.find((c: { key: string }) => c.key === "deliveredRoas").label).toBe("Delivered-order ROAS");

    const limited = await manager.get(`/api/v1/reports/marketing?from=${today}&to=${today}`);
    const lrow = limited.body.data.rows.find((r: { campaign: string }) => r.campaign === `eid-${u}`);
    expect(lrow).toMatchObject({ delivered: 1 });
    expect(lrow).not.toHaveProperty("adSpend");
    expect(lrow).not.toHaveProperty("deliveredRoas");
  });

  it("enforces per-report permissions (P&L needs finance.view, staff-activity needs audit.view)", async () => {
    expect((await manager.get("/api/v1/reports/profit-and-loss")).status).toBe(403);
    expect((await manager.get("/api/v1/reports/expenses")).status).toBe(403);
    const pnl = await accountant.get(`/api/v1/reports/profit-and-loss?from=${today}&to=${today}`);
    expect(pnl.status).toBe(200);
    const s = await summary(admin, `?from=${today}&to=${today}`);
    expect(pnl.body.data.totals.netProfit).toBe(s.estimatedNetProfit);

    expect((await accountant.get("/api/v1/reports/staff-activity")).status).toBe(403);
    const staffRes = await admin.get(`/api/v1/reports/staff-activity?from=${today}&to=${today}`);
    expect(staffRes.status).toBe(200);
    const me = staffRes.body.data.rows.find((r: { email: string }) => r.email === admin.email);
    expect(me.statusChanges).toBeGreaterThan(0);
    expect(me.ordersCreated).toBeGreaterThan(0);
    expect(me.confirmed).toBeGreaterThan(0);
  });

  it("returns, inventory, customers, courier-performance and purchases reports run", async () => {
    for (const type of ["returns", "inventory", "customers", "courier-performance", "purchases", "cod-settlement", "expenses"]) {
      const res = await admin.get(`/api/v1/reports/${type}?from=${today}&to=${today}`);
      expect(res.status, type).toBe(200);
      expect(Array.isArray(res.body.data.rows)).toBe(true);
      expect(res.body.data.totals).toBeTypeOf("object");
    }
    const inv = await admin.get(`/api/v1/reports/inventory?pageSize=200`);
    expect(inv.body.data.totals.variants).toBeGreaterThan(0);
    expect(inv.body.data.totals).toHaveProperty("stockValue");
    const cust = await admin.get(`/api/v1/reports/customers?from=${today}&to=${today}`);
    expect(cust.body.data.totals.newCustomers).toBeGreaterThan(0);
    const exp = await admin.get(`/api/v1/reports/expenses?from=${today}&to=${today}`);
    expect(money(exp.body.data.totals.amount).greaterThanOrEqualTo(750)).toBe(true);
  });
});

describe("report export", () => {
  it("requires reports.export", async () => {
    expect((await manager.get("/api/v1/reports/orders/export")).status).toBe(403);
  });

  it("exports CSV with BOM, escapes formula injection and writes an audit entry", async () => {
    const product = await makeProduct(admin, { stock: [5] });
    const res0 = await makeOrder(admin, product.variants[0].id, { customer: { name: "=HYPERLINK(\"http://evil\",\"x\")", phone: `017${String(Date.now()).slice(-8)}` } });
    expect(res0.status).toBe(201);

    const before = await prisma.auditLog.count({ where: { action: "report.exported" } });
    const res = await accountant.get(`/api/v1/reports/orders/export?format=csv&from=${today}&to=${today}`).buffer(true).parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on("data", (c: Buffer) => chunks.push(c));
      r.on("end", () => cb(null, Buffer.concat(chunks)));
    });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    const body = (res.body as Buffer).toString("utf8");
    expect(body.charCodeAt(0)).toBe(0xfeff);
    const lines = body.slice(1).split("\n");
    expect(lines[0]).toContain("Order,Placed (Dhaka),Status");
    expect(lines[0]).toContain("Order total");
    expect(body).toContain(`"'=HYPERLINK(""http://evil"",""x"")"`);
    expect(body).not.toMatch(/(^|,)=HYPERLINK/m);
    expect(body).toContain("Totals");

    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: "report.exported" }, orderBy: { createdAt: "desc" } });
    expect(await prisma.auditLog.count({ where: { action: "report.exported" } })).toBe(before + 1);
    expect(log.entityId).toBe("orders");
    expect(log.userId).toBe(accountant.user.id);
  });

  it("exports XLSX and still applies per-report permissions", async () => {
    const res = await accountant.get(`/api/v1/reports/product-sales/export?format=xlsx&from=${today}&to=${today}`).buffer(true).parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on("data", (c: Buffer) => chunks.push(c));
      r.on("end", () => cb(null, Buffer.concat(chunks)));
    });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("spreadsheetml");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body as never);
    const ws = wb.worksheets[0];
    expect(ws.getRow(2).getCell(1).value).toBe("Product");
    expect(ws.rowCount).toBeGreaterThan(2);
    expect(wb.getWorksheet("Totals")).toBeTruthy();

    expect((await accountant.get("/api/v1/reports/staff-activity/export")).status).toBe(403);
  });
});
