import { z } from "zod";
import type { Response } from "express";
import { createModule } from "../../http/route.js";
import { SESSION_COOKIE, readSessionToken } from "../../middleware/auth.js";
import { issueCsrfCookie } from "../../middleware/csrf.js";
import { authLimiter } from "../../middleware/rateLimit.js";
import { env } from "../../config/env.js";
import { prisma } from "../../lib/prisma.js";
import { notFound, unauthorized } from "../../lib/errors.js";
import { audit } from "../../lib/audit.js";
import * as auth from "./auth.service.js";

export const authModule = createModule("/auth", "Auth");
const { route } = authModule;

const PENDING_2FA_COOKIE = "bb_2fa";

function setSessionCookie(res: Response, name: string, token: string, maxAgeMs: number) {
  res.cookie(name, token, { httpOnly: true, sameSite: "lax", secure: env.COOKIE_SECURE, path: "/", maxAge: maxAgeMs });
}

const client = (req: { ip?: string; header(name: string): string | undefined }) => ({
  ip: req.ip,
  userAgent: req.header("user-agent"),
});

route({
  method: "get",
  path: "/csrf",
  summary: "Issue a CSRF token (double-submit cookie)",
  access: "public",
  handler: ({ res }) => ({ csrfToken: issueCsrfCookie(res) }),
});

route({
  method: "post",
  path: "/login",
  summary: "Sign in with email and password",
  description: "Sets an httpOnly session cookie. When 2FA is enabled the response has twoFactorRequired=true and the code must be sent to /auth/2fa/verify.",
  access: "public",
  middleware: [authLimiter],
  body: z.object({ email: z.string().email(), password: z.string().min(1).max(200) }),
  handler: async ({ req, res, body }) => {
    const result = await auth.login(body.email, body.password, client(req));
    if (result.twoFactorRequired) {
      setSessionCookie(res, PENDING_2FA_COOKIE, result.token, 10 * 60_000);
      return { twoFactorRequired: true };
    }
    setSessionCookie(res, SESSION_COOKIE, result.token, env.SESSION_TTL_HOURS * 3_600_000);
    const csrfToken = issueCsrfCookie(res);
    // bearer token returned for non-browser API clients; browsers rely on the httpOnly cookie
    return { twoFactorRequired: false, csrfToken, token: result.token };
  },
});

route({
  method: "post",
  path: "/2fa/verify",
  summary: "Complete sign-in with a TOTP code",
  access: "public",
  middleware: [authLimiter],
  body: z.object({ code: z.string().min(6).max(10) }),
  handler: async ({ req, res, body }) => {
    const pending = req.cookies?.[PENDING_2FA_COOKIE];
    if (!pending) throw unauthorized("Login session expired, please sign in again");
    const { token } = await auth.verifyTwoFactorLogin(pending, body.code, client(req));
    res.clearCookie(PENDING_2FA_COOKIE, { path: "/" });
    setSessionCookie(res, SESSION_COOKIE, token, env.SESSION_TTL_HOURS * 3_600_000);
    return { csrfToken: issueCsrfCookie(res), token };
  },
});

route({
  method: "post",
  path: "/logout",
  summary: "Sign out the current session",
  access: "auth",
  handler: async ({ req, res }) => {
    const found = readSessionToken(req);
    if (found) await auth.logout(found.token);
    res.clearCookie(SESSION_COOKIE, { path: "/" });
    return { loggedOut: true };
  },
});

route({
  method: "get",
  path: "/me",
  summary: "Current user, roles and effective permissions",
  access: "auth",
  handler: ({ user }) => auth.getProfile(user.id, user.permissions),
});

route({
  method: "post",
  path: "/forgot-password",
  summary: "Email a password reset link",
  description: "Always returns success to avoid revealing which emails have accounts.",
  access: "public",
  middleware: [authLimiter],
  body: z.object({ email: z.string().email() }),
  handler: async ({ body }) => {
    await auth.requestPasswordReset(body.email);
    return { message: "If the email belongs to an account, a reset link has been sent." };
  },
});

route({
  method: "post",
  path: "/reset-password",
  summary: "Set a new password using a reset token",
  access: "public",
  middleware: [authLimiter],
  body: z.object({ token: z.string().min(10), password: z.string().min(8).max(200) }),
  handler: async ({ body, ip }) => {
    await auth.resetPassword(body.token, body.password, ip);
    return { message: "Password updated. Please sign in." };
  },
});

route({
  method: "post",
  path: "/change-password",
  summary: "Change own password (signs out other devices)",
  access: "auth",
  body: z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(8).max(200) }),
  handler: async ({ user, body, ip }) => {
    await auth.changePassword(user.id, user.sessionId, body.currentPassword, body.newPassword, ip);
    return { message: "Password changed" };
  },
});

route({
  method: "post",
  path: "/2fa/setup",
  summary: "Start TOTP two-factor setup (returns secret + otpauth URL)",
  access: "auth",
  handler: ({ user }) => auth.beginTwoFactorSetup(user.id),
});

route({
  method: "post",
  path: "/2fa/enable",
  summary: "Confirm a TOTP code to enable 2FA",
  access: "auth",
  body: z.object({ code: z.string().min(6).max(10) }),
  handler: async ({ user, body, ip }) => {
    await auth.enableTwoFactor(user.id, body.code, ip);
    return { twoFactorEnabled: true };
  },
});

route({
  method: "post",
  path: "/2fa/disable",
  summary: "Disable 2FA (requires password)",
  access: "auth",
  body: z.object({ password: z.string().min(1) }),
  handler: async ({ user, body, ip }) => {
    await auth.disableTwoFactor(user.id, body.password, ip);
    return { twoFactorEnabled: false };
  },
});

route({
  method: "get",
  path: "/sessions",
  summary: "List own active sessions",
  access: "auth",
  handler: async ({ user }) => {
    const sessions = await prisma.session.findMany({
      where: { userId: user.id, revokedAt: null, twoFactorPending: false, expiresAt: { gt: new Date() } },
      orderBy: { lastSeenAt: "desc" },
      select: { id: true, ip: true, userAgent: true, createdAt: true, lastSeenAt: true, expiresAt: true },
    });
    return sessions.map((s) => ({ ...s, current: s.id === user.sessionId }));
  },
});

route({
  method: "delete",
  path: "/sessions/:id",
  summary: "Revoke one of own sessions",
  access: "auth",
  params: z.object({ id: z.string() }),
  handler: async ({ user, params, ip }) => {
    const result = await prisma.session.updateMany({
      where: { id: params.id, userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (!result.count) throw notFound("Session");
    await audit(prisma, { userId: user.id, action: "auth.session_revoked", entityType: "Session", entityId: params.id, ip });
    return { revoked: true };
  },
});

route({
  method: "get",
  path: "/login-history",
  summary: "Own recent sign-in attempts",
  access: "auth",
  handler: ({ user }) =>
    prisma.loginHistory.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, success: true, reason: true, ip: true, userAgent: true, createdAt: true },
    }),
});
