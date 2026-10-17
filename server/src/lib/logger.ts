import pino from "pino";
import { createRequire } from "node:module";
import { env, isProd, isTest } from "../config/env.js";

// Never log secrets or full credentials; these paths are redacted everywhere.
export const REDACT_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  'res.headers["set-cookie"]',
  "*.password",
  "*.passwordHash",
  "*.newPassword",
  "*.token",
  "*.apiKey",
  "*.secretKey",
  "*.clientSecret",
  "*.credentials",
  "*.twoFactorSecret",
];

// pretty output only when the dev-only pino-pretty package is installed (it is not in production images)
const hasPretty = (() => {
  try {
    createRequire(import.meta.url).resolve("pino-pretty");
    return true;
  } catch {
    return false;
  }
})();

export const logger = pino({
  level: isTest ? "silent" : env.LOG_LEVEL,
  redact: { paths: REDACT_PATHS, censor: "[REDACTED]" },
  ...(isProd || isTest || !hasPretty
    ? {}
    : { transport: { target: "pino-pretty", options: { colorize: true, translateTime: "SYS:HH:MM:ss" } } }),
});
