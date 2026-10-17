import type { Db } from "./prisma.js";
import { Prisma } from "../generated/prisma/client.js";

export interface AuditInput {
  userId?: string | null;
  action: string; // e.g. "order.status_changed"
  entityType: string; // e.g. "Order"
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  ip?: string | null;
}

const SENSITIVE = /password|secret|token|credential|hash/i;

/** Strip secrets and Decimal/Date objects into plain JSON for the audit trail. */
function clean(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  if (value === undefined || value === null) return Prisma.JsonNull;
  return JSON.parse(
    JSON.stringify(value, (k, v) => (k && SENSITIVE.test(k) ? "[REDACTED]" : v)),
  ) as Prisma.InputJsonValue;
}

export async function audit(db: Db, input: AuditInput) {
  await db.auditLog.create({
    data: {
      userId: input.userId ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      before: clean(input.before),
      after: clean(input.after),
      reason: input.reason ?? null,
      ip: input.ip ?? null,
    },
  });
}

/** Only the fields that actually changed, for compact before/after diffs. */
export function diff<T extends Record<string, unknown>>(before: T, after: Partial<T>) {
  const b: Record<string, unknown> = {};
  const a: Record<string, unknown> = {};
  for (const key of Object.keys(after)) {
    const prev = before[key];
    const next = after[key];
    if (JSON.stringify(prev) !== JSON.stringify(next)) {
      b[key] = prev;
      a[key] = next;
    }
  }
  return { before: b, after: a, changed: Object.keys(a).length > 0 };
}
