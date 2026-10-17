import { prisma } from "../../lib/prisma.js";

export async function nextSettlementRef() {
  const rows = await prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT nextval('settlement_number_seq') AS n`);
  return `ST${Number(rows[0].n)}`;
}
