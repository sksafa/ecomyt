import { z } from "zod";
import { createModule, dateRangeQuery, idParam, moneySchema, pageMeta, pageQuery, withMeta } from "../../http/route.js";
import { prisma, Prisma } from "../../lib/prisma.js";
import { assertFound, badRequest, conflict, forbidden, unprocessable } from "../../lib/errors.js";
import { audit } from "../../lib/audit.js";
import { encrypt, encryptJson, decryptJson, hmacSha256, randomToken, decrypt } from "../../lib/crypto.js";
import { money, sum } from "../../lib/money.js";
import { dhakaRange } from "../../lib/time.js";
import { env, isProd } from "../../config/env.js";
import type { AuthUser } from "../../middleware/auth.js";
import type { Actor } from "../orders/orders.service.js";
import { postEntries } from "../finance/ledger.service.js";
import { contextFor, getAdapter, listAdapters } from "./registry.js";
import * as shipments from "./shipments.service.js";
import { nextSettlementRef } from "./settlement-number.js";

export const couriersModule = createModule("/couriers", "Couriers & shipments");
export const webhooksModule = createModule("/webhooks", "Webhooks");
const { route } = couriersModule;

const actorOf = (user: AuthUser, ip: string): Actor => ({ userId: user.id, permissions: user.permissions, source: "USER", ip });

// ───────────── providers ─────────────

route({
  method: "get",
  path: "/providers",
  summary: "Courier providers with capabilities (credentials are never returned)",
  access: "shipments.view",
  handler: async () => {
    const providers = await prisma.courierProvider.findMany({ orderBy: [{ isDefault: "desc" }, { name: "asc" }] });
    return providers.map((p) => {
      const adapter = getAdapter(p.code);
      const creds = decryptJson<Record<string, string>>(p.credentials) ?? {};
      return {
        id: p.id, code: p.code, name: p.name, isEnabled: p.isEnabled, isDefault: p.isDefault, sandbox: p.sandbox,
        implemented: !!adapter,
        docsUrl: adapter?.docsUrl ?? null,
        capabilities: adapter?.capabilities ?? null,
        unverified: adapter?.unverified ?? [],
        notes: adapter?.notes ?? (adapter ? [] : ["Not implemented: no public official API documentation was found. Bookings must be made in the courier portal."]),
        webhookConfirmedViaApi: !!adapter?.confirmWebhooksViaApi,
        statusMap: adapter?.statusMap ?? null,
        credentialFields: (adapter?.credentialFields ?? []).map((f) => ({ ...f, configured: !!creds[f.key] })),
        webhookConfigured: !!p.webhookSecret,
        webhookUrl: `${env.API_PUBLIC_URL}/api/v1/webhooks/couriers/${p.code.toLowerCase()}`,
        config: p.config,
      };
    });
  },
});

route({
  method: "put",
  path: "/providers/:id",
  summary: "Enable/disable a provider, set default, store credentials (encrypted) and config",
  description: "Credential values left empty keep the stored value. Secrets are encrypted with AES-256-GCM and never returned.",
  access: "couriers.manage",
  params: idParam,
  body: z.object({
    isEnabled: z.boolean().optional(),
    isDefault: z.boolean().optional(),
    sandbox: z.boolean().optional(),
    credentials: z.record(z.string(), z.string().max(500)).optional(),
    config: z.record(z.string(), z.unknown()).optional(),
    rotateWebhookSecret: z.boolean().optional(),
  }),
  handler: async ({ params, body, user, ip }) => {
    const p = assertFound(await prisma.courierProvider.findUnique({ where: { id: params.id } }), "Courier provider");
    const adapter = getAdapter(p.code);
    if (body.isEnabled && !adapter) throw unprocessable("PROVIDER_NOT_IMPLEMENTED", `${p.name} integration is not implemented yet`);
    if (p.code === "MOCK" && body.isEnabled && isProd) throw forbidden("The sandbox courier cannot be enabled in production");

    let credentials = p.credentials;
    if (body.credentials) {
      const current = decryptJson<Record<string, string>>(p.credentials) ?? {};
      const next = { ...current };
      for (const [k, v] of Object.entries(body.credentials)) if (v !== "") next[k] = v;
      const missing = (adapter?.credentialFields ?? []).filter((f) => f.required && !next[f.key]).map((f) => f.label);
      if ((body.isEnabled ?? p.isEnabled) && missing.length) throw badRequest(`Missing credentials: ${missing.join(", ")}`);
      credentials = encryptJson(next);
    } else if (body.isEnabled && adapter) {
      const current = decryptJson<Record<string, string>>(p.credentials) ?? {};
      const missing = adapter.credentialFields.filter((f) => f.required && !current[f.key]).map((f) => f.label);
      if (missing.length) throw badRequest(`Missing credentials: ${missing.join(", ")}`);
    }
    let newSecret: string | null = null;
    if (body.rotateWebhookSecret) newSecret = randomToken(24);

    const updated = await prisma.$transaction(async (tx) => {
      if (body.isDefault) await tx.courierProvider.updateMany({ where: { id: { not: p.id } }, data: { isDefault: false } });
      const u = await tx.courierProvider.update({
        where: { id: p.id },
        data: {
          isEnabled: body.isEnabled, isDefault: body.isDefault, sandbox: body.sandbox, credentials,
          ...(body.config ? { config: { ...(p.config as object), ...body.config } as Prisma.InputJsonValue } : {}),
          ...(newSecret ? { webhookSecret: encrypt(newSecret) } : {}),
        },
      });
      await audit(tx, {
        userId: user.id, action: "courier.provider_updated", entityType: "CourierProvider", entityId: p.id,
        before: { isEnabled: p.isEnabled, isDefault: p.isDefault, sandbox: p.sandbox },
        after: { isEnabled: u.isEnabled, isDefault: u.isDefault, sandbox: u.sandbox, credentialsChanged: !!body.credentials, webhookSecretRotated: !!newSecret, config: body.config ?? null },
        ip,
      });
      return u;
    });
    // the webhook secret is shown exactly once, so it can be pasted into the courier portal
    return { id: updated.id, isEnabled: updated.isEnabled, isDefault: updated.isDefault, sandbox: updated.sandbox, ...(newSecret ? { webhookSecret: newSecret } : {}) };
  },
});

route({
  method: "get",
  path: "/providers/:id/logs",
  summary: "Courier API call log (redacted)",
  access: "couriers.manage",
  params: idParam,
  query: pageQuery,
  handler: async ({ params, query }) => {
    const where = { providerId: params.id };
    const [rows, total] = await Promise.all([
      prisma.courierApiLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
      prisma.courierApiLog.count({ where }),
    ]);
    return withMeta(rows, pageMeta(query.page, query.pageSize, total));
  },
});

route({
  method: "get",
  path: "/performance",
  summary: "Delivery success rate and cost by courier",
  access: "shipments.view",
  query: dateRangeQuery,
  handler: async ({ query, user }) => {
    const range = dhakaRange(query.from, query.to);
    const rows = await prisma.shipment.groupBy({
      by: ["providerId", "status"],
      where: { isReturn: false, ...(range.gte || range.lt ? { createdAt: range } : {}) },
      _count: { _all: true },
      _sum: { deliveryFee: true, codCharge: true, returnFee: true, collectedAmount: true },
    });
    const providers = await prisma.courierProvider.findMany({ select: { id: true, name: true, code: true } });
    const finance = user.permissions.has("finance.view");
    return providers
      .map((p) => {
        const mine = rows.filter((r) => r.providerId === p.id);
        const count = (statuses: string[]) => mine.filter((r) => statuses.includes(r.status)).reduce((n, r) => n + r._count._all, 0);
        const delivered = count(["DELIVERED", "PARTIALLY_DELIVERED"]);
        const returned = count(["RETURNED", "RETURNING"]);
        const total = mine.reduce((n, r) => n + r._count._all, 0);
        const finished = delivered + returned;
        return {
          provider: p,
          shipments: total,
          delivered,
          returned,
          inFlight: count(["BOOKED", "PICKED_UP", "IN_TRANSIT"]),
          failedBookings: count(["FAILED"]),
          successRate: finished ? Math.round((delivered / finished) * 1000) / 10 : null,
          ...(finance
            ? {
                deliveryFees: sum(mine.map((r) => r._sum.deliveryFee)).toFixed(2),
                codCharges: sum(mine.map((r) => r._sum.codCharge)).toFixed(2),
                returnFees: sum(mine.map((r) => r._sum.returnFee)).toFixed(2),
                avgCostPerDelivered: delivered ? sum(mine.map((r) => money(r._sum.deliveryFee).plus(money(r._sum.codCharge)).plus(money(r._sum.returnFee)))).dividedBy(delivered).toFixed(2) : null,
              }
            : {}),
        };
      })
      .filter((r) => r.shipments > 0);
  },
});

// ───────────── shipments ─────────────

route({
  method: "get",
  path: "/shipments",
  summary: "List shipments",
  access: "shipments.view",
  query: pageQuery.merge(dateRangeQuery).extend({ status: z.string().optional(), providerId: z.string().optional(), q: z.string().optional(), unsettled: z.enum(["true"]).optional() }),
  handler: async ({ query }) => {
    const range = dhakaRange(query.from, query.to);
    const where: Prisma.ShipmentWhereInput = {
      ...(query.status ? { status: { in: query.status.split(",") as never } } : {}),
      ...(query.providerId ? { providerId: query.providerId } : {}),
      ...(range.gte || range.lt ? { createdAt: range } : {}),
      ...(query.q ? { OR: [{ trackingCode: query.q }, { consignmentId: query.q }, { order: { orderNumber: query.q.toUpperCase() } }] } : {}),
      ...(query.unsettled ? { settlementItem: null, status: { in: ["DELIVERED", "PARTIALLY_DELIVERED", "RETURNED"] } } : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.shipment.findMany({
        where, orderBy: { createdAt: "desc" }, skip: (query.page - 1) * query.pageSize, take: query.pageSize,
        include: { provider: { select: { id: true, name: true, code: true } }, order: { select: { id: true, orderNumber: true, shippingName: true, shippingPhone: true, status: true } }, settlementItem: { select: { settlementId: true } } },
      }),
      prisma.shipment.count({ where }),
    ]);
    return withMeta(rows, pageMeta(query.page, query.pageSize, total));
  },
});

route({
  method: "post",
  path: "/shipments",
  summary: "Book a courier shipment for an order",
  description: "Safe to repeat: an order can only have one live forward shipment. Temporary courier failures are retried with backoff.",
  access: "shipments.book",
  status: 201,
  body: z.object({ orderId: z.string(), providerId: z.string().nullish(), weightGrams: z.number().int().min(50).max(50_000).optional(), note: z.string().max(300).nullish() }),
  handler: async ({ body, user, ip }) => {
    const r = await shipments.bookShipment(body.orderId, body, actorOf(user, ip));
    return { ...r.shipment, alreadyBooked: r.alreadyBooked, pending: r.pending };
  },
});

route({
  method: "post",
  path: "/shipments/bulk",
  summary: "Book shipments for many orders (per-order results)",
  access: ["shipments.book", "orders.bulk"],
  body: z.object({ orderIds: z.array(z.string()).min(1).max(200), providerId: z.string().nullish() }),
  handler: async ({ body, user, ip }) => {
    const results = [];
    for (const orderId of body.orderIds) {
      try {
        const r = await shipments.bookShipment(orderId, { providerId: body.providerId }, actorOf(user, ip));
        results.push({ orderId, ok: r.shipment.status !== "FAILED", status: r.shipment.status, trackingCode: r.shipment.trackingCode, alreadyBooked: r.alreadyBooked, error: r.shipment.lastError });
      } catch (err) {
        results.push({ orderId, ok: false, error: (err as Error).message });
      }
    }
    return { succeeded: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results };
  },
});

route({
  method: "get",
  path: "/shipments/:id",
  summary: "Shipment with event timeline and API log",
  access: "shipments.view",
  params: idParam,
  handler: async ({ params, user }) => {
    const s = assertFound(
      await prisma.shipment.findUnique({
        where: { id: params.id },
        include: {
          provider: { select: { id: true, name: true, code: true } },
          order: { select: { id: true, orderNumber: true, status: true } },
          events: { orderBy: { occurredAt: "asc" } },
          ...(user.permissions.has("couriers.manage") ? { apiLogs: { orderBy: { createdAt: "desc" as const }, take: 50 } } : {}),
        },
      }),
      "Shipment",
    );
    return s;
  },
});

route({
  method: "post",
  path: "/shipments/:id/retry",
  summary: "Retry a pending or failed booking now",
  access: "shipments.book",
  params: idParam,
  handler: async ({ params, user, ip }) => {
    const s = assertFound(await prisma.shipment.findUnique({ where: { id: params.id }, include: { order: true } }), "Shipment");
    if (s.status === "FAILED") {
      // a failed shipment is closed; book a fresh one (new reference) for the order
      const r = await shipments.bookShipment(s.orderId, { providerId: s.providerId }, actorOf(user, ip));
      return r.shipment;
    }
    if (s.status !== "PENDING") throw conflict(`Shipment is already ${s.status}`);
    return shipments.attemptBooking(s.id, shipments.referenceFor(s.idempotencyKey, s.order.orderNumber), actorOf(user, ip));
  },
});

route({
  method: "get",
  path: "/shipments/:id/label",
  summary: "Courier shipping label URL (only for providers that support labels)",
  access: "shipments.view",
  params: idParam,
  handler: async ({ params }) => {
    const s = assertFound(await prisma.shipment.findUnique({ where: { id: params.id }, include: { provider: true, order: true } }), "Shipment");
    const adapter = getAdapter(s.provider.code);
    if (!adapter?.label || !adapter.capabilities.labels) return { supported: false, url: null, message: `${s.provider.name} does not provide labels via API – use the printable label from the order screen` };
    const url = await adapter.label(contextFor(s.provider, s.id), { consignmentId: s.consignmentId, trackingCode: s.trackingCode, merchantReference: s.order.orderNumber });
    await prisma.shipment.update({ where: { id: s.id }, data: { labelUrl: url } });
    return { supported: true, url };
  },
});

route({
  method: "post",
  path: "/shipments/:id/sync",
  summary: "Fetch the latest status from the courier",
  access: "shipments.view",
  params: idParam,
  handler: async ({ params }) => {
    const r = await shipments.syncShipment(params.id);
    return { applied: r.applied, status: r.shipment.status };
  },
});

route({
  method: "post",
  path: "/shipments/:id/cancel",
  summary: "Cancel a shipment at the courier (or mark it cancelled after cancelling in the courier portal)",
  access: "shipments.cancel",
  params: idParam,
  body: z.object({ reason: z.string().trim().min(3).max(300), manual: z.boolean().default(false) }),
  handler: async ({ params, body, user, ip }) => shipments.cancelShipment(params.id, body.reason, actorOf(user, ip), { manual: body.manual }),
});

// ───────────── sandbox simulation ─────────────

route({
  method: "post",
  path: "/mock/simulate",
  summary: "Sandbox only: simulate a courier status update through the signed webhook pipeline",
  access: "shipments.book",
  body: z.object({
    shipmentId: z.string(),
    status: z.enum(["picked_up", "in_transit", "delivered", "partial_delivered", "returning", "returned", "cancelled", "hold"]),
    collectedAmount: moneySchema.optional(),
    deliveryCharge: moneySchema.optional(),
    returnCharge: moneySchema.optional(),
    eventId: z.string().optional(),
    updatedAt: z.string().datetime().optional(),
  }),
  handler: async ({ body }) => {
    if (isProd) throw forbidden("Simulation is disabled in production");
    const s = assertFound(await prisma.shipment.findUnique({ where: { id: body.shipmentId }, include: { provider: true, order: true } }), "Shipment");
    if (s.provider.code !== "MOCK") throw badRequest("Only sandbox shipments can be simulated");
    let secret = s.provider.webhookSecret ? decrypt(s.provider.webhookSecret) : null;
    if (!secret) {
      secret = randomToken(24);
      await prisma.courierProvider.update({ where: { id: s.providerId }, data: { webhookSecret: encrypt(secret) } });
    }
    const payload = {
      event_id: body.eventId ?? null,
      consignment_id: s.consignmentId,
      tracking_code: s.trackingCode,
      invoice: s.order.orderNumber,
      status: body.status,
      updated_at: body.updatedAt ?? new Date().toISOString(),
      collected_amount: body.collectedAmount ?? (body.status === "delivered" ? s.codAmount.toFixed(2) : null),
      delivery_charge: body.deliveryCharge ?? null,
      return_charge: body.returnCharge ?? null,
    };
    const raw = Buffer.from(JSON.stringify(payload));
    return shipments.handleWebhook("MOCK", { headers: { "x-mock-signature": hmacSha256(secret, raw) }, rawBody: raw, body: payload });
  },
});

// ───────────── COD settlements & reconciliation ─────────────

route({
  method: "get",
  path: "/cod/summary",
  summary: "COD reconciliation: collected by couriers vs settled to us",
  access: ["shipments.view", "finance.view"],
  handler: async () => {
    const providers = await prisma.courierProvider.findMany({ select: { id: true, name: true, code: true } });
    const unsettled = await prisma.shipment.findMany({
      where: { isReturn: false, settlementItem: null, status: { in: ["DELIVERED", "PARTIALLY_DELIVERED", "RETURNED"] } },
      select: { providerId: true, status: true, collectedAmount: true, codAmount: true, deliveryFee: true, codCharge: true, returnFee: true, deliveredAt: true, returnedAt: true },
    });
    return providers
      .map((p) => {
        const mine = unsettled.filter((s) => s.providerId === p.id);
        const collected = sum(mine.filter((s) => s.status !== "RETURNED").map((s) => s.collectedAmount ?? s.codAmount));
        const fees = sum(mine.map((s) => money(s.deliveryFee).plus(money(s.codCharge)).plus(s.status === "RETURNED" ? money(s.returnFee) : 0)));
        const oldest = mine.map((s) => s.deliveredAt ?? s.returnedAt).filter(Boolean).sort((a, b) => a!.getTime() - b!.getTime())[0] ?? null;
        return { provider: p, unsettledShipments: mine.length, codCollected: collected.toFixed(2), knownFees: fees.toFixed(2), expectedPayout: collected.minus(fees).toFixed(2), oldestUnsettledAt: oldest };
      })
      .filter((r) => r.unsettledShipments > 0);
  },
});

route({
  method: "get",
  path: "/settlements",
  summary: "Courier settlements",
  access: ["shipments.view", "finance.view"],
  query: pageQuery,
  handler: async ({ query }) => {
    const [rows, total] = await Promise.all([
      prisma.courierSettlement.findMany({ orderBy: { createdAt: "desc" }, skip: (query.page - 1) * query.pageSize, take: query.pageSize, include: { provider: { select: { name: true, code: true } }, account: { select: { name: true } }, _count: { select: { items: true } } } }),
      prisma.courierSettlement.count(),
    ]);
    return withMeta(rows, pageMeta(query.page, query.pageSize, total));
  },
});

route({
  method: "get",
  path: "/settlements/:id",
  summary: "Settlement details",
  access: ["shipments.view", "finance.view"],
  params: idParam,
  handler: async ({ params }) =>
    assertFound(
      await prisma.courierSettlement.findUnique({
        where: { id: params.id },
        include: { provider: true, account: true, items: { include: { shipment: { select: { trackingCode: true, consignmentId: true, order: { select: { id: true, orderNumber: true } } } } } } },
      }),
      "Settlement",
    ),
});

route({
  method: "post",
  path: "/settlements",
  summary: "Record a courier COD settlement (payout) and reconcile its shipments",
  description:
    "Each shipment can be settled only once. Fees reported here are the actual courier charges; differences from previously booked fees are posted as adjustments. Orders whose money is fully settled become RECONCILED.",
  access: "accounts.reconcile",
  status: 201,
  idempotent: true,
  body: z.object({
    providerId: z.string(),
    reference: z.string().trim().min(1).max(100).optional(),
    periodStart: z.string().datetime().nullish(),
    periodEnd: z.string().datetime().nullish(),
    accountId: z.string(),
    receivedAmount: moneySchema,
    receivedAt: z.string().datetime(),
    note: z.string().max(500).nullish(),
    items: z
      .array(
        z.object({
          shipmentId: z.string().optional(),
          trackingCode: z.string().optional(),
          collected: moneySchema,
          deliveryFee: moneySchema,
          codCharge: moneySchema.default("0"),
          returnFee: moneySchema.default("0"),
        }),
      )
      .min(1)
      .max(2000),
  }),
  handler: async ({ body, user, ip }) => {
    const provider = assertFound(await prisma.courierProvider.findUnique({ where: { id: body.providerId } }), "Courier provider");
    assertFound(await prisma.account.findUnique({ where: { id: body.accountId } }), "Account");
    const reference = body.reference ?? (await nextSettlementRef());

    return prisma.$transaction(
      async (tx) => {
        const resolved = [];
        for (const it of body.items) {
          const s = await tx.shipment.findFirst({
            where: { providerId: provider.id, OR: [...(it.shipmentId ? [{ id: it.shipmentId }] : []), ...(it.trackingCode ? [{ trackingCode: it.trackingCode }, { consignmentId: it.trackingCode }] : [])] },
            include: { settlementItem: true, order: true },
          });
          if (!s) throw badRequest(`Shipment ${it.shipmentId ?? it.trackingCode} not found for ${provider.name}`);
          if (s.settlementItem) throw conflict(`Shipment ${s.trackingCode ?? s.id} (${s.order.orderNumber}) is already settled`);
          resolved.push({ s, it });
        }
        const totalCollected = sum(resolved.map((r) => r.it.collected));
        const totalFees = sum(resolved.map((r) => money(r.it.deliveryFee).plus(r.it.codCharge).plus(r.it.returnFee)));
        const net = totalCollected.minus(totalFees);
        const settlement = await tx.courierSettlement.create({
          data: {
            providerId: provider.id, reference, accountId: body.accountId,
            periodStart: body.periodStart ? new Date(body.periodStart) : null, periodEnd: body.periodEnd ? new Date(body.periodEnd) : null,
            totalCollected, totalFees, netPayable: net, receivedAmount: money(body.receivedAmount),
            status: "RECEIVED", receivedAt: new Date(body.receivedAt), note: body.note ?? null, createdById: user.id,
            items: {
              create: resolved.map(({ s, it }) => ({
                shipmentId: s.id, collected: money(it.collected), deliveryFee: money(it.deliveryFee), codCharge: money(it.codCharge), returnFee: money(it.returnFee),
                net: money(it.collected).minus(money(it.deliveryFee)).minus(money(it.codCharge)).minus(money(it.returnFee)),
              })),
            },
          },
        });

        const date = new Date(body.receivedAt);
        await postEntries(tx, [
          { type: "SETTLEMENT_RECEIVED", amount: money(body.receivedAmount), date, isCash: true, accountId: body.accountId, settlementId: settlement.id, description: `${provider.name} settlement ${reference}`, key: `settlement:${settlement.id}:cash`, createdById: user.id },
        ]);

        for (const { s, it } of resolved) {
          // actual fees: book what was not booked yet, adjust what was booked with a different value
          const prior = await tx.financialEntry.findMany({ where: { shipmentId: s.id, type: { in: ["COURIER_FEE", "COD_FEE", "RETURN_FEE"] } } });
          const booked = (type: string) => sum(prior.filter((p) => p.type === type).map((p) => p.amount)).negated();
          const entries = [
            ["COURIER_FEE", money(it.deliveryFee)],
            ["COD_FEE", money(it.codCharge)],
            ["RETURN_FEE", money(it.returnFee)],
          ] as const;
          for (const [type, actual] of entries) {
            const delta = actual.minus(booked(type));
            if (!delta.isZero()) {
              await postEntries(tx, [{ type, amount: delta.negated(), date, orderId: s.orderId, shipmentId: s.id, settlementId: settlement.id, description: `${type.replace("_", " ").toLowerCase()} per settlement ${reference}`, key: `settlement:${settlement.id}:shipment:${s.id}:${type}` }]);
            }
          }
          await tx.shipment.update({ where: { id: s.id }, data: { deliveryFee: money(it.deliveryFee), codCharge: money(it.codCharge), returnFee: money(it.returnFee), collectedAmount: money(it.collected) } });
          if (["DELIVERED", "RETURNED", "EXCHANGED"].includes(s.order.status)) {
            await tx.order.update({ where: { id: s.orderId }, data: { financeStatus: "RECONCILED" } });
          }
        }

        const variance = money(body.receivedAmount).minus(net);
        await audit(tx, {
          userId: user.id, action: "settlement.recorded", entityType: "CourierSettlement", entityId: settlement.id,
          after: { provider: provider.code, reference, shipments: resolved.length, totalCollected: totalCollected.toFixed(2), totalFees: totalFees.toFixed(2), net: net.toFixed(2), received: body.receivedAmount, variance: variance.toFixed(2) },
          ip,
        });
        return { ...settlement, variance: variance.toFixed(2) };
      },
      { timeout: 60_000 },
    );
  },
});

// ───────────── webhooks ─────────────

webhooksModule.route({
  method: "post",
  path: "/couriers/:code",
  summary: "Courier status webhook (authenticated per provider: HMAC signature, bearer token or shared secret)",
  description: "Unsigned provider webhooks only trigger a status re-check through the courier API.",
  access: "public",
  raw: true,
  params: z.object({ code: z.string().regex(/^[a-z_]+$/) }),
  handler: async ({ req, res, params }) => {
    const result = await shipments.handleWebhook(params.code.toUpperCase(), {
      headers: req.headers as Record<string, string>,
      query: req.query as Record<string, string>,
      rawBody: (req as unknown as { rawBody?: Buffer }).rawBody ?? Buffer.from(JSON.stringify(req.body ?? {})),
      body: req.body,
    });
    if ("handshake" in result && result.handshake) {
      for (const [k, v] of Object.entries(result.handshake.headers ?? {})) res.setHeader(k, v);
      res.status(result.handshake.status).json(result.handshake.body ?? { ok: true });
      return;
    }
    res.status(200).json({ success: true, data: result });
  },
});

export const courierAdapterSummary = () => listAdapters().map((a) => ({ code: a.code, name: a.name, capabilities: a.capabilities }));
