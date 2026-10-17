import { z } from "zod";
import multer from "multer";
import { createModule, dateRangeQuery, idParam, moneySchema, pageMeta, pageQuery, withMeta } from "../../http/route.js";
import { prisma, Prisma } from "../../lib/prisma.js";
import { assertFound, badRequest } from "../../lib/errors.js";
import { dhakaRange } from "../../lib/time.js";
import { money } from "../../lib/money.js";
import type { AuthUser } from "../../middleware/auth.js";
import type { Actor } from "../orders/orders.service.js";
import { storeUpload } from "../uploads/uploads.routes.js";
import { requestRefund } from "../payments/payments.service.js";
import * as returns from "./returns.service.js";

export const returnsModule = createModule("/returns", "Returns & exchanges");
const { route } = returnsModule;
const actorOf = (user: AuthUser, ip: string): Actor => ({ userId: user.id, permissions: user.permissions, source: "USER", ip });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });

const detailInclude = {
  order: { select: { id: true, orderNumber: true, status: true, shippingName: true, shippingPhone: true, total: true, paidAmount: true, refundedAmount: true, paymentMethod: true } },
  exchangeOrder: { select: { id: true, orderNumber: true, status: true, total: true } },
  items: { include: { orderItem: true } },
  attachments: true,
  history: { orderBy: { createdAt: "asc" } },
  refunds: true,
} satisfies Prisma.ReturnRequestInclude;

route({
  method: "get",
  path: "/",
  summary: "List returns, exchanges and RTOs",
  access: "returns.view",
  query: pageQuery.merge(dateRangeQuery).extend({ status: z.string().optional(), type: z.enum(["RETURN", "EXCHANGE"]).optional(), rto: z.enum(["true", "false"]).optional(), q: z.string().optional() }),
  handler: async ({ query }) => {
    const range = dhakaRange(query.from, query.to);
    const where: Prisma.ReturnRequestWhereInput = {
      ...(query.status ? { status: { in: query.status.split(",") as never } } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.rto ? { isRto: query.rto === "true" } : {}),
      ...(query.q ? { OR: [{ returnNumber: query.q.toUpperCase() }, { order: { orderNumber: query.q.toUpperCase() } }, { order: { shippingPhone: { contains: query.q } } }] } : {}),
      ...(range.gte || range.lt ? { createdAt: range } : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.returnRequest.findMany({ where, include: { order: { select: { id: true, orderNumber: true, shippingName: true, shippingPhone: true } }, items: { include: { orderItem: { select: { productName: true, variantName: true, imageUrl: true } } } } }, orderBy: { createdAt: "desc" }, skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
      prisma.returnRequest.count({ where }),
    ]);
    return withMeta(rows, pageMeta(query.page, query.pageSize, total));
  },
});

route({
  method: "post",
  path: "/",
  summary: "Open a return or exchange request for a delivered order",
  access: "returns.manage",
  status: 201,
  body: z.object({
    orderId: z.string(),
    type: z.enum(["RETURN", "EXCHANGE"]),
    reason: z.string().trim().min(3).max(500),
    customerNote: z.string().max(2000).nullish(),
    items: z.array(z.object({ orderItemId: z.string(), quantity: z.number().int().min(1) })).min(1),
  }),
  handler: ({ body, user, ip }) => returns.createReturn(body, actorOf(user, ip)),
});

route({
  method: "get",
  path: "/:id",
  summary: "Return details with financial summary",
  access: "returns.view",
  params: idParam,
  handler: async ({ params, user }) => {
    const r = assertFound(await prisma.returnRequest.findUnique({ where: { id: params.id }, include: detailInclude }), "Return");
    const value = returns.returnedValue(r.items);
    const restocked = r.items.filter((i) => i.disposition === "RESTOCK");
    const lost = r.items.filter((i) => i.disposition === "DAMAGED" || i.disposition === "DISPOSE");
    const refunded = r.refunds.filter((f) => f.status === "PAID").reduce((s, f) => s.plus(f.amount), money(0));
    return {
      ...r,
      financial: user.permissions.has("finance.view")
        ? {
            originalOrderValue: r.order.total,
            returnedItemsValue: value.toFixed(2),
            refunded: refunded.toFixed(2),
            recoveredInventoryCost: restocked.reduce((s, i) => s.plus(money(i.orderItem.unitCost).times(i.quantity)), money(0)).toFixed(2),
            lostInventoryCost: lost.reduce((s, i) => s.plus(money(i.orderItem.unitCost).times(i.quantity)), money(0)).toFixed(2),
            returnShippingCost: r.returnShippingCost,
          }
        : undefined,
    };
  },
});

route({
  method: "post",
  path: "/:id/approve",
  summary: "Approve a return / exchange",
  access: "returns.approve",
  params: idParam,
  body: z.object({ note: z.string().max(500).nullish(), returnShippingCost: moneySchema.optional() }),
  handler: ({ params, body, user, ip }) => returns.decideReturn(params.id, true, actorOf(user, ip), body.note ?? null, body.returnShippingCost),
});

route({
  method: "post",
  path: "/:id/reject",
  summary: "Reject a return / exchange (reason required)",
  access: "returns.approve",
  params: idParam,
  body: z.object({ note: z.string().trim().min(3).max(500) }),
  handler: ({ params, body, user, ip }) => returns.decideReturn(params.id, false, actorOf(user, ip), body.note),
});

route({
  method: "post",
  path: "/:id/cancel",
  summary: "Cancel a return request (customer withdrew)",
  access: "returns.manage",
  params: idParam,
  body: z.object({ note: z.string().trim().min(3).max(500) }),
  handler: ({ params, body, user, ip }) => returns.cancelReturn(params.id, actorOf(user, ip), body.note),
});

route({
  method: "post",
  path: "/:id/pickup",
  summary: "Record return pickup booked / items on the way back",
  access: "returns.manage",
  params: idParam,
  body: z.object({ pickupBooked: z.boolean().default(false), note: z.string().max(500).nullish() }),
  handler: ({ params, body, user, ip }) => returns.markInTransit(params.id, actorOf(user, ip), body),
});

route({
  method: "post",
  path: "/:id/receive",
  summary: "Receive returned items at the warehouse (awaiting inspection)",
  access: "returns.manage",
  params: idParam,
  body: z.object({ returnShippingCost: moneySchema.optional(), note: z.string().max(500).nullish() }),
  handler: ({ params, body, user, ip }) => returns.receiveReturn(params.id, actorOf(user, ip), body),
});

route({
  method: "post",
  path: "/:id/inspect",
  summary: "Record inspection outcome per item (restock / damaged / dispose)",
  access: "returns.manage",
  params: idParam,
  body: z.object({
    items: z.array(z.object({
      returnItemId: z.string(),
      condition: z.enum(["GOOD", "DAMAGED", "MISSING"]),
      disposition: z.enum(["RESTOCK", "DAMAGED", "DISPOSE"]),
      notes: z.string().max(500).nullish(),
    })).min(1),
  }),
  handler: ({ params, body, user, ip }) => returns.inspectReturn(params.id, body.items, actorOf(user, ip)),
});

route({
  method: "post",
  path: "/:id/refund",
  summary: "Request a refund for this return (needs approval)",
  access: "returns.manage",
  status: 201,
  params: idParam,
  body: z.object({ amount: moneySchema, method: z.enum(["BKASH", "NAGAD", "ROCKET", "BANK_TRANSFER", "CASH", "CARD", "SSLCOMMERZ"]), reason: z.string().trim().min(3).max(500).optional() }),
  handler: async ({ params, body, user, ip }) => {
    const r = assertFound(await prisma.returnRequest.findUnique({ where: { id: params.id } }), "Return");
    if (r.isRto) throw badRequest("RTO parcels were never paid for; nothing to refund");
    const refund = await requestRefund({ orderId: r.orderId, returnId: r.id, amount: body.amount, method: body.method, reason: body.reason ?? `Return ${r.returnNumber}` }, actorOf(user, ip));
    await prisma.returnRequest.update({ where: { id: r.id }, data: { refundAmount: money(r.refundAmount).plus(money(body.amount)) } });
    return refund;
  },
});

route({
  method: "post",
  path: "/:id/exchange-order",
  summary: "Create the replacement order for an exchange (returned value credited)",
  access: ["returns.manage", "orders.create"],
  status: 201,
  params: idParam,
  body: z.object({ items: z.array(z.object({ variantId: z.string(), quantity: z.number().int().min(1).max(99) })).min(1), deliveryCharge: moneySchema.optional(), note: z.string().max(500).nullish() }),
  handler: ({ params, body, user, ip }) => returns.createExchangeOrder(params.id, body, actorOf(user, ip)),
});

route({
  method: "post",
  path: "/:id/complete",
  summary: "Close the return (after inspection and refund / exchange)",
  access: "returns.manage",
  params: idParam,
  handler: ({ params, user, ip }) => returns.completeReturn(params.id, actorOf(user, ip)),
});

route({
  method: "post",
  path: "/:id/attachments",
  summary: "Attach evidence (photo / PDF, multipart field `file`)",
  access: "returns.manage",
  status: 201,
  params: idParam,
  middleware: [upload.single("file")],
  handler: async ({ params, req, user }) => {
    assertFound(await prisma.returnRequest.findUnique({ where: { id: params.id }, select: { id: true } }), "Return");
    if (!req.file) throw badRequest("No file uploaded (field name: file)");
    const u = await storeUpload(req.file.buffer, req.file.originalname, user.id);
    return prisma.returnAttachment.create({ data: { returnId: params.id, url: u.url, filename: u.filename, mimeType: u.mimeType, size: u.size } });
  },
});
