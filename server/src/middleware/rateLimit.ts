import rateLimit, { type Options } from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import { getRedis } from "../lib/redis.js";
import { env, isTest } from "../config/env.js";

function store(prefix: string): Options["store"] | undefined {
  if (isTest || !env.QUEUES_ENABLED) return undefined; // in-memory store in tests
  const redis = getRedis();
  return new RedisStore({
    prefix: `rl:${prefix}:`,
    sendCommand: (...args: string[]) => redis.call(args[0], ...args.slice(1)) as never,
  });
}

const handler: Options["handler"] = (_req, res) => {
  res.status(429).json({ success: false, error: { code: "RATE_LIMITED", message: "Too many requests, please try again later" } });
};

/** General API ceiling per IP. */
export const apiLimiter = rateLimit({
  windowMs: 60_000,
  limit: isTest ? 100_000 : 600,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  store: store("api"),
  handler,
});

/** Login / password reset: slows credential stuffing (per-account lockout lives in the auth service). */
export const authLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: isTest ? 100_000 : 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  store: store("auth"),
  handler,
});

/** Public storefront writes (checkout) – generous but bounded. */
export const storefrontLimiter = rateLimit({
  windowMs: 10 * 60_000,
  limit: isTest ? 100_000 : 60,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  store: store("store"),
  handler,
});
