import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { app, api, staff, unique, type Client } from "./helpers.js";
import { makeProduct, testPhone } from "./fixtures.js";
import { prisma } from "../src/lib/prisma.js";
import { hashPassword } from "../src/modules/auth/auth.service.js";

// Live order updates over Server-Sent Events: new website orders and status changes reach open admin screens.

let server: http.Server;
let base: string;
let admin: Client;
let variantId: string;

interface Stream {
  events: { event: string; data: Record<string, unknown> }[];
  status: number;
  close: () => void;
  waitFor: (pred: (e: { event: string; data: Record<string, unknown> }) => boolean, ms?: number) => Promise<{ event: string; data: Record<string, unknown> }>;
}

function openStream(token?: string): Promise<Stream> {
  return new Promise((resolve, reject) => {
    const events: Stream["events"] = [];
    const req = http.get(`${base}/api/v1/orders/stream`, { headers: token ? { Authorization: `Bearer ${token}` } : {} }, (res) => {
      let buf = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => {
        buf += chunk;
        let i;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const block = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const event = /^event: (.*)$/m.exec(block)?.[1];
          const data = /^data: (.*)$/m.exec(block)?.[1];
          if (event && data) events.push({ event, data: JSON.parse(data) });
        }
      });
      const stream: Stream = {
        events,
        status: res.statusCode ?? 0,
        close: () => req.destroy(),
        waitFor: async (pred, ms = 4000) => {
          const end = Date.now() + ms;
          for (;;) {
            const hit = events.find(pred);
            if (hit) return hit;
            if (Date.now() > end) throw new Error(`no matching event; got ${JSON.stringify(events)}`);
            await new Promise((r) => setTimeout(r, 30));
          }
        },
      };
      if (res.statusCode !== 200) {
        res.resume();
        return resolve(stream);
      }
      // resolve once the server confirms the subscription
      const t = setInterval(() => {
        if (events.some((e) => e.event === "ready")) {
          clearInterval(t);
          resolve(stream);
        }
      }, 10);
    });
    req.on("error", reject);
  });
}

const checkoutBody = () => ({
  customer: { name: "Live Update Customer", phone: testPhone() },
  shipping: { addressLine: "House 1, Road 2, Banani, Dhaka" },
  items: [{ variantId, quantity: 1 }],
  deliveryOption: "INSIDE_DHAKA",
  paymentMethod: "COD",
});

beforeAll(async () => {
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  admin = await staff(["admin"]);
  variantId = (await makeProduct(admin, { stock: [100] })).variants[0].id;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe("live order stream", () => {
  it("requires a signed-in user with orders.view", async () => {
    const anon = await openStream();
    expect(anon.status).toBe(401);

    const role = await prisma.role.create({ data: { key: `noorders_${unique()}`, name: "No orders" } });
    const email = `noorders-${unique()}@test.local`;
    await prisma.user.create({ data: { email, name: "No Orders", passwordHash: await hashPassword("Passw0rd!"), roles: { create: [{ roleId: role.id }] } } });
    const login = await api.post("/api/v1/auth/login").send({ email, password: "Passw0rd!" });
    const denied = await openStream(login.body.data.token);
    expect(denied.status).toBe(403);
  });

  it("pushes a new website order and its status changes to connected admins", async () => {
    const stream = await openStream(admin.token);
    expect(stream.status).toBe(200);
    try {
      const placed = await api.post("/api/v1/storefront/checkout").set("Idempotency-Key", `live-${unique()}-key`).send(checkoutBody());
      expect(placed.status).toBe(201);
      const created = await stream.waitFor((e) => e.event === "order" && e.data.type === "order.created" && e.data.orderNumber === placed.body.data.orderNumber);
      expect(created.data).toMatchObject({ topic: "orders", channel: "WEBSITE", status: "PENDING", name: "Live Update Customer", total: placed.body.data.total });

      // the list endpoint already returns it when the event arrives (event is sent after commit)
      const list = await admin.get(`/api/v1/orders?q=${placed.body.data.orderNumber}`);
      expect(list.body.data.map((o: { orderNumber: string }) => o.orderNumber)).toEqual([placed.body.data.orderNumber]);

      await admin.post(`/api/v1/orders/${created.data.orderId}/status`, { status: "CONFIRMED" });
      const changed = await stream.waitFor((e) => e.data.type === "order.status_changed" && e.data.orderId === created.data.orderId);
      expect(changed.data).toMatchObject({ from: "PENDING", status: "CONFIRMED" });
    } finally {
      stream.close();
    }
  });

  it("emits one created event for repeated submits of the same checkout", async () => {
    const stream = await openStream(admin.token);
    try {
      const body = checkoutBody();
      const key = `live-dup-${unique()}-key`;
      const rs = await Promise.all([1, 2, 3].map(() => api.post("/api/v1/storefront/checkout").set("Idempotency-Key", key).send(body)));
      const orderNumber = rs[0].body.data.orderNumber;
      await stream.waitFor((e) => e.data.orderNumber === orderNumber);
      await new Promise((r) => setTimeout(r, 400));
      expect(stream.events.filter((e) => e.data.type === "order.created" && e.data.orderNumber === orderNumber)).toHaveLength(1);
      expect(await prisma.order.count({ where: { orderNumber } })).toBe(1);
    } finally {
      stream.close();
    }
  });
});
