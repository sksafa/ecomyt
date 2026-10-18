import { z } from "zod";

const bool = z
  .string()
  .optional()
  .transform((v) => v === "true" || v === "1");

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(8080),
  CLIENT_URL: z.string().default("http://localhost:3000"),
  API_PUBLIC_URL: z.string().default("http://localhost:8080"),
  LOG_LEVEL: z.string().default("info"),
  DATABASE_URL: z.string().min(1),
  TEST_DATABASE_URL: z.string().optional(),
  REDIS_URL: z.string().default("redis://127.0.0.1:6390"),
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 characters"),
  ENCRYPTION_KEY: z.string().regex(/^[0-9a-f]{64}$/i, "ENCRYPTION_KEY must be 64 hex characters"),
  SESSION_TTL_HOURS: z.coerce.number().positive().default(12),
  COOKIE_SECURE: bool,
  DEMO_MODE: bool,
  SMTP_URL: z.string().optional().default(""),
  MAIL_FROM: z.string().default("Bent & Bound <no-reply@bentandbound.com>"),
  META_PIXEL_ID: z.string().optional().default(""),
  META_CAPI_ACCESS_TOKEN: z.string().optional().default(""),
  META_TEST_EVENT_CODE: z.string().optional().default(""),
  META_GRAPH_VERSION: z.string().regex(/^v\d+\.\d+$/).default("v21.0"),
  // overridable only for local verification against a recording stub – production must use Meta's endpoint
  META_GRAPH_BASE_URL: z.string().url().default("https://graph.facebook.com"),
  WHATSAPP_ACCESS_TOKEN: z.string().optional().default(""),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional().default(""),
  SSLCOMMERZ_STORE_ID: z.string().optional().default(""),
  SSLCOMMERZ_STORE_PASSWORD: z.string().optional().default(""),
  SSLCOMMERZ_SANDBOX: z
    .string()
    .optional()
    .transform((v) => v !== "false"),
  // tests run without Redis-backed queues unless explicitly enabled
  QUEUES_ENABLED: z
    .string()
    .optional()
    .transform((v) => v !== "false"),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment configuration:");
  for (const issue of parsed.error.issues) console.error(`  ${issue.path.join(".")}: ${issue.message}`);
  process.exit(1);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === "production";
export const isTest = env.NODE_ENV === "test";

if (isProd && !env.COOKIE_SECURE) {
  console.error("COOKIE_SECURE must be true in production (HTTPS only cookies).");
  process.exit(1);
}
