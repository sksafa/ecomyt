import type { NextFunction, Request, Response } from "express";
import { AppError } from "../lib/errors.js";
import { logger } from "../lib/logger.js";
import { Prisma } from "../generated/prisma/client.js";
import { isProd } from "../config/env.js";

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: `Route ${req.method} ${req.path} not found` } });
}

/** Central error handler: maps known errors to the standard envelope, hides internals. */
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    return res.status(err.status).json({
      success: false,
      error: { code: err.code, message: err.message, ...(err.details !== undefined ? { details: err.details } : {}) },
    });
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") {
      return res.status(409).json({
        success: false,
        error: { code: "CONFLICT", message: "A record with the same unique value already exists", details: err.meta?.target ?? err.meta },
      });
    }
    if (err.code === "P2025") {
      return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Record not found" } });
    }
    if (err.code === "P2003") {
      return res.status(409).json({ success: false, error: { code: "CONFLICT", message: "Record is referenced by other data" } });
    }
  }

  // body-parser / multer errors
  const e = err as { type?: string; status?: number; code?: string; message?: string };
  if (e?.type === "entity.parse.failed") {
    return res.status(400).json({ success: false, error: { code: "BAD_REQUEST", message: "Malformed JSON body" } });
  }
  if (e?.type === "entity.too.large" || e?.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ success: false, error: { code: "PAYLOAD_TOO_LARGE", message: "Payload too large" } });
  }

  logger.error({ err, path: req.path, method: req.method }, "unhandled error");
  res.status(500).json({
    success: false,
    error: { code: "INTERNAL", message: isProd ? "Something went wrong" : String((err as Error)?.message ?? err) },
  });
}
