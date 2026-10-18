import type { NextFunction, Request, Response } from "express";
import { randomToken, safeEqual } from "../lib/crypto.js";
import { AppError } from "../lib/errors.js";
import { env } from "../config/env.js";

export const CSRF_COOKIE = "bb_csrf";
export const CSRF_HEADER = "x-csrf-token";

const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);
// Server-to-server callbacks are authenticated by signatures, not cookies.
// Tracking mirror events change no business state and may be sent as beacons while a page unloads.
const EXEMPT_PREFIXES = ["/api/v1/webhooks/", "/api/v1/payments/callback/", "/api/v1/storefront/events"];

export function issueCsrfCookie(res: Response): string {
  const token = randomToken(24);
  res.cookie(CSRF_COOKIE, token, {
    httpOnly: false, // must be readable by the SPA to echo it back in the header
    sameSite: "lax",
    secure: env.COOKIE_SECURE,
    path: "/",
  });
  return token;
}

/**
 * Double-submit cookie CSRF protection for cookie-authenticated, state-changing requests.
 * Bearer-token requests are not vulnerable to CSRF (the browser never attaches them automatically).
 */
export function csrfProtection(req: Request, _res: Response, next: NextFunction) {
  if (SAFE.has(req.method) || req.authViaBearer) return next();
  if (EXEMPT_PREFIXES.some((p) => req.originalUrl.startsWith(p))) return next();
  // Requests without any session cookie (e.g. login, public storefront checkout) still need a token
  // when a session cookie exists; anonymous requests carry no ambient authority.
  if (!req.cookies?.bb_session) return next();

  const cookie = req.cookies?.[CSRF_COOKIE];
  const header = req.header(CSRF_HEADER);
  if (!cookie || !header || !safeEqual(cookie, header)) {
    return next(new AppError(403, "CSRF_FAILED", "Missing or invalid CSRF token"));
  }
  next();
}
