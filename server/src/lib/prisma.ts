import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, Prisma } from "../generated/prisma/client.js";
import { env } from "../config/env.js";

export const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: env.DATABASE_URL }),
});

export type Tx = Prisma.TransactionClient;
export type Db = PrismaClient | Tx;
export { Prisma };

/** Run fn in a transaction, reusing the given client if it already is one. */
export async function withTx<T>(db: Db, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if ("$transaction" in db) {
    return (db as PrismaClient).$transaction(fn, { maxWait: 10_000, timeout: 30_000 });
  }
  return fn(db as Tx);
}
