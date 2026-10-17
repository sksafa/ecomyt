import type { Request } from "express";
import { prisma } from "../lib/prisma.js";
import { sha256 } from "../lib/crypto.js";
import { conflict } from "../lib/errors.js";
import { Prisma } from "../generated/prisma/client.js";

type Payload = { status: number; body: unknown };

const inFlight = new Set<string>();

/**
 * Idempotent create: the first response for (user, Idempotency-Key) is stored and replayed for retries.
 * A different body with the same key is rejected. Concurrent duplicates are rejected while in flight;
 * the DB primary key on the record makes the final write race-safe across processes.
 */
export async function withIdempotency(
  req: Request,
  status: number,
  run: () => Promise<unknown>,
): Promise<Payload> {
  const header = req.header("idempotency-key");
  if (!header) return { status, body: await run() };
  if (header.length > 200) throw conflict("Idempotency-Key is too long");

  const key = sha256(`${req.user?.id ?? "anon"}:${req.method}:${req.baseUrl}${req.path}:${header}`);
  const requestHash = sha256(JSON.stringify(req.body ?? {}));

  const existing = await prisma.idempotencyRecord.findUnique({ where: { key } });
  if (existing) {
    if (existing.requestHash !== requestHash) {
      throw conflict("Idempotency-Key was already used with a different request body");
    }
    return { status: existing.responseStatus, body: existing.responseBody };
  }
  if (inFlight.has(key)) throw conflict("A request with this Idempotency-Key is already being processed");

  inFlight.add(key);
  try {
    const body = await run();
    try {
      await prisma.idempotencyRecord.create({
        data: {
          key,
          userId: req.user?.id,
          method: req.method,
          path: `${req.baseUrl}${req.path}`,
          requestHash,
          responseStatus: status,
          responseBody: body as Prisma.InputJsonValue,
        },
      });
    } catch (err) {
      // another process stored the same key first – replay theirs for consistency
      const winner = await prisma.idempotencyRecord.findUnique({ where: { key } });
      if (winner) return { status: winner.responseStatus, body: winner.responseBody };
      throw err;
    }
    return { status, body };
  } finally {
    inFlight.delete(key);
  }
}
