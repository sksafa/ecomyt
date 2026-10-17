import express, { Router } from "express";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import { pinoHttp } from "pino-http";
import swaggerUi from "swagger-ui-express";
import { UPLOAD_DIR } from "./config/paths.js";
import { env } from "./config/env.js";
import { logger } from "./lib/logger.js";
import { prisma } from "./lib/prisma.js";
import { loadSession } from "./middleware/auth.js";
import { csrfProtection } from "./middleware/csrf.js";
import { apiLimiter } from "./middleware/rateLimit.js";
import { errorHandler, notFoundHandler } from "./middleware/error.js";
import { buildOpenApiDocument } from "./http/openapi.js";
import { modules } from "./modules/index.js";
import { registerListeners as registerMarketingListeners } from "./modules/marketing/listeners.js";
import { registerListeners as registerNotificationListeners } from "./modules/notifications/listeners.js";

let listenersRegistered = false;

export function createApp() {
  if (!listenersRegistered) {
    registerMarketingListeners();
    registerNotificationListeners();
    listenersRegistered = true;
  }
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1); // behind Next.js rewrite / reverse proxy

  app.use(helmet({ crossOriginResourcePolicy: { policy: "same-site" } }));
  app.use(
    cors({
      origin: env.CLIENT_URL.split(",").map((o) => o.trim()),
      credentials: true,
    }),
  );
  app.use(
    pinoHttp({
      logger,
      autoLogging: { ignore: (req) => req.url === "/api/v1/health" },
      customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info"),
    }),
  );
  // raw body kept for webhook signature verification
  app.use(
    express.json({
      limit: "1mb",
      verify: (req, _res, buf) => {
        (req as express.Request & { rawBody?: Buffer }).rawBody = buf;
      },
    }),
  );
  app.use(express.urlencoded({ extended: false, limit: "1mb" }));
  app.use(cookieParser());

  // Uploaded files (validated on upload); served with nosniff so they cannot be executed as HTML.
  app.use("/uploads", express.static(UPLOAD_DIR, { fallthrough: false, index: false, setHeaders: (res) => res.setHeader("X-Content-Type-Options", "nosniff") }));

  const api = Router();
  api.get("/health", async (_req, res) => {
    let db = "ok";
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch {
      db = "down";
    }
    res.status(db === "ok" ? 200 : 503).json({ success: db === "ok", data: { status: db === "ok" ? "ok" : "degraded", db, time: new Date().toISOString() } });
  });

  api.use(apiLimiter);
  api.use(loadSession);
  api.use(csrfProtection);
  for (const m of modules) api.use(m.router);

  const openapi = buildOpenApiDocument();
  api.get("/openapi.json", (_req, res) => res.json(openapi));
  api.use("/docs", swaggerUi.serve, swaggerUi.setup(openapi, { customSiteTitle: "Bent & Bound API" }));

  app.use("/api/v1", api);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
