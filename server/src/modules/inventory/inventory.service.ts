import type { Tx } from "../../lib/prisma.js";
import { AppError, badRequest } from "../../lib/errors.js";
import type { InventoryMovementType } from "../../generated/prisma/enums.js";

export interface Deltas {
  available?: number;
  reserved?: number;
  damaged?: number;
  returned?: number;
}

export interface MovementInput {
  variantId: string;
  type: InventoryMovementType;
  quantity: number;
  deltas: Deltas;
  reason?: string | null;
  orderId?: string | null;
  purchaseOrderId?: string | null;
  returnId?: string | null;
  userId?: string | null;
}

export class InsufficientStockError extends AppError {
  constructor(details: unknown) {
    super(409, "INSUFFICIENT_STOCK", "Not enough stock for one or more items", details);
  }
}

/**
 * The only way stock changes. A single conditional UPDATE both checks and applies the change,
 * so concurrent orders cannot oversell (the row lock serialises them; the WHERE clause rejects
 * any change that would drive a bucket below zero). Every change writes an InventoryMovement.
 */
export async function applyMovement(tx: Tx, m: MovementInput) {
  if (m.quantity <= 0) throw badRequest("Quantity must be positive");
  const d = { available: 0, reserved: 0, damaged: 0, returned: 0, ...m.deltas };

  // make sure a level row exists (new variants start at zero)
  await tx.$executeRaw`INSERT INTO "InventoryLevel" ("variantId", "updatedAt") VALUES (${m.variantId}, now()) ON CONFLICT ("variantId") DO NOTHING`;

  const rows = await tx.$queryRaw<{ available: number; reserved: number }[]>`
    UPDATE "InventoryLevel"
       SET "available" = "available" + ${d.available}::int,
           "reserved"  = "reserved"  + ${d.reserved}::int,
           "damaged"   = "damaged"   + ${d.damaged}::int,
           "returned"  = "returned"  + ${d.returned}::int,
           "updatedAt" = now()
     WHERE "variantId" = ${m.variantId}
       AND "available" + ${d.available}::int >= 0
       AND "reserved"  + ${d.reserved}::int  >= 0
       AND "damaged"   + ${d.damaged}::int   >= 0
       AND "returned"  + ${d.returned}::int  >= 0
     RETURNING "available", "reserved"`;

  if (rows.length === 0) {
    const level = await tx.inventoryLevel.findUnique({ where: { variantId: m.variantId }, include: { variant: { select: { sku: true } } } });
    throw new InsufficientStockError([{ variantId: m.variantId, sku: level?.variant.sku, requested: m.quantity, available: level?.available ?? 0, reserved: level?.reserved ?? 0 }]);
  }

  await tx.inventoryMovement.create({
    data: {
      variantId: m.variantId,
      type: m.type,
      quantity: m.quantity,
      availableDelta: d.available,
      reservedDelta: d.reserved,
      damagedDelta: d.damaged,
      returnedDelta: d.returned,
      availableAfter: rows[0].available,
      reason: m.reason ?? null,
      orderId: m.orderId ?? null,
      purchaseOrderId: m.purchaseOrderId ?? null,
      returnId: m.returnId ?? null,
      userId: m.userId ?? null,
    },
  });
  return rows[0];
}

type Line = { variantId: string | null; quantity: number };

/** Aggregate quantities per variant and process in a stable order (prevents deadlocks between concurrent orders). */
function grouped(lines: Line[]) {
  const map = new Map<string, number>();
  for (const l of lines) if (l.variantId) map.set(l.variantId, (map.get(l.variantId) ?? 0) + l.quantity);
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
}

async function forEachLine(tx: Tx, lines: Line[], fn: (variantId: string, qty: number) => Promise<unknown>) {
  const failures: unknown[] = [];
  for (const [variantId, qty] of grouped(lines)) {
    try {
      await fn(variantId, qty);
    } catch (err) {
      if (err instanceof InsufficientStockError) failures.push(...(err.details as unknown[]));
      else throw err;
    }
  }
  if (failures.length) throw new InsufficientStockError(failures);
}

const ctx = (orderId: string, userId?: string | null) => ({ orderId, userId: userId ?? null });

/** available → reserved */
export const reserveForOrder = (tx: Tx, orderId: string, lines: Line[], userId?: string | null) =>
  forEachLine(tx, lines, (variantId, qty) =>
    applyMovement(tx, { variantId, type: "RESERVE", quantity: qty, deltas: { available: -qty, reserved: qty }, reason: "Reserved for order", ...ctx(orderId, userId) }),
  );

/** reserved → available (order cancelled or edited before shipping) */
export const releaseForOrder = (tx: Tx, orderId: string, lines: Line[], userId?: string | null, reason = "Reservation released") =>
  forEachLine(tx, lines, (variantId, qty) =>
    applyMovement(tx, { variantId, type: "RELEASE", quantity: qty, deltas: { available: qty, reserved: -qty }, reason, ...ctx(orderId, userId) }),
  );

/** Goods leave the warehouse: reserved (or available, for un-reserved pre-orders) → out */
export const fulfillForOrder = (tx: Tx, orderId: string, lines: Line[], fromReserved: boolean, userId?: string | null) =>
  forEachLine(tx, lines, (variantId, qty) =>
    applyMovement(tx, {
      variantId, type: "FULFILL", quantity: qty,
      deltas: fromReserved ? { reserved: -qty } : { available: -qty },
      reason: "Shipped to customer", ...ctx(orderId, userId),
    }),
  );

/** Parcel physically back at the warehouse → awaiting inspection */
export const receiveReturned = (tx: Tx, returnId: string, orderId: string, lines: Line[], userId?: string | null) =>
  forEachLine(tx, lines, (variantId, qty) =>
    applyMovement(tx, { variantId, type: "RETURN_RECEIVED", quantity: qty, deltas: { returned: qty }, reason: "Returned parcel received", returnId, orderId, userId }),
  );

/** Inspection outcome for returned stock */
export async function dispositionReturned(
  tx: Tx,
  variantId: string,
  qty: number,
  decision: "RESTOCK" | "DAMAGED" | "DISPOSE",
  refs: { returnId: string; orderId: string; userId?: string | null; reason?: string },
) {
  const deltas: Deltas =
    decision === "RESTOCK" ? { returned: -qty, available: qty } : decision === "DAMAGED" ? { returned: -qty, damaged: qty } : { returned: -qty };
  const type = decision === "RESTOCK" ? "RESTOCK" : decision === "DAMAGED" ? "DAMAGE" : "DISPOSE";
  return applyMovement(tx, { variantId, type, quantity: qty, deltas, reason: refs.reason ?? `Return inspection: ${decision.toLowerCase()}`, returnId: refs.returnId, orderId: refs.orderId, userId: refs.userId });
}
