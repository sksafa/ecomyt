import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { staff, unique, type Client } from "./helpers.js";
import { dhakaArea, makeOrder, makeProduct, testPhone } from "./fixtures.js";
import { prisma } from "../src/lib/prisma.js";
import { outbox } from "../src/lib/mailer.js";
import { setSetting } from "../src/lib/settings.js";
import { dhakaDate } from "../src/lib/time.js";
import { createOrder, systemActor } from "../src/modules/orders/orders.service.js";
import { notifyStaff } from "../src/modules/notifications/notify.js";
import { deliverNotification, sendNotification } from "../src/modules/notifications/outbound.service.js";
import { getSmsProvider, LogSmsProvider, setSmsProvider, type SmsProvider } from "../src/modules/notifications/channels.js";
import { interpolate } from "../src/modules/notifications/templates.js";
import { codSettlementReminderJob, dailySummaryJob, lowStockScanJob } from "../src/jobs/scheduled.js";

let admin: Client;
let agent: Client;
let warehouse: Client;
let accountant: Client;
let analyst: Client;

async function waitFor<T>(fn: () => Promise<T | null | undefined | false>, timeoutMs = 3000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v as T;
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 50));
  }
}

class FlakySms implements SmsProvider {
  readonly name = "flaky";
  sent: { to: string; text: string }[] = [];
  failuresLeft = 0;
  async send(to: string, text: string) {
    if (this.failuresLeft > 0) {
      this.failuresLeft--;
      throw new Error("gateway timeout");
    }
    this.sent.push({ to, text });
    return { status: "SENT" as const, providerMessageId: `m${this.sent.length}` };
  }
}

beforeAll(async () => {
  admin = await staff(["admin"]);
  agent = await staff(["confirmation_agent"]);
  warehouse = await staff(["warehouse"]);
  accountant = await staff(["accountant"]);
  analyst = await staff(["analyst"]);
});

afterAll(async () => {
  setSmsProvider(new LogSmsProvider());
  await setSetting("notifications", { customerSmsOnConfirm: false, customerSmsOnShip: false, dailySummaryEmail: "" }, null);
});

describe("templates", () => {
  it("interpolates {{vars}} and blanks unknown ones", () => {
    expect(interpolate("Hi {{ name }}, order {{orderNumber}}{{missing}}", { name: "Rina", orderNumber: "BB1" })).toBe("Hi Rina, order BB1");
  });
});

describe("in-app notifications", () => {
  it("alerts order confirmers about new website orders; list, unread count, read, read-all", async () => {
    const product = await makeProduct(admin, { stock: [50] });
    const area = await dhakaArea();
    const { order } = await createOrder(
      { customer: { name: "Web Buyer", phone: testPhone() }, shipping: { addressLine: "House 1, Road 2, Banani, Dhaka", areaId: area.id }, items: [{ variantId: product.variants[0].id, quantity: 1 }], requirePublished: true },
      systemActor("STOREFRONT"),
    );
    const n = await waitFor(() => prisma.notification.findFirst({ where: { userId: agent.user.id, type: "order.new", link: `/orders/${order.id}` } }));
    expect(n.title).toContain(order.orderNumber);
    // warehouse lacks orders.confirm
    expect(await prisma.notification.count({ where: { userId: warehouse.user.id, type: "order.new", link: `/orders/${order.id}` } })).toBe(0);

    // staff-created orders don't alert
    const manual = await makeOrder(admin, product.variants[0].id);
    await new Promise((r) => setTimeout(r, 300));
    expect(await prisma.notification.count({ where: { type: "order.new", link: `/orders/${manual.body.data.id}` } })).toBe(0);

    await notifyStaff("order.new", { title: "Second", body: "b", dedupeKey: `t-${unique()}` });
    const count = await agent.get("/api/v1/notifications/unread-count");
    expect(count.body.data.count).toBeGreaterThanOrEqual(2);

    const read = await agent.post(`/api/v1/notifications/${n.id}/read`);
    expect(read.status).toBe(200);
    expect(read.body.data.readAt).not.toBeNull();

    const list = await agent.get("/api/v1/notifications?pageSize=50");
    expect(list.status).toBe(200);
    const rows = list.body.data as { id: string; readAt: string | null }[];
    const firstRead = rows.findIndex((r) => r.readAt !== null);
    expect(firstRead).toBeGreaterThan(0); // unread first
    expect(rows.slice(firstRead).every((r) => r.readAt !== null)).toBe(true);
    expect(list.body.meta.unread).toBe(count.body.data.count - 1);

    // other users cannot touch it
    expect((await warehouse.post(`/api/v1/notifications/${n.id}/read`)).status).toBe(404);

    const all = await agent.post("/api/v1/notifications/read-all");
    expect(all.body.data.updated).toBeGreaterThanOrEqual(1);
    expect((await agent.get("/api/v1/notifications/unread-count")).body.data.count).toBe(0);
  });

  it("dedupes staff notifications on dedupeKey", async () => {
    const key = `dup-${unique()}`;
    await notifyStaff("order.new", { title: "Once", body: "b", dedupeKey: key });
    await notifyStaff("order.new", { title: "Once", body: "b", dedupeKey: key });
    expect(await prisma.notification.count({ where: { userId: agent.user.id, dedupeKey: `${key}:${agent.user.id}` } })).toBe(1);
  });
});

describe("outbound notifications", () => {
  it("dedupes on dedupeKey and never re-sends after success (retry-safe)", async () => {
    const sms = new FlakySms();
    sms.failuresLeft = 1;
    setSmsProvider(sms);
    try {
      const key = `sms-${unique()}`;
      const phone = testPhone();
      const vars = { customerName: "Rina", orderNumber: "BB9", total: "৳100" };
      const first = await sendNotification({ channel: "SMS", recipient: `+88${phone}`, type: "order.confirmed", vars, dedupeKey: key });
      expect(first.notification.status).toBe("FAILED"); // inline attempt hit the gateway timeout
      expect(first.notification.recipient).toBe(phone);

      const dup = await sendNotification({ channel: "SMS", recipient: phone, type: "order.confirmed", vars, dedupeKey: key });
      expect(dup.duplicate).toBe(true);

      // worker retry
      expect((await deliverNotification({ notificationId: first.notification.id })).status).toBe("SENT");
      expect((await deliverNotification({ notificationId: first.notification.id })).status).toBe("SENT");
      expect(sms.sent).toHaveLength(1);
      expect(sms.sent[0]).toEqual({ to: `+88${phone}`, text: expect.stringContaining("BB9") });
      const row = await prisma.notification.findUniqueOrThrow({ where: { id: first.notification.id } });
      expect(row).toMatchObject({ status: "SENT", attempts: 2 });
      expect(await prisma.notification.count({ where: { dedupeKey: key } })).toBe(1);
    } finally {
      setSmsProvider(new LogSmsProvider());
    }
  });

  it("respects opt-outs and marks log-only SMS as SKIPPED", async () => {
    const phone = testPhone();
    const opt = await admin.post("/api/v1/notifications/opt-outs", { channel: "SMS", recipient: `+88${phone}`, reason: "Replied STOP" });
    expect(opt.status).toBe(201);
    expect(opt.body.data.recipient).toBe(phone);
    expect((await agent.post("/api/v1/notifications/opt-outs", { channel: "SMS", recipient: phone })).status).toBe(403);

    const log = getSmsProvider() as LogSmsProvider;
    const before = log.sent.length;
    const r = await sendNotification({ channel: "SMS", recipient: phone, type: "order.confirmed", vars: {}, dedupeKey: `optout-${unique()}` });
    expect(r.notification.status).toBe("SKIPPED");
    expect(r.notification.error).toMatch(/opted out/);
    expect(log.sent.length).toBe(before);

    const other = await sendNotification({ channel: "SMS", recipient: testPhone(), type: "order.confirmed", vars: {}, dedupeKey: `log-${unique()}` });
    expect(other.notification.status).toBe("SKIPPED");
    expect(other.notification.error).toMatch(/logged only/);
    expect(log.sent.length).toBe(before + 1);

    const list = await admin.get(`/api/v1/notifications/opt-outs?channel=SMS&q=${phone}`);
    expect(list.body.data).toHaveLength(1);
    expect((await admin.delete(`/api/v1/notifications/opt-outs/${opt.body.data.id}`)).status).toBe(200);

    const outLog = await admin.get("/api/v1/notifications/log?channel=SMS&status=SKIPPED");
    expect(outLog.status).toBe(200);
    expect(outLog.body.data.some((n: { id: string }) => n.id === r.notification.id)).toBe(true);
    expect((await agent.get("/api/v1/notifications/log")).status).toBe(403);
  });

  it("uses DB templates over built-in defaults (Bengali via .bn) and supports template CRUD", async () => {
    const created = await admin.post("/api/v1/notifications/templates", { key: "order.confirmed.bn", channel: "SMS", body: "প্রিয় {{customerName}}, অর্ডার {{orderNumber}} কনফার্ম।" });
    expect(created.status).toBe(201);
    try {
      const r = await sendNotification({ channel: "SMS", recipient: testPhone(), type: "order.confirmed", lang: "bn", vars: { customerName: "রিনা", orderNumber: "BB7" }, dedupeKey: `tpl-${unique()}` });
      expect(r.notification.body).toBe("প্রিয় রিনা, অর্ডার BB7 কনফার্ম।");
      const en = await sendNotification({ channel: "SMS", recipient: testPhone(), type: "order.confirmed", vars: { customerName: "Rina", orderNumber: "BB8", total: "৳10" }, dedupeKey: `tpl-${unique()}` });
      expect(en.notification.body).toMatch(/^Dear Rina, your Bent & Bound order BB8/);

      const upd = await admin.put(`/api/v1/notifications/templates/${created.body.data.id}`, { isActive: false });
      expect(upd.body.data.isActive).toBe(false);
      const list = await admin.get("/api/v1/notifications/templates");
      expect(list.body.data.defaults.map((d: { key: string }) => d.key)).toEqual(expect.arrayContaining(["order.confirmed", "order.shipped", "order.delivered", "daily.summary"]));
      expect((await analyst.get("/api/v1/notifications/templates")).status).toBe(403);
    } finally {
      await admin.delete(`/api/v1/notifications/templates/${created.body.data.id}`);
    }
  });

  it("sends a transactional SMS on confirmation only when enabled in settings", async () => {
    const product = await makeProduct(admin, { stock: [20] });
    const off = await makeOrder(admin, product.variants[0].id);
    await admin.post(`/api/v1/orders/${off.body.data.id}/status`, { status: "CONFIRMED" });
    await new Promise((r) => setTimeout(r, 300));
    expect(await prisma.notification.count({ where: { dedupeKey: `sms:order.confirmed:${off.body.data.id}` } })).toBe(0);

    await setSetting("notifications", { customerSmsOnConfirm: true }, null);
    const on = await makeOrder(admin, product.variants[0].id);
    const res = await admin.post(`/api/v1/orders/${on.body.data.id}/status`, { status: "CONFIRMED" });
    expect(res.status).toBe(200);
    const n = await waitFor(() => prisma.notification.findUnique({ where: { dedupeKey: `sms:order.confirmed:${on.body.data.id}` } }));
    const order = await prisma.order.findUniqueOrThrow({ where: { id: on.body.data.id } });
    expect(n).toMatchObject({ channel: "SMS", recipient: order.shippingPhone, type: "order.confirmed" });
    expect(n.body).toContain(order.orderNumber);
    await setSetting("notifications", { customerSmsOnConfirm: false }, null);
  });
});

describe("scheduled jobs", () => {
  it("daily summary: emails the configured address once and posts an in-app summary", async () => {
    const product = await makeProduct(admin, { stock: [20] });
    await makeOrder(admin, product.variants[0].id);
    await makeOrder(admin, product.variants[0].id);
    const email = `owner-${unique()}@test.local`;
    await setSetting("notifications", { dailySummaryEmail: email }, null);
    const today = dhakaDate();

    const r = await dailySummaryJob({ date: today });
    expect(r.summary.date).toBe(today);
    expect(r.summary.placedCount).toBeGreaterThanOrEqual(2);
    const placed = await prisma.order.findMany({ where: { createdAt: { gte: new Date(`${today}T00:00:00+06:00`), lt: new Date(new Date(`${today}T00:00:00+06:00`).getTime() + 86_400_000) } } });
    expect(r.summary.placedCount).toBe(placed.length);
    const mails = outbox.filter((m) => m.to === email);
    expect(mails).toHaveLength(1);
    expect(mails[0].subject).toBe(`Bent & Bound daily summary – ${today}`);
    expect(mails[0].text).toContain(`Orders placed: ${placed.length}`);

    const inApp = await prisma.notification.findUnique({ where: { dedupeKey: `daily.summary:${today}:${analyst.user.id}` } });
    expect(inApp?.type).toBe("daily.summary");

    const again = await dailySummaryJob({ date: today });
    expect(again.emails[0].duplicate).toBe(true);
    expect(outbox.filter((m) => m.to === email)).toHaveLength(1);
    expect(await prisma.notification.count({ where: { dedupeKey: `daily.summary:${today}:${analyst.user.id}` } })).toBe(1);
  });

  it("low stock: alerts inventory staff once per variant per day", async () => {
    const product = await makeProduct(admin, { stock: [6] }); // threshold 5
    const variantId = product.variants[0].id;
    const res = await makeOrder(admin, variantId, {}, 2); // 4 left
    expect(res.status).toBe(201);
    const key = `low_stock:${variantId}:${dhakaDate()}:${warehouse.user.id}`;
    const n = await waitFor(() => prisma.notification.findUnique({ where: { dedupeKey: key } }));
    expect(n.type).toBe("inventory.low_stock");
    expect(n.body).toContain("4 available");

    const scan = await lowStockScanJob();
    expect(scan.variants).toContain(product.variants[0].sku);
    await makeOrder(admin, variantId);
    await new Promise((r) => setTimeout(r, 300));
    expect(await prisma.notification.count({ where: { userId: warehouse.user.id, dedupeKey: { startsWith: `low_stock:${variantId}:` } } })).toBe(1);
  });

  it("COD settlement reminder for delivered parcels unsettled over 7 days", async () => {
    const product = await makeProduct(admin, { stock: [5] });
    const o = await makeOrder(admin, product.variants[0].id);
    const provider = await prisma.courierProvider.findUniqueOrThrow({ where: { code: "MOCK" } });
    await prisma.shipment.create({
      data: {
        orderId: o.body.data.id, providerId: provider.id, status: "DELIVERED", idempotencyKey: `test-${unique()}`, codAmount: "2340",
        collectedAmount: "2340", weightGrams: 300, deliveredAt: new Date(Date.now() - 10 * 86_400_000),
      },
    });
    const r = await codSettlementReminderJob();
    expect(r.due).toBeGreaterThanOrEqual(1);
    expect(r.byProvider[provider.name].count).toBeGreaterThanOrEqual(1);
    const n = await prisma.notification.findUnique({ where: { dedupeKey: `cod.settlement_due:${dhakaDate()}:${accountant.user.id}` } });
    expect(n?.type).toBe("cod.settlement_due");
  });
});
