import { prisma, Prisma, type Db, type Tx } from "../../lib/prisma.js";
import { assertFound, badRequest, unprocessable } from "../../lib/errors.js";
import { audit } from "../../lib/audit.js";
import { money, sum, ZERO, Decimal } from "../../lib/money.js";
import { nextPurchaseOrderNumber } from "../../lib/numbering.js";
import { applyMovement } from "../inventory/inventory.service.js";
import { postEntries } from "../finance/ledger.service.js";
import { startOfDhakaDay } from "../../lib/time.js";
import type { PurchaseOrderStatus } from "../../generated/prisma/enums.js";

export interface ActorRef {
  userId: string | null;
  ip?: string | null;
}

/** Statuses whose totals are owed to the supplier (a DRAFT is not a commitment; CANCELLED is void). */
export const COMMITTED_STATUSES: PurchaseOrderStatus[] = ["ORDERED", "PARTIALLY_RECEIVED", "RECEIVED"];

/** Quantities are Decimal(12,3); unit costs Decimal(12,2). */
export const qty = (v: Prisma.Decimal | number | string) => new Decimal(v).toDecimalPlaces(3, Decimal.ROUND_HALF_UP);

/** "YYYY-MM-DD" is a Dhaka business day (00:00 Dhaka); anything else is an ISO instant. */
export const parseDate = (v: string) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? startOfDhakaDay(v) : new Date(v));

// ───────────── supplier balances ─────────────

/**
 * Outstanding balance per supplier = Σ PO.total (ORDERED / PARTIALLY_RECEIVED / RECEIVED) − Σ SupplierPayment.amount.
 * Negative means the supplier holds an advance / credit.
 */
export async function supplierBalances(db: Db, supplierIds: string[]) {
  const out = new Map<string, { purchased: Prisma.Decimal; paid: Prisma.Decimal; balance: Prisma.Decimal }>();
  if (!supplierIds.length) return out;
  const [pos, pays] = await Promise.all([
    db.purchaseOrder.groupBy({ by: ["supplierId"], where: { supplierId: { in: supplierIds }, status: { in: COMMITTED_STATUSES } }, _sum: { total: true } }),
    db.supplierPayment.groupBy({ by: ["supplierId"], where: { supplierId: { in: supplierIds } }, _sum: { amount: true } }),
  ]);
  for (const id of supplierIds) out.set(id, { purchased: ZERO, paid: ZERO, balance: ZERO });
  for (const p of pos) out.get(p.supplierId)!.purchased = money(p._sum.total);
  for (const p of pays) out.get(p.supplierId)!.paid = money(p._sum.amount);
  for (const v of out.values()) v.balance = v.purchased.minus(v.paid);
  return out;
}

// ───────────── purchase order items / totals ─────────────

export interface PoItemInput {
  variantId?: string | null;
  materialId?: string | null;
  description?: string | null;
  quantity: string;
  unitCost: string;
}

/** Validates referenced variants/materials and computes line totals + PO totals with Decimal. */
export async function buildItems(db: Db, items: PoItemInput[], extra: { shippingCost?: string; otherCost?: string }) {
  const variantIds = [...new Set(items.map((i) => i.variantId).filter((v): v is string => !!v))];
  const materialIds = [...new Set(items.map((i) => i.materialId).filter((v): v is string => !!v))];
  const [variants, materials] = await Promise.all([
    db.productVariant.findMany({ where: { id: { in: variantIds } }, include: { product: { select: { name: true } } } }),
    db.material.findMany({ where: { id: { in: materialIds } } }),
  ]);
  const vById = new Map(variants.map((v) => [v.id, v]));
  const mById = new Map(materials.map((m) => [m.id, m]));

  const rows = items.map((i) => {
    const quantity = qty(i.quantity);
    if (!quantity.greaterThan(0)) throw badRequest("Item quantity must be positive");
    const unitCost = money(i.unitCost);
    if (unitCost.isNegative()) throw badRequest("Unit cost cannot be negative");
    let description = i.description?.trim() || "";
    if (i.variantId) {
      const v = vById.get(i.variantId);
      if (!v) throw badRequest(`Unknown product variant ${i.variantId}`);
      if (!quantity.isInteger()) throw badRequest(`Quantity for ${v.sku} must be a whole number`);
      description ||= `${v.product.name} – ${v.name} (${v.sku})`;
    } else if (i.materialId) {
      const m = mById.get(i.materialId);
      if (!m) throw badRequest(`Unknown material ${i.materialId}`);
      description ||= `${m.name} (${m.unit})`;
    }
    return {
      variantId: i.variantId ?? null,
      materialId: i.materialId ?? null,
      description,
      quantity,
      unitCost,
      total: money(unitCost.times(quantity)),
    };
  });
  const subtotal = sum(rows.map((r) => r.total));
  const shippingCost = money(extra.shippingCost);
  const otherCost = money(extra.otherCost);
  if (shippingCost.isNegative() || otherCost.isNegative()) throw badRequest("Costs cannot be negative");
  return { rows, subtotal, shippingCost, otherCost, total: subtotal.plus(shippingCost).plus(otherCost) };
}

export interface CreatePoInput {
  supplierId: string;
  expectedAt?: string | null;
  shippingCost?: string;
  otherCost?: string;
  notes?: string | null;
  items: PoItemInput[];
}

export async function createPurchaseOrder(input: CreatePoInput, actor: ActorRef) {
  return prisma.$transaction(async (tx) => {
    const supplier = assertFound(await tx.supplier.findUnique({ where: { id: input.supplierId } }), "Supplier");
    if (!supplier.isActive) throw unprocessable("SUPPLIER_INACTIVE", "Supplier is deactivated");
    const built = await buildItems(tx, input.items, input);
    const po = await tx.purchaseOrder.create({
      data: {
        number: await nextPurchaseOrderNumber(tx),
        supplierId: supplier.id,
        status: "DRAFT",
        expectedAt: input.expectedAt ? parseDate(input.expectedAt) : null,
        subtotal: built.subtotal,
        shippingCost: built.shippingCost,
        otherCost: built.otherCost,
        total: built.total,
        notes: input.notes ?? null,
        createdById: actor.userId,
        items: { create: built.rows },
      },
      include: { items: true },
    });
    await audit(tx, { userId: actor.userId, action: "purchase_order.created", entityType: "PurchaseOrder", entityId: po.id, after: { number: po.number, supplierId: po.supplierId, total: po.total.toFixed(2), items: po.items.length }, ip: actor.ip });
    return po;
  });
}

const lockPo = (tx: Tx, id: string) => tx.$queryRaw`SELECT id FROM "PurchaseOrder" WHERE id = ${id} FOR UPDATE`;

export async function updatePurchaseOrder(id: string, input: Partial<CreatePoInput>, actor: ActorRef) {
  return prisma.$transaction(async (tx) => {
    await lockPo(tx, id);
    const po = assertFound(await tx.purchaseOrder.findUnique({ where: { id }, include: { items: true } }), "Purchase order");
    if (po.status !== "DRAFT") throw unprocessable("PO_LOCKED", "Only draft purchase orders can be edited");
    if (input.supplierId && input.supplierId !== po.supplierId) {
      const s = assertFound(await tx.supplier.findUnique({ where: { id: input.supplierId } }), "Supplier");
      if (!s.isActive) throw unprocessable("SUPPLIER_INACTIVE", "Supplier is deactivated");
    }
    const items: PoItemInput[] = input.items ?? po.items.map((i) => ({ variantId: i.variantId, materialId: i.materialId, description: i.description, quantity: i.quantity.toString(), unitCost: i.unitCost.toFixed(2) }));
    const built = await buildItems(tx, items, {
      shippingCost: input.shippingCost ?? po.shippingCost.toFixed(2),
      otherCost: input.otherCost ?? po.otherCost.toFixed(2),
    });
    if (input.items) {
      await tx.purchaseItem.deleteMany({ where: { purchaseOrderId: id } });
      await tx.purchaseItem.createMany({ data: built.rows.map((r) => ({ ...r, purchaseOrderId: id })) });
    }
    const updated = await tx.purchaseOrder.update({
      where: { id },
      data: {
        ...(input.supplierId ? { supplierId: input.supplierId } : {}),
        ...(input.expectedAt !== undefined ? { expectedAt: input.expectedAt ? parseDate(input.expectedAt) : null } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        subtotal: built.subtotal,
        shippingCost: built.shippingCost,
        otherCost: built.otherCost,
        total: built.total,
      },
      include: { items: true },
    });
    await audit(tx, {
      userId: actor.userId, action: "purchase_order.updated", entityType: "PurchaseOrder", entityId: id,
      before: { supplierId: po.supplierId, total: po.total.toFixed(2), items: po.items.map((i) => `${i.description}×${i.quantity}@${i.unitCost.toFixed(2)}`) },
      after: { supplierId: updated.supplierId, total: updated.total.toFixed(2), items: updated.items.map((i) => `${i.description}×${i.quantity}@${i.unitCost.toFixed(2)}`) },
      ip: actor.ip,
    });
    return updated;
  });
}

export async function markOrdered(id: string, actor: ActorRef) {
  return prisma.$transaction(async (tx) => {
    await lockPo(tx, id);
    const po = assertFound(await tx.purchaseOrder.findUnique({ where: { id }, include: { items: true, supplier: true } }), "Purchase order");
    if (po.status !== "DRAFT") throw unprocessable("INVALID_TRANSITION", `Purchase order is ${po.status}`);
    if (!po.items.length) throw unprocessable("PO_EMPTY", "Add at least one item before ordering");
    if (!po.supplier.isActive) throw unprocessable("SUPPLIER_INACTIVE", "Supplier is deactivated");
    const updated = await tx.purchaseOrder.update({ where: { id }, data: { status: "ORDERED", orderedAt: new Date() } });
    await audit(tx, { userId: actor.userId, action: "purchase_order.ordered", entityType: "PurchaseOrder", entityId: id, before: { status: po.status }, after: { status: "ORDERED" }, ip: actor.ip });
    return updated;
  });
}

export async function cancelPurchaseOrder(id: string, reason: string | undefined, actor: ActorRef) {
  return prisma.$transaction(async (tx) => {
    await lockPo(tx, id);
    const po = assertFound(await tx.purchaseOrder.findUnique({ where: { id }, include: { items: true } }), "Purchase order");
    if (!["DRAFT", "ORDERED"].includes(po.status) || po.items.some((i) => i.receivedQuantity.greaterThan(0))) {
      throw unprocessable("PO_NOT_CANCELLABLE", "Only purchase orders with nothing received can be cancelled");
    }
    const updated = await tx.purchaseOrder.update({ where: { id }, data: { status: "CANCELLED" } });
    await audit(tx, { userId: actor.userId, action: "purchase_order.cancelled", entityType: "PurchaseOrder", entityId: id, before: { status: po.status }, after: { status: "CANCELLED" }, reason: reason ?? null, ip: actor.ip });
    return updated;
  });
}

// ───────────── receiving ─────────────

export interface ReceiveInput {
  items: { itemId: string; quantity: string }[];
  updateCost?: boolean;
  note?: string | null;
}

/**
 * Receive goods against a purchase order (one transaction).
 *
 * - Variant lines: stock enters via applyMovement(type RECEIVE, available +qty, purchaseOrderId).
 * - Material lines: Material.stockQty += qty.
 * - updateCost=true:
 *   - variants: weighted-average cost
 *       landedUnitCost = unitCost × (PO.total ÷ PO.subtotal)      (shipping + other costs spread by value)
 *       newCost = (onHand × currentCost + qty × landedUnitCost) ÷ (onHand + qty)
 *     where onHand = available + reserved before this receipt (never below 0) and currentCost is the
 *     variant cost override, falling back to the product cost. Stored on ProductVariant.costPrice (2 dp).
 *   - materials: Material.unitCost is set to the line's received unit cost (latest purchase price).
 */
export async function receivePurchaseOrder(id: string, input: ReceiveInput, actor: ActorRef) {
  return prisma.$transaction(
    async (tx) => {
      await lockPo(tx, id);
      const po = assertFound(await tx.purchaseOrder.findUnique({ where: { id }, include: { items: true } }), "Purchase order");
      if (!["ORDERED", "PARTIALLY_RECEIVED"].includes(po.status)) {
        throw unprocessable("PO_NOT_RECEIVABLE", `Cannot receive against a ${po.status} purchase order`);
      }
      const itemsById = new Map(po.items.map((i) => [i.id, i]));
      const seen = new Set<string>();
      const landedFactor = po.subtotal.greaterThan(0) ? new Decimal(po.total).dividedBy(po.subtotal) : new Decimal(1);
      const received: { itemId: string; description: string; quantity: string; costBefore?: string; costAfter?: string }[] = [];

      for (const line of input.items) {
        const item = itemsById.get(line.itemId);
        if (!item) throw badRequest(`Item ${line.itemId} does not belong to this purchase order`);
        if (seen.has(item.id)) throw badRequest("Each item may appear only once per receipt");
        seen.add(item.id);
        const q = qty(line.quantity);
        if (!q.greaterThan(0)) throw badRequest("Received quantity must be positive");
        const remaining = new Decimal(item.quantity).minus(item.receivedQuantity);
        if (q.greaterThan(remaining)) {
          throw unprocessable("OVER_RECEIVE", `Cannot receive ${q.toString()} of "${item.description}"; only ${remaining.toString()} outstanding`, {
            itemId: item.id, ordered: item.quantity.toString(), received: item.receivedQuantity.toString(), requested: q.toString(),
          });
        }
        const entry: (typeof received)[number] = { itemId: item.id, description: item.description, quantity: q.toString() };

        if (item.variantId) {
          if (!q.isInteger()) throw badRequest(`Quantity for "${item.description}" must be a whole number`);
          const n = q.toNumber();
          const before = await tx.inventoryLevel.findUnique({ where: { variantId: item.variantId } });
          await applyMovement(tx, {
            variantId: item.variantId, type: "RECEIVE", quantity: n, deltas: { available: n },
            reason: `Received on ${po.number}${input.note ? ` – ${input.note}` : ""}`, purchaseOrderId: po.id, userId: actor.userId,
          });
          if (input.updateCost) {
            const v = await tx.productVariant.findUniqueOrThrow({ where: { id: item.variantId }, include: { product: { select: { costPrice: true } } } });
            const current = money(v.costPrice ?? v.product.costPrice);
            const onHand = Math.max(0, (before?.available ?? 0) + (before?.reserved ?? 0));
            const landed = new Decimal(item.unitCost).times(landedFactor);
            const next = money(current.times(onHand).plus(landed.times(n)).dividedBy(onHand + n));
            await tx.productVariant.update({ where: { id: v.id }, data: { costPrice: next } });
            entry.costBefore = current.toFixed(2);
            entry.costAfter = next.toFixed(2);
          }
        } else if (item.materialId) {
          const m = await tx.material.update({
            where: { id: item.materialId },
            data: { stockQty: { increment: q }, ...(input.updateCost ? { unitCost: item.unitCost } : {}) },
          });
          if (input.updateCost) entry.costAfter = m.unitCost.toFixed(2);
        }
        await tx.purchaseItem.update({ where: { id: item.id }, data: { receivedQuantity: { increment: q } } });
        received.push(entry);
      }
      if (!received.length) throw badRequest("Nothing to receive");

      const items = await tx.purchaseItem.findMany({ where: { purchaseOrderId: id } });
      const complete = items.every((i) => !new Decimal(i.receivedQuantity).lessThan(i.quantity));
      const status: PurchaseOrderStatus = complete ? "RECEIVED" : "PARTIALLY_RECEIVED";
      const updated = await tx.purchaseOrder.update({
        where: { id },
        data: { status, ...(complete ? { receivedAt: new Date() } : {}) },
        include: { items: true },
      });
      await audit(tx, {
        userId: actor.userId, action: "purchase_order.received", entityType: "PurchaseOrder", entityId: id,
        before: { status: po.status }, after: { status, received, updateCost: !!input.updateCost }, reason: input.note ?? null, ip: actor.ip,
      });
      return updated;
    },
    { maxWait: 10_000, timeout: 30_000 },
  );
}

// ───────────── supplier payments ─────────────

export interface SupplierPaymentInput {
  amount: string;
  method: string;
  accountId: string;
  purchaseOrderId?: string | null;
  paidAt: string;
  reference?: string | null;
  note?: string | null;
}

export async function recordSupplierPayment(supplierId: string, input: SupplierPaymentInput, actor: ActorRef) {
  const amount = money(input.amount);
  if (!amount.greaterThan(0)) throw badRequest("Amount must be positive");
  return prisma.$transaction(async (tx) => {
    const supplier = assertFound(await tx.supplier.findUnique({ where: { id: supplierId } }), "Supplier");
    const account = assertFound(await tx.account.findUnique({ where: { id: input.accountId } }), "Account");
    if (!account.isActive) throw unprocessable("ACCOUNT_INACTIVE", "Account is inactive");

    let poNumber: string | null = null;
    if (input.purchaseOrderId) {
      await lockPo(tx, input.purchaseOrderId);
      const po = assertFound(await tx.purchaseOrder.findUnique({ where: { id: input.purchaseOrderId } }), "Purchase order");
      if (po.supplierId !== supplier.id) throw badRequest("Purchase order belongs to another supplier");
      if (!COMMITTED_STATUSES.includes(po.status)) throw unprocessable("PO_NOT_PAYABLE", `Cannot pay a ${po.status} purchase order`);
      const open = money(po.total).minus(po.paidAmount);
      if (amount.greaterThan(open)) {
        throw unprocessable("OVERPAYMENT", `Payment exceeds the purchase order's open balance of ${open.toFixed(2)}`, { openBalance: open.toFixed(2) });
      }
      await tx.purchaseOrder.update({ where: { id: po.id }, data: { paidAmount: { increment: amount } } });
      poNumber = po.number;
    }

    const payment = await tx.supplierPayment.create({
      data: {
        supplierId: supplier.id,
        purchaseOrderId: input.purchaseOrderId ?? null,
        accountId: account.id,
        amount,
        method: input.method,
        reference: input.reference ?? null,
        paidAt: parseDate(input.paidAt),
        note: input.note ?? null,
        createdById: actor.userId,
      },
    });
    await postEntries(tx, [
      {
        type: "SUPPLIER_PAYMENT",
        amount: amount.negated(),
        isCash: true,
        accountId: account.id,
        date: payment.paidAt,
        description: `Supplier payment – ${supplier.name}${poNumber ? ` (${poNumber})` : ""}`,
        key: `supplier_payment:${payment.id}`,
        createdById: actor.userId,
      },
    ]);
    await audit(tx, {
      userId: actor.userId, action: "supplier_payment.created", entityType: "SupplierPayment", entityId: payment.id,
      after: { supplierId: supplier.id, purchaseOrderId: payment.purchaseOrderId, amount: amount.toFixed(2), method: payment.method, accountId: account.id, reference: payment.reference },
      ip: actor.ip,
    });
    return payment;
  });
}

// ───────────── cost calculator ─────────────

export interface CostComponentInput {
  materialId?: string | null;
  description?: string | null;
  type?: string | null;
  quantity: string;
  unitCost?: string | null;
}

/** Line total = quantity × unitCost (2 dp, half-up); unitCost defaults to the material's current unit cost. */
export async function calculateCost(db: Db, components: CostComponentInput[]) {
  const ids = [...new Set(components.map((c) => c.materialId).filter((v): v is string => !!v))];
  const materials = new Map((await db.material.findMany({ where: { id: { in: ids } } })).map((m) => [m.id, m]));
  const lines = components.map((c) => {
    const m = c.materialId ? materials.get(c.materialId) : undefined;
    if (c.materialId && !m) throw badRequest(`Unknown material ${c.materialId}`);
    const quantity = qty(c.quantity);
    if (quantity.isNegative()) throw badRequest("Quantity cannot be negative");
    const unitCost = c.unitCost != null && c.unitCost !== "" ? money(c.unitCost) : money(m?.unitCost);
    if (unitCost.isNegative()) throw badRequest("Unit cost cannot be negative");
    return {
      materialId: m?.id ?? null,
      type: c.type ?? (m ? "MATERIAL" : "OTHER"),
      description: c.description?.trim() || m?.name || "",
      unit: m?.unit ?? null,
      quantity: quantity.toString(),
      unitCost: unitCost.toFixed(2),
      lineTotal: money(unitCost.times(quantity)).toFixed(2),
    };
  });
  return { lines, total: sum(lines.map((l) => l.lineTotal)).toFixed(2) };
}
