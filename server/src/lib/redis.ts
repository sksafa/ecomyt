import { Redis } from "ioredis";
import { env } from "../config/env.js";
import { logger } from "./logger.js";

let client: Redis | null = null;

/** Shared Redis connection (rate limiting, queues). maxRetriesPerRequest=null is required by BullMQ. */
export function getRedis(): Redis {
  if (!client) {
    client = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: false });
    client.on("error", (err) => logger.warn({ err: err.message }, "redis error"));
  }
  return client;
}

export async function closeRedis() {
  if (client) {
    await client.quit().catch(() => {});
    client = null;
  }
}
