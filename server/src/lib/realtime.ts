import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import type { Redis } from "ioredis";
import { getRedis } from "./redis.js";
import { logger } from "./logger.js";
import { queuesEnabled } from "../jobs/queues.js";

/**
 * Realtime fan-out for the admin UI (Server-Sent Events).
 *
 * Changes can happen in any process (API instances, the background worker), so every published message
 * goes through Redis pub/sub and each API process forwards it to its own connected browsers. Without
 * Redis (tests, QUEUES_ENABLED=false) delivery stays in-process.
 *
 * This is a notification channel only – browsers re-fetch data from the API, so a missed or repeated
 * message can never create or duplicate a record. Domain side effects (notifications, Meta CAPI) do not
 * use this channel; they stay on the in-process order event bus so they run exactly once.
 */
export interface RealtimeMessage {
  topic: "orders";
  type: string;
  orderId?: string;
  orderNumber?: string;
  status?: string;
  from?: string;
  channel?: string;
  name?: string;
  total?: string;
  at: string;
}

const CHANNEL = "bb:realtime";
const ORIGIN = randomUUID(); // identifies this process so it ignores its own Redis echoes
const local = new EventEmitter();
local.setMaxListeners(0);

let subscriber: Redis | null = null;
let subscribing: Promise<void> | null = null;

/** Start receiving messages published by other processes (idempotent). Called by the API on boot. */
export function startRealtime() {
  if (!queuesEnabled() || subscribing) return subscribing;
  subscriber = getRedis().duplicate();
  subscriber.on("error", (err) => logger.warn({ err: err.message }, "realtime subscriber error"));
  subscriber.on("message", (_channel, raw) => {
    try {
      const { origin, message } = JSON.parse(raw) as { origin: string; message: RealtimeMessage };
      if (origin !== ORIGIN) local.emit("message", message);
    } catch {
      // ignore malformed payloads
    }
  });
  subscribing = subscriber.subscribe(CHANNEL).then(() => undefined);
  return subscribing;
}

export async function stopRealtime() {
  local.emit("shutdown");
  if (subscriber) {
    await subscriber.quit().catch(() => {});
    subscriber = null;
    subscribing = null;
  }
}

/** Publish to browsers connected to every API process. Never throws. */
export function publishRealtime(message: Omit<RealtimeMessage, "at">) {
  const full: RealtimeMessage = { ...message, at: new Date().toISOString() };
  local.emit("message", full);
  if (!queuesEnabled()) return;
  getRedis()
    .publish(CHANNEL, JSON.stringify({ origin: ORIGIN, message: full }))
    .catch((err) => logger.warn({ err: err.message }, "realtime publish failed"));
}

export function onRealtime(listener: (m: RealtimeMessage) => void) {
  local.on("message", listener);
  return () => local.off("message", listener);
}

/** Lets open streams close cleanly on shutdown (otherwise server.close would wait for them). */
export function onRealtimeShutdown(listener: () => void) {
  local.on("shutdown", listener);
  return () => local.off("shutdown", listener);
}
