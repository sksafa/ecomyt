import type { Db } from "./prisma.js";

type Seq = "order_number_seq" | "return_number_seq" | "purchase_order_number_seq" | "settlement_number_seq";

async function next(db: Db, seq: Seq): Promise<number> {
  // sequence name is from a fixed whitelist – safe to inline
  const rows = await db.$queryRawUnsafe<{ n: bigint }[]>(`SELECT nextval('${seq}') AS n`);
  return Number(rows[0].n);
}

/** BB100001 – short enough to read over the phone. */
export const nextOrderNumber = async (db: Db) => `BB${await next(db, "order_number_seq")}`;
export const nextReturnNumber = async (db: Db) => `RT${await next(db, "return_number_seq")}`;
export const nextPurchaseOrderNumber = async (db: Db) => `PO${await next(db, "purchase_order_number_seq")}`;
