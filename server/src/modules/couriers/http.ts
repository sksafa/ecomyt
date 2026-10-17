import { prisma, Prisma } from "../../lib/prisma.js";
import { logger } from "../../lib/logger.js";
import { CourierError, type CourierContext } from "./types.js";

const SECRET_KEYS = /pass(word)?|secret|token|api[-_]?key|authorization|client_secret|refresh/i;
const PII_KEYS = /phone|mobile|recipient_number/i;

/** Redact secrets fully and mask phone numbers in courier API logs. */
export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        SECRET_KEYS.test(k) ? "[REDACTED]" : PII_KEYS.test(k) && typeof v === "string" ? v.replace(/\d(?=\d{3})/g, "•") : redact(v),
      ]),
    );
  }
  return value;
}

export async function logCourierCall(
  ctx: Pick<CourierContext, "providerId" | "shipmentId">,
  operation: string,
  data: { request?: unknown; response?: unknown; statusCode?: number; success: boolean; durationMs: number; error?: string },
) {
  try {
    await prisma.courierApiLog.create({
      data: {
        providerId: ctx.providerId,
        shipmentId: ctx.shipmentId ?? null,
        operation,
        request: (redact(data.request) ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        response: (redact(data.response) ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        statusCode: data.statusCode ?? null,
        success: data.success,
        durationMs: data.durationMs,
        error: data.error?.slice(0, 1000) ?? null,
      },
    });
  } catch (err) {
    logger.warn({ err }, "failed to write courier api log");
  }
}

/**
 * JSON HTTP call to a courier API with timeout, retry classification and redacted logging.
 * Never retries by itself – the booking workflow decides (after a duplicate-safe lookup).
 */
export async function courierFetch<T = unknown>(
  ctx: CourierContext,
  operation: string,
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: unknown; timeoutMs?: number } = {},
): Promise<T> {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init.timeoutMs ?? 15_000);
  let status: number | undefined;
  let parsed: unknown;
  try {
    const res = await fetch(url, {
      method: init.method ?? (init.body ? "POST" : "GET"),
      headers: { Accept: "application/json", ...(init.body ? { "Content-Type": "application/json" } : {}), ...init.headers },
      body: init.body ? JSON.stringify(init.body) : undefined,
      signal: controller.signal,
    });
    status = res.status;
    const text = await res.text();
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = { nonJson: text.slice(0, 2000) };
    }
    const ok = res.ok;
    await logCourierCall(ctx, operation, { request: { url, body: init.body }, response: parsed, statusCode: status, success: ok, durationMs: Date.now() - started });
    if (!ok) {
      const message = extractMessage(parsed) ?? `HTTP ${status}`;
      throw new CourierError(message, status >= 500 || status === 429 || status === 408, status);
    }
    return parsed as T;
  } catch (err) {
    if (err instanceof CourierError) throw err;
    const aborted = (err as Error).name === "AbortError";
    const message = aborted ? "Courier API timed out" : `Courier API unreachable: ${(err as Error).message}`;
    await logCourierCall(ctx, operation, { request: { url, body: init.body }, statusCode: status, success: false, durationMs: Date.now() - started, error: message });
    throw new CourierError(message, true);
  } finally {
    clearTimeout(timer);
  }
}

function extractMessage(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  for (const k of ["message", "error", "errors", "msg"]) {
    const v = b[k];
    if (typeof v === "string") return v;
    if (v && typeof v === "object") return JSON.stringify(v).slice(0, 300);
  }
  return null;
}
