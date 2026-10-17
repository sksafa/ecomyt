import { z } from "zod";
import { createModule, dateRangeQuery, idParam, moneySchema, pageMeta, pageQuery, withMeta } from "../../http/route.js";
import { prisma, Prisma } from "../../lib/prisma.js";
import { assertFound, badRequest, unavailable, unprocessable } from "../../lib/errors.js";
import { money } from "../../lib/money.js";
import { dhakaRange } from "../../lib/time.js";
import { randomToken } from "../../lib/crypto.js";
import { audit } from "../../lib/audit.js";
import { logger } from "../../lib/logger.js";
import { env, isProd } from "../../config/env.js";
import type { AuthUser } from "../../middleware/auth.js";
import { systemActor, type Actor } from "../orders/orders.service.js";
import * as payments from "./payments.service.js";
import { gatewayStatus, getGateway, sandboxSignature } from "./gateways.js";

export const paymentsModule = createModule("/payments", "Payments & refunds");
export const refundsModule = createModule("/refunds", "Payments & refunds");
const { route } = paymentsModule;

const actorOf = (user: AuthUser, ip: string): Actor => ({ userId: user.id, permissions: user.permissions, source: "USER", ip });
const methodEnum = z.enum(["COD", "BKASH", "NAGAD", "ROCKET", "SSLCOMMERZ", "CARD", "BANK_TRANSFER", "CASH"]);

route({
  method: "get",
  path: "/",
  summary: "Payment transactions",
  access: "payments.view",
  query: pageQuery.merge(dateRangeQuery).extend({ status: z.string().optional(), method: z.string().optional(), orderId: z.string().optional(), q: z.string().optional() }),
  handler: async ({ query }) => {
    const range = dhakaRange(query.from, query.to);
    const where: Prisma.PaymentWhereInput = {
      ...(query.status ? { status: { in: query.status.split(",") as never } } : {}),
      ...(query.method ? { method: { in: query.method.split(",") as never } } : {}),
      ...(query.orderId ? { orderId: query.orderId } : {}),
      ...(query.q ? { OR: [{ transactionId: query.q }, { order: { orderNumber: query.q.toUpperCase() } }, { senderNumber: query.q }] } : {}),
      ...(range.gte || range.lt ? { createdAt: range } : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.payment.findMany({ where, orderBy: { createdAt: "desc" }, skip: (query.page - 1) * query.pageSize, take: query.pageSize, include: { order: { select: { id: true, orderNumber: true, shippingName: true } }, account: { select: { name: true } } } }),
      prisma.payment.count({ where }),
    ]);
    return withMeta(rows.map((r) => ({ ...r, rawPayload: undefined })), pageMeta(query.page, query.pageSize, total));
  },
});

route({ method: "get", path: "/gateways", summary: "Online gateway configuration status", access: "payments.view", handler: () => gatewayStatus() });

route({
  method: "post",
  path: "/",
  summary: "Record an advance / manual payment (bKash, Nagad, bank, cash…)",
  description: "Duplicate transaction ids are rejected. Unless `verified` is true the payment stays PENDING until verified.",
  access: "payments.record",
  status: 201,
  body: z.object({
    orderId: z.string(),
    method: methodEnum,
    amount: moneySchema,
    transactionId: z.string().trim().max(100).nullish(),
    senderNumber: z.string().max(20).nullish(),
    accountId: z.string().nullish(),
    note: z.string().max(500).nullish(),
    verified: z.boolean().default(false),
  }),
  handler: ({ body, user, ip }) => payments.recordPayment(body, actorOf(user, ip)),
});

route({
  method: "post",
  path: "/:id/verify",
  summary: "Verify a pending payment (money confirmed in the account)",
  access: "payments.record",
  params: idParam,
  body: z.object({ accountId: z.string().nullish() }),
  handler: ({ params, body, user, ip }) => payments.verifyPayment(params.id, body.accountId ?? null, actorOf(user, ip)),
});

route({
  method: "post",
  path: "/:id/reject",
  summary: "Reject a pending payment (not received / wrong transaction)",
  access: "payments.record",
  params: idParam,
  body: z.object({ reason: z.string().trim().min(3).max(300) }),
  handler: ({ params, body, user, ip }) => payments.rejectPayment(params.id, body.reason, actorOf(user, ip)),
});

// ───────────── online checkout ─────────────

route({
  method: "get",
  path: "/online/options",
  summary: "Public: which online payment gateways checkout may offer",
  access: "public",
  handler: () => ({
    gateways: gatewayStatus()
      .filter((g) => g.configured && (g.code === "sslcommerz" || (g.code === "sandbox" && !isProd)))
      .map((g) => ({ code: g.code, name: g.name, sandbox: g.sandbox })),
  }),
});

route({
  method: "post",
  path: "/online/init",
  summary: "Start an online payment for an order (returns the gateway redirect URL)",
  description: "Public so the storefront can call it right after checkout; the amount always comes from the order on the server.",
  access: "public",
  body: z.object({ orderNumber: z.string(), phone: z.string(), gateway: z.enum(["sslcommerz", "sandbox"]).default("sslcommerz") }),
  handler: async ({ body }) => {
    const gateway = getGateway(body.gateway);
    if (!gateway?.configured()) throw unavailable(`${body.gateway} is not configured`);
    const { normalizeBdPhone } = await import("../../lib/phone.js");
    const order = await prisma.order.findUnique({ where: { orderNumber: body.orderNumber }, include: { customer: true } });
    // phone acts as a light ownership check so order numbers cannot be paid / probed by strangers
    if (!order || order.shippingPhone !== normalizeBdPhone(body.phone)) throw badRequest("Order not found");
    const due = money(order.total).minus(order.paidAmount);
    if (!due.greaterThan(0)) throw unprocessable("NOTHING_DUE", "This order is already paid");
    if (["CANCELLED", "DELIVERED", "RETURNED"].includes(order.status)) throw unprocessable("ORDER_NOT_PAYABLE", "This order cannot be paid online");

    const tranId = `BB${Date.now().toString(36).toUpperCase()}${randomToken(4).replace(/[-_]/g, "X").toUpperCase()}`;
    const payment = await prisma.payment.create({
      data: { orderId: order.id, method: body.gateway === "sslcommerz" ? "SSLCOMMERZ" : "CARD", kind: "ADVANCE", provider: gateway.code, amount: due, status: "PENDING", transactionId: tranId },
    });
    const api = `${env.API_PUBLIC_URL}/api/v1/payments/callback/${gateway.code}`;
    try {
      const init = await gateway.init({
        transactionId: tranId, amount: due.toFixed(2), orderNumber: order.orderNumber, customerName: order.shippingName, customerPhone: order.shippingPhone,
        customerEmail: order.customer.email, address: order.shippingAddress,
        successUrl: `${api}/success`, failUrl: `${api}/fail`, cancelUrl: `${api}/cancel`, ipnUrl: `${api}/ipn`,
      });
      await prisma.payment.update({ where: { id: payment.id }, data: { rawPayload: (init.raw ?? null) as Prisma.InputJsonValue } });
      return { redirectUrl: init.redirectUrl, transactionId: tranId, amount: due.toFixed(2) };
    } catch (err) {
      await prisma.payment.update({ where: { id: payment.id }, data: { status: "FAILED", note: (err as Error).message.slice(0, 300) } });
      throw unavailable("Could not start the online payment, please try again or choose cash on delivery");
    }
  },
});

/** Shared callback handling: validate with the gateway, match amount + currency, then complete idempotently. */
async function completeFromCallback(gatewayCode: string, payload: Record<string, unknown>) {
  const gateway = getGateway(gatewayCode);
  if (!gateway) return { ok: false, orderNumber: null as string | null, reason: "unknown gateway" };
  const tranId = String(payload.tran_id ?? "");
  const payment = await prisma.payment.findFirst({ where: { transactionId: tranId, provider: gateway.code }, include: { order: true } });
  if (!payment) return { ok: false, orderNumber: null, reason: "unknown transaction" };
  if (payment.status === "COMPLETED") return { ok: true, orderNumber: payment.order.orderNumber };

  const v = await gateway.validate(payload);
  const amountMatches = v.amount != null && money(v.amount).equals(payment.amount);
  const currencyOk = !v.currency || v.currency === "BDT";
  if (!v.valid || !amountMatches || !currencyOk || v.transactionId !== tranId) {
    const reason = v.reason ?? (!amountMatches ? `amount mismatch (${v.amount} vs ${payment.amount.toFixed(2)})` : "currency/transaction mismatch");
    await prisma.payment.update({ where: { id: payment.id }, data: { status: "FAILED", rawPayload: v.raw as Prisma.InputJsonValue, note: `Validation failed: ${reason}` } });
    await audit(prisma, { action: "payment.validation_failed", entityType: "Order", entityId: payment.orderId, after: { paymentId: payment.id, reason } });
    const { notifyStaff } = await import("../notifications/notify.js");
    await notifyStaff("payment.failed", { title: `Online payment failed for ${payment.order.orderNumber}`, body: reason, link: `/orders/${payment.orderId}`, dedupeKey: `payment-failed:${payment.id}` });
    return { ok: false, orderNumber: payment.order.orderNumber, reason };
  }
  await prisma.payment.update({ where: { id: payment.id }, data: { rawPayload: v.raw as Prisma.InputJsonValue, note: v.gatewayRef ? `Gateway ref ${v.gatewayRef}` : null } });
  const account = await prisma.account.findFirst({ where: { type: "BANK", isActive: true }, orderBy: { createdAt: "asc" } });
  await payments.verifyPayment(payment.id, account?.id ?? null, systemActor("SYSTEM"));
  return { ok: true, orderNumber: payment.order.orderNumber };
}

paymentsModule.route({
  method: "post",
  path: "/callback/:gateway/ipn",
  summary: "Gateway server-to-server notification (IPN)",
  access: "public",
  params: z.object({ gateway: z.enum(["sslcommerz", "sandbox"]) }),
  handler: async ({ params, req }) => {
    const r = await completeFromCallback(params.gateway, { ...(req.body ?? {}) });
    logger.info({ gateway: params.gateway, ok: r.ok, reason: r.reason }, "payment IPN");
    return { received: true, ok: r.ok };
  },
});

for (const outcome of ["success", "fail", "cancel"] as const) {
  paymentsModule.route({
    method: "post",
    path: `/callback/:gateway/${outcome}`,
    summary: `Gateway browser redirect (${outcome}) – validated server-side, then redirected to the storefront`,
    access: "public",
    raw: true,
    params: z.object({ gateway: z.enum(["sslcommerz", "sandbox"]) }),
    handler: async ({ params, req, res }) => {
      const payload = { ...(req.query ?? {}), ...(req.body ?? {}) } as Record<string, unknown>;
      const r = outcome === "success" ? await completeFromCallback(params.gateway, payload) : { ok: false, orderNumber: null, reason: outcome };
      const tran = String(payload.tran_id ?? "");
      const orderNumber = r.orderNumber ?? (await prisma.payment.findFirst({ where: { transactionId: tran }, include: { order: true } }))?.order.orderNumber ?? "";
      res.redirect(303, `${env.CLIENT_URL.split(",")[0]}/order-status?order=${encodeURIComponent(orderNumber)}&payment=${r.ok ? "success" : outcome === "cancel" ? "cancelled" : "failed"}`);
    },
  });
}

paymentsModule.route({
  method: "post",
  path: "/sandbox/complete",
  summary: "Development only: finish a sandbox-gateway payment (success or failure) and get the storefront redirect",
  description: "Signs the sandbox callback server-side so the browser never holds the signing secret. Disabled in production.",
  access: "public",
  body: z.object({ tranId: z.string().min(4).max(60), outcome: z.enum(["success", "fail", "cancel"]) }),
  handler: async ({ body }) => {
    if (isProd) throw unavailable("The sandbox gateway is disabled in production");
    const payment = await prisma.payment.findFirst({ where: { transactionId: body.tranId, provider: "sandbox" }, include: { order: true } });
    if (!payment) throw badRequest("Unknown sandbox transaction");
    let ok = false;
    if (body.outcome === "success") {
      const amount = payment.amount.toFixed(2);
      ok = (await completeFromCallback("sandbox", { tran_id: body.tranId, amount, status: "VALID", signature: sandboxSignature(body.tranId, amount, "VALID") })).ok;
    } else if (payment.status === "PENDING") {
      await prisma.payment.update({ where: { id: payment.id }, data: { status: body.outcome === "cancel" ? "CANCELLED" : "FAILED" } });
    }
    const result = ok ? "success" : body.outcome === "cancel" ? "cancelled" : "failed";
    return { redirectUrl: `/order-status?order=${encodeURIComponent(payment.order.orderNumber)}&payment=${result}` };
  },
});

// ───────────── refunds ─────────────

refundsModule.route({
  method: "get",
  path: "/",
  summary: "Refunds",
  access: "payments.view",
  query: pageQuery.extend({ status: z.string().optional() }),
  handler: async ({ query }) => {
    const where: Prisma.RefundWhereInput = query.status ? { status: { in: query.status.split(",") as never } } : {};
    const [rows, total] = await Promise.all([
      prisma.refund.findMany({ where, orderBy: { createdAt: "desc" }, skip: (query.page - 1) * query.pageSize, take: query.pageSize, include: { order: { select: { id: true, orderNumber: true, shippingName: true } }, return: { select: { id: true, returnNumber: true } }, account: { select: { name: true } } } }),
      prisma.refund.count({ where }),
    ]);
    return withMeta(rows, pageMeta(query.page, query.pageSize, total));
  },
});

refundsModule.route({
  method: "post",
  path: "/",
  summary: "Request a refund (needs approval before payment)",
  access: "returns.manage",
  status: 201,
  body: z.object({ orderId: z.string(), returnId: z.string().nullish(), amount: moneySchema, method: methodEnum, reason: z.string().trim().min(3).max(500) }),
  handler: ({ body, user, ip }) => payments.requestRefund(body, actorOf(user, ip)),
});

refundsModule.route({
  method: "post",
  path: "/:id/approve",
  summary: "Approve a refund",
  access: "refunds.approve",
  params: idParam,
  body: z.object({ note: z.string().max(300).optional() }),
  handler: ({ params, body, user, ip }) => payments.decideRefund(params.id, true, actorOf(user, ip), body.note),
});

refundsModule.route({
  method: "post",
  path: "/:id/reject",
  summary: "Reject a refund",
  access: "refunds.approve",
  params: idParam,
  body: z.object({ note: z.string().trim().min(3).max(300) }),
  handler: ({ params, body, user, ip }) => payments.decideRefund(params.id, false, actorOf(user, ip), body.note),
});

refundsModule.route({
  method: "post",
  path: "/:id/pay",
  summary: "Mark an approved refund as paid from an account",
  access: "refunds.approve",
  params: idParam,
  body: z.object({ accountId: z.string(), reference: z.string().max(100).nullish() }),
  handler: async ({ params, body, user, ip }) => {
    assertFound(await prisma.account.findUnique({ where: { id: body.accountId } }), "Account");
    return payments.payRefund(params.id, body, actorOf(user, ip));
  },
});
