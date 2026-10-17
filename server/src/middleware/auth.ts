import type { NextFunction, Request, Response } from "express";
import { prisma } from "../lib/prisma.js";
import { sha256 } from "../lib/crypto.js";
import type { Permission } from "../rbac/permissions.js";

export const SESSION_COOKIE = "bb_session";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  sessionId: string;
  roles: string[];
  permissions: Set<Permission>;
}

declare module "express-serve-static-core" {
  interface Request {
    user?: AuthUser;
    /** true when the session came from the bearer header (CSRF not applicable) */
    authViaBearer?: boolean;
  }
}

const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

export function readSessionToken(req: Request): { token: string; bearer: boolean } | null {
  const header = req.header("authorization");
  if (header?.startsWith("Bearer ")) return { token: header.slice(7).trim(), bearer: true };
  const cookie = req.cookies?.[SESSION_COOKIE];
  return cookie ? { token: cookie, bearer: false } : null;
}

/** Resolves the session cookie / bearer token into req.user (permissions loaded from roles). */
export async function loadSession(req: Request, _res: Response, next: NextFunction) {
  try {
    const found = readSessionToken(req);
    if (!found) return next();

    const session = await prisma.session.findUnique({
      where: { tokenHash: sha256(found.token) },
      include: {
        user: {
          include: { roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } } },
        },
      },
    });
    const now = new Date();
    if (
      !session ||
      session.revokedAt ||
      session.expiresAt <= now ||
      session.twoFactorPending ||
      session.user.status !== "ACTIVE"
    ) {
      return next();
    }

    const permissions = new Set<Permission>();
    for (const ur of session.user.roles)
      for (const rp of ur.role.permissions) permissions.add(rp.permission.key as Permission);

    req.user = {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
      sessionId: session.id,
      roles: session.user.roles.map((r) => r.role.key),
      permissions,
    };
    req.authViaBearer = found.bearer;

    if (now.getTime() - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
      prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: now } }).catch(() => {});
    }
    next();
  } catch (err) {
    next(err);
  }
}
