import { z } from "zod";
import { createModule, idParam, moneySchema, pageMeta, pageQuery, withMeta } from "../../http/route.js";
import { prisma, Prisma } from "../../lib/prisma.js";
import { assertFound, conflict, forbidden } from "../../lib/errors.js";
import { audit, diff } from "../../lib/audit.js";
import { money } from "../../lib/money.js";
import type { AuthUser } from "../../middleware/auth.js";
import * as svc from "./purchasing.service.js";

export const suppliersModule = createModule("/suppliers", "Purchasing");
export const purchaseOrdersModule = createModule("/purchase-orders", "Purchasing");
export const materialsModule = createModule("/materials", "Purchasing");

const actor = (user: AuthUser, ip: string): svc.ActorRef => ({ userId: user.id, ip });
const canFinance = (user: AuthUser) => user.permissions.has("finance.view");
const qtySchema = z.union([z.number(), z.string().regex(/^\d+(\.\d{1,3})?$/)]).transform(String);
const nullableText = (max: number) => z.string().trim().max(max).nullish();

// ═════════════ suppliers ═════════════

const supplierSchema = z.object({
  name: z.string().trim().min(2).max(150),
  contactName: nullableText(100),
  phone: nullableText(30),
  email: z.string().trim().email().max(150).nullish(),
  address: nullableText(500),
  notes: nullableText(2000),
  isActive: z.boolean().optional(),
});

const shapeBalance = (b: { purchased: Prisma.Decimal; paid: Prisma.Decimal; balance: Prisma.Decimal } | undefined) =>
  b ? { purchased: b.purchased.toFixed(2), paid: b.paid.toFixed(2), outstanding: b.balance.toFixed(2) } : undefined;

suppliersModule.route({
  method: "get",
  path: "/",
  summary: "List suppliers",
  description: "`balance` (purchased, paid, outstanding) is included only for users with finance.view.",
  access: "purchasing.view",
  query: pageQuery.extend({ search: z.string().trim().max(100).optional(), active: z.enum(["true", "false", "all"]).default("true") }),
  handler: async ({ query, user }) => {
    const where: Prisma.SupplierWhereInput = {
      ...(query.active === "all" ? {} : { isActive: query.active === "true" }),
      ...(query.search
        ? { OR: [{ name: { contains: query.search, mode: "insensitive" } }, { contactName: { contains: query.search, mode: "insensitive" } }, { phone: { contains: query.search } }] }
        : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.supplier.findMany({ where, orderBy: { name: "asc" }, skip: (query.page - 1) * query.pageSize, take: query.pageSize, include: { _count: { select: { purchaseOrders: true } } } }),
      prisma.supplier.count({ where }),
    ]);
    const balances = canFinance(user) ? await svc.supplierBalances(prisma, rows.map((r) => r.id)) : null;
    return withMeta(
      rows.map(({ _count, ...s }) => ({ ...s, purchaseOrderCount: _count.purchaseOrders, balance: balances ? shapeBalance(balances.get(s.id)) : undefined })),
      pageMeta(query.page, query.pageSize, total),
    );
  },
});

suppliersModule.route({
  method: "get",
  path: "/:id",
  summary: "Supplier details with purchase history",
  access: "purchasing.view",
  params: idParam,
  handler: async ({ params, user }) => {
    const s = assertFound(await prisma.supplier.findUnique({ where: { id: params.id } }), "Supplier");
    const history = await prisma.purchaseOrder.findMany({
      where: { supplierId: s.id },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: { id: true, number: true, status: true, orderedAt: true, receivedAt: true, total: true, paidAmount: true, createdAt: true, _count: { select: { items: true } } },
    });
    const balance = canFinance(user) ? shapeBalance((await svc.supplierBalances(prisma, [s.id])).get(s.id)) : undefined;
    return {
      ...s,
      balance,
      purchaseHistory: history.map(({ _count, ...po }) => ({ ...po, total: po.total.toFixed(2), paidAmount: po.paidAmount.toFixed(2), itemCount: _count.items })),
    };
  },
});

suppliersModule.route({
  method: "post",
  path: "/",
  summary: "Create a supplier",
  access: "purchasing.manage",
  status: 201,
  body: supplierSchema,
  handler: async ({ body, user, ip }) => {
    const s = await prisma.supplier.create({ data: { ...body, isActive: body.isActive ?? true } });
    await audit(prisma, { userId: user.id, action: "supplier.created", entityType: "Supplier", entityId: s.id, after: s, ip });
    return s;
  },
});

suppliersModule.route({
  method: "put",
  path: "/:id",
  summary: "Update a supplier",
  access: "purchasing.manage",
  params: idParam,
  body: supplierSchema.partial(),
  handler: async ({ params, body, user, ip }) => {
    const before = assertFound(await prisma.supplier.findUnique({ where: { id: params.id } }), "Supplier");
    const s = await prisma.supplier.update({ where: { id: params.id }, data: body });
    const d = diff(before as unknown as Record<string, unknown>, body as Record<string, unknown>);
    if (d.changed) await audit(prisma, { userId: user.id, action: "supplier.updated", entityType: "Supplier", entityId: s.id, before: d.before, after: d.after, ip });
    return s;
  },
});

suppliersModule.route({
  method: "delete",
  path: "/:id",
  summary: "Deactivate a supplier (soft delete; history is kept)",
  access: "purchasing.manage",
  params: idParam,
  handler: async ({ params, user, ip }) => {
    const before = assertFound(await prisma.supplier.findUnique({ where: { id: params.id } }), "Supplier");
    const s = await prisma.supplier.update({ where: { id: params.id }, data: { isActive: false } });
    await audit(prisma, { userId: user.id, action: "supplier.deactivated", entityType: "Supplier", entityId: s.id, before: { isActive: before.isActive }, after: { isActive: false }, ip });
    return s;
  },
});

suppliersModule.route({
  method: "get",
  path: "/:id/payments",
  summary: "Payments made to a supplier",
  access: ["purchasing.view", "finance.view"],
  params: idParam,
  query: pageQuery,
  handler: async ({ params, query }) => {
    assertFound(await prisma.supplier.findUnique({ where: { id: params.id } }), "Supplier");
    const where = { supplierId: params.id };
    const [rows, total] = await Promise.all([
      prisma.supplierPayment.findMany({
        where, orderBy: { paidAt: "desc" }, skip: (query.page - 1) * query.pageSize, take: query.pageSize,
        include: { account: { select: { id: true, name: true } }, purchaseOrder: { select: { id: true, number: true } } },
      }),
      prisma.supplierPayment.count({ where }),
    ]);
    return withMeta(rows.map((p) => ({ ...p, amount: p.amount.toFixed(2) })), pageMeta(query.page, query.pageSize, total));
  },
});

suppliersModule.route({
  method: "post",
  path: "/:id/payments",
  summary: "Record a payment to a supplier",
  description: "Creates the SupplierPayment and a cash-out SUPPLIER_PAYMENT ledger entry on the account. With purchaseOrderId the amount cannot exceed that PO's open balance.",
  access: ["purchasing.manage", "finance.view"],
  status: 201,
  idempotent: true,
  params: idParam,
  body: z.object({
    amount: moneySchema,
    method: z.enum(["CASH", "BANK_TRANSFER", "BKASH", "NAGAD", "ROCKET", "CHEQUE", "CARD", "OTHER"]),
    accountId: z.string().min(1),
    purchaseOrderId: z.string().nullish(),
    paidAt: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
    reference: nullableText(120),
    note: nullableText(1000),
  }),
  handler: async ({ params, body, user, ip }) => {
    const p = await svc.recordSupplierPayment(params.id, body, actor(user, ip));
    return { ...p, amount: p.amount.toFixed(2) };
  },
});

// ═════════════ materials ═════════════

const materialSchema = z.object({
  name: z.string().trim().min(2).max(120),
  unit: z.string().trim().min(1).max(30),
  unitCost: moneySchema,
  isActive: z.boolean().optional(),
});

const shapeMaterial = <T extends { unitCost: Prisma.Decimal; stockQty: Prisma.Decimal }>(m: T) => ({ ...m, unitCost: m.unitCost.toFixed(2), stockQty: m.stockQty.toString() });

/** Cost previews reveal material prices: allowed for purchasing, product managers and finance. */
function requireCostAccess(user: AuthUser) {
  const p = user.permissions;
  if (!(p.has("purchasing.view") || p.has("products.manage") || p.has("finance.view"))) throw forbidden();
}

materialsModule.route({
  method: "post",
  path: "/calculate-cost",
  summary: "Product cost calculator",
  description: "Takes cost components [{materialId?|description, quantity, unitCost?}] and returns line totals and total as 2-dp strings. unitCost defaults to the material's current cost. Requires purchasing.view, products.manage or finance.view.",
  access: "auth",
  body: z.object({
    components: z
      .array(
        z.object({
          materialId: z.string().nullish(),
          description: z.string().trim().max(200).nullish(),
          type: z.enum(["MATERIAL", "FABRIC", "LACE", "EMBROIDERY", "LABOR", "FINISHING", "PACKAGING", "OTHER"]).nullish(),
          quantity: qtySchema,
          unitCost: moneySchema.nullish(),
        }).refine((c) => !!c.materialId || !!c.description, { message: "materialId or description is required" })
          .refine((c) => !!c.materialId || (c.unitCost !== undefined && c.unitCost !== null), { message: "unitCost is required without a material" }),
      )
      .max(100),
  }),
  handler: async ({ body, user }) => {
    requireCostAccess(user);
    return svc.calculateCost(prisma, body.components);
  },
});

materialsModule.route({
  method: "get",
  path: "/",
  summary: "List materials (fabric, lace, thread, packaging…)",
  access: "purchasing.view",
  query: pageQuery.extend({ search: z.string().trim().max(100).optional(), active: z.enum(["true", "false", "all"]).default("true") }),
  handler: async ({ query }) => {
    const where: Prisma.MaterialWhereInput = {
      ...(query.active === "all" ? {} : { isActive: query.active === "true" }),
      ...(query.search ? { name: { contains: query.search, mode: "insensitive" } } : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.material.findMany({ where, orderBy: { name: "asc" }, skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
      prisma.material.count({ where }),
    ]);
    return withMeta(rows.map(shapeMaterial), pageMeta(query.page, query.pageSize, total));
  },
});

materialsModule.route({
  method: "get",
  path: "/:id",
  summary: "Material details",
  access: "purchasing.view",
  params: idParam,
  handler: async ({ params }) => shapeMaterial(assertFound(await prisma.material.findUnique({ where: { id: params.id } }), "Material")),
});

materialsModule.route({
  method: "post",
  path: "/",
  summary: "Create a material",
  access: "purchasing.manage",
  status: 201,
  body: materialSchema,
  handler: async ({ body, user, ip }) => {
    if (await prisma.material.findUnique({ where: { name: body.name } })) throw conflict("A material with this name already exists");
    const m = await prisma.material.create({ data: { name: body.name, unit: body.unit, unitCost: money(body.unitCost), isActive: body.isActive ?? true } });
    await audit(prisma, { userId: user.id, action: "material.created", entityType: "Material", entityId: m.id, after: shapeMaterial(m), ip });
    return shapeMaterial(m);
  },
});

materialsModule.route({
  method: "put",
  path: "/:id",
  summary: "Update a material",
  access: "purchasing.manage",
  params: idParam,
  body: materialSchema.partial(),
  handler: async ({ params, body, user, ip }) => {
    const before = assertFound(await prisma.material.findUnique({ where: { id: params.id } }), "Material");
    const m = await prisma.material.update({
      where: { id: params.id },
      data: { ...body, ...(body.unitCost !== undefined ? { unitCost: money(body.unitCost) } : {}) },
    });
    const d = diff(shapeMaterial(before) as Record<string, unknown>, shapeMaterial(m) as Record<string, unknown>);
    if (d.changed) await audit(prisma, { userId: user.id, action: "material.updated", entityType: "Material", entityId: m.id, before: d.before, after: d.after, ip });
    return shapeMaterial(m);
  },
});

materialsModule.route({
  method: "delete",
  path: "/:id",
  summary: "Deactivate a material",
  access: "purchasing.manage",
  params: idParam,
  handler: async ({ params, user, ip }) => {
    assertFound(await prisma.material.findUnique({ where: { id: params.id } }), "Material");
    const m = await prisma.material.update({ where: { id: params.id }, data: { isActive: false } });
    await audit(prisma, { userId: user.id, action: "material.deactivated", entityType: "Material", entityId: m.id, after: { isActive: false }, ip });
    return shapeMaterial(m);
  },
});

// ═════════════ purchase orders ═════════════

const poItemSchema = z
  .object({
    variantId: z.string().nullish(),
    materialId: z.string().nullish(),
    description: nullableText(200),
    quantity: qtySchema,
    unitCost: moneySchema,
  })
  .refine((i) => !!i.variantId !== !!i.materialId, { message: "Each item needs exactly one of variantId or materialId" });

const poSchema = z.object({
  supplierId: z.string().min(1),
  expectedAt: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).nullish(),
  shippingCost: moneySchema.optional(),
  otherCost: moneySchema.optional(),
  notes: nullableText(2000),
  items: z.array(poItemSchema).min(1).max(200),
});

const poInclude = {
  supplier: { select: { id: true, name: true, phone: true } },
  items: {
    orderBy: { id: "asc" },
    include: {
      variant: { select: { id: true, sku: true, name: true, product: { select: { id: true, name: true } } } },
      material: { select: { id: true, name: true, unit: true } },
    },
  },
} satisfies Prisma.PurchaseOrderInclude;

type FullPo = Prisma.PurchaseOrderGetPayload<{ include: typeof poInclude }>;

function shapePo(po: FullPo) {
  return {
    ...po,
    subtotal: po.subtotal.toFixed(2),
    shippingCost: po.shippingCost.toFixed(2),
    otherCost: po.otherCost.toFixed(2),
    total: po.total.toFixed(2),
    paidAmount: po.paidAmount.toFixed(2),
    openBalance: money(po.total).minus(po.paidAmount).toFixed(2),
    items: po.items.map((i) => ({
      ...i,
      quantity: i.quantity.toString(),
      receivedQuantity: i.receivedQuantity.toString(),
      remainingQuantity: i.quantity.minus(i.receivedQuantity).toString(),
      unitCost: i.unitCost.toFixed(2),
      total: i.total.toFixed(2),
    })),
  };
}

const loadPo = async (id: string) => shapePo(assertFound(await prisma.purchaseOrder.findUnique({ where: { id }, include: poInclude }), "Purchase order"));

purchaseOrdersModule.route({
  method: "get",
  path: "/",
  summary: "List purchase orders",
  access: "purchasing.view",
  query: pageQuery.extend({
    status: z.enum(["DRAFT", "ORDERED", "PARTIALLY_RECEIVED", "RECEIVED", "CANCELLED"]).optional(),
    supplierId: z.string().optional(),
    search: z.string().trim().max(50).optional(),
  }),
  handler: async ({ query }) => {
    const where: Prisma.PurchaseOrderWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.supplierId ? { supplierId: query.supplierId } : {}),
      ...(query.search ? { number: { contains: query.search, mode: "insensitive" } } : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.purchaseOrder.findMany({ where, include: poInclude, orderBy: { createdAt: "desc" }, skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
      prisma.purchaseOrder.count({ where }),
    ]);
    return withMeta(rows.map(shapePo), pageMeta(query.page, query.pageSize, total));
  },
});

purchaseOrdersModule.route({
  method: "get",
  path: "/:id",
  summary: "Purchase order with items (and payments for finance users)",
  access: "purchasing.view",
  params: idParam,
  handler: async ({ params, user }) => {
    const po = await loadPo(params.id);
    const payments = canFinance(user)
      ? (await prisma.supplierPayment.findMany({ where: { purchaseOrderId: po.id }, orderBy: { paidAt: "desc" }, include: { account: { select: { id: true, name: true } } } }))
          .map((p) => ({ ...p, amount: p.amount.toFixed(2) }))
      : undefined;
    return { ...po, payments };
  },
});

purchaseOrdersModule.route({
  method: "post",
  path: "/",
  summary: "Create a draft purchase order",
  description: "Items reference a finished-goods variant (variantId) or a raw material (materialId). Totals are computed on the server.",
  access: "purchasing.manage",
  status: 201,
  idempotent: true,
  body: poSchema,
  handler: async ({ body, user, ip }) => loadPo((await svc.createPurchaseOrder(body, actor(user, ip))).id),
});

purchaseOrdersModule.route({
  method: "put",
  path: "/:id",
  summary: "Edit a draft purchase order (items are replaced when given)",
  access: "purchasing.manage",
  params: idParam,
  body: poSchema.partial(),
  handler: async ({ params, body, user, ip }) => {
    await svc.updatePurchaseOrder(params.id, body, actor(user, ip));
    return loadPo(params.id);
  },
});

purchaseOrdersModule.route({
  method: "post",
  path: "/:id/order",
  summary: "Mark a draft purchase order as ORDERED",
  access: "purchasing.manage",
  params: idParam,
  handler: async ({ params, user, ip }) => {
    await svc.markOrdered(params.id, actor(user, ip));
    return loadPo(params.id);
  },
});

purchaseOrdersModule.route({
  method: "post",
  path: "/:id/cancel",
  summary: "Cancel a purchase order (only when nothing has been received)",
  access: "purchasing.manage",
  params: idParam,
  body: z.object({ reason: z.string().trim().max(500).optional() }),
  handler: async ({ params, body, user, ip }) => {
    await svc.cancelPurchaseOrder(params.id, body.reason, actor(user, ip));
    return loadPo(params.id);
  },
});

purchaseOrdersModule.route({
  method: "post",
  path: "/:id/receive",
  summary: "Receive goods against a purchase order",
  description:
    "Per-item quantities (≤ ordered − already received). Variants enter stock via RECEIVE inventory movements; materials increase Material.stockQty. " +
    "With updateCost=true: variant cost becomes the weighted average (onHand × currentCost + qty × landedUnitCost) ÷ (onHand + qty), " +
    "where landedUnitCost = unitCost × PO.total ÷ PO.subtotal and onHand = available + reserved; material unitCost becomes the received unit cost.",
  access: "purchasing.manage",
  params: idParam,
  body: z.object({
    items: z.array(z.object({ itemId: z.string().min(1), quantity: qtySchema })).min(1).max(200),
    updateCost: z.boolean().default(false),
    note: nullableText(500),
  }),
  handler: async ({ params, body, user, ip }) => {
    await svc.receivePurchaseOrder(params.id, body, actor(user, ip));
    return loadPo(params.id);
  },
});
