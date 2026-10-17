import argon2 from "argon2";
import { generateSecret, generateURI, verify as verifyTotp } from "otplib";
import { prisma } from "../../lib/prisma.js";
import { decrypt, encrypt, randomToken, sha256 } from "../../lib/crypto.js";
import { AppError, badRequest, unauthorized } from "../../lib/errors.js";
import { env } from "../../config/env.js";
import { audit } from "../../lib/audit.js";
import { sendMail } from "../../lib/mailer.js";

export const MAX_FAILED_LOGINS = 5;
export const LOCKOUT_MINUTES = 15;
const RESET_TOKEN_MINUTES = 30;

export const hashPassword = (password: string) => argon2.hash(password, { type: argon2.argon2id });

// Hash used to keep timing similar when the email does not exist (prevents user enumeration).
let dummyHash: string | null = null;
const getDummyHash = async () => (dummyHash ??= await hashPassword("not-a-real-password-for-timing"));

export const passwordPolicy = (password: string) => {
  if (password.length < 8) throw badRequest("Password must be at least 8 characters");
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    throw badRequest("Password must contain letters and numbers");
  }
};

interface ClientInfo {
  ip?: string;
  userAgent?: string;
}

async function recordLogin(email: string, userId: string | null, success: boolean, reason: string | null, client: ClientInfo) {
  await prisma.loginHistory.create({
    data: { email, userId, success, reason, ip: client.ip, userAgent: client.userAgent?.slice(0, 300) },
  });
}

async function createSession(userId: string, client: ClientInfo, twoFactorPending: boolean) {
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + (twoFactorPending ? 10 * 60_000 : env.SESSION_TTL_HOURS * 3_600_000));
  const session = await prisma.session.create({
    data: { userId, tokenHash: sha256(token), ip: client.ip, userAgent: client.userAgent?.slice(0, 300), expiresAt, twoFactorPending },
  });
  return { token, session };
}

export async function login(emailInput: string, password: string, client: ClientInfo) {
  const email = emailInput.trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { email } });

  if (!user) {
    await argon2.verify(await getDummyHash(), password).catch(() => false);
    await recordLogin(email, null, false, "unknown_email", client);
    throw unauthorized("Invalid email or password");
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    await recordLogin(email, user.id, false, "locked", client);
    throw new AppError(423, "ACCOUNT_LOCKED", `Too many failed attempts. Try again after ${user.lockedUntil.toISOString()}`);
  }

  const ok = await argon2.verify(user.passwordHash, password).catch(() => false);
  if (!ok) {
    const failed = user.failedLoginCount + 1;
    const lock = failed >= MAX_FAILED_LOGINS;
    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount: lock ? 0 : failed,
        lockedUntil: lock ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000) : null,
      },
    });
    await recordLogin(email, user.id, false, lock ? "bad_password_locked" : "bad_password", client);
    throw unauthorized("Invalid email or password");
  }
  if (user.status !== "ACTIVE") {
    await recordLogin(email, user.id, false, "disabled", client);
    throw new AppError(403, "ACCOUNT_DISABLED", "This account is disabled");
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { failedLoginCount: 0, lockedUntil: null, ...(user.twoFactorEnabled ? {} : { lastLoginAt: new Date() }) },
  });

  if (user.twoFactorEnabled) {
    const { token } = await createSession(user.id, client, true);
    await recordLogin(email, user.id, true, "password_ok_2fa_pending", client);
    return { token, twoFactorRequired: true as const };
  }

  const { token } = await createSession(user.id, client, false);
  await recordLogin(email, user.id, true, null, client);
  return { token, twoFactorRequired: false as const };
}

/** Second step: exchange a 2FA-pending session for a full one. */
export async function verifyTwoFactorLogin(pendingToken: string, code: string, client: ClientInfo) {
  const pending = await prisma.session.findUnique({ where: { tokenHash: sha256(pendingToken) }, include: { user: true } });
  if (!pending || !pending.twoFactorPending || pending.revokedAt || pending.expiresAt < new Date()) {
    throw unauthorized("Login session expired, please sign in again");
  }
  const secret = pending.user.twoFactorSecret ? decrypt(pending.user.twoFactorSecret) : null;
  const valid = secret ? (await verifyTotp({ secret, token: code.replace(/\s/g, "") })).valid : false;
  if (!valid) {
    await recordLogin(pending.user.email, pending.userId, false, "bad_2fa_code", client);
    throw unauthorized("Invalid authentication code");
  }
  await prisma.session.update({ where: { id: pending.id }, data: { revokedAt: new Date() } });
  await prisma.user.update({ where: { id: pending.userId }, data: { lastLoginAt: new Date() } });
  const { token } = await createSession(pending.userId, client, false);
  await recordLogin(pending.user.email, pending.userId, true, "2fa_ok", client);
  return { token };
}

export async function logout(token: string) {
  await prisma.session.updateMany({ where: { tokenHash: sha256(token), revokedAt: null }, data: { revokedAt: new Date() } });
}

export async function getProfile(userId: string, permissions: Set<string>) {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: {
      id: true, email: true, name: true, phone: true, twoFactorEnabled: true, lastLoginAt: true,
      roles: { select: { role: { select: { key: true, name: true } } } },
    },
  });
  return { ...user, roles: user.roles.map((r) => r.role), permissions: [...permissions].sort() };
}

export async function requestPasswordReset(emailInput: string) {
  const email = emailInput.trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { email } });
  // Always succeed from the caller's point of view (no account enumeration).
  if (!user || user.status !== "ACTIVE") return;
  const token = randomToken(32);
  await prisma.passwordResetToken.create({
    data: { userId: user.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + RESET_TOKEN_MINUTES * 60_000) },
  });
  const link = `${env.CLIENT_URL.split(",")[0]}/reset-password?token=${token}`;
  await sendMail(
    user.email,
    "Reset your Bent & Bound password",
    `Hi ${user.name},\n\nUse this link within ${RESET_TOKEN_MINUTES} minutes to set a new password:\n${link}\n\nIf you did not request this, ignore this email.`,
  );
}

export async function resetPassword(token: string, newPassword: string, ip?: string) {
  passwordPolicy(newPassword);
  const row = await prisma.passwordResetToken.findUnique({ where: { tokenHash: sha256(token) } });
  if (!row || row.usedAt || row.expiresAt < new Date()) throw badRequest("Reset link is invalid or has expired");
  const passwordHash = await hashPassword(newPassword);
  await prisma.$transaction(async (tx) => {
    // mark used first; a concurrent second use fails the conditional update
    const used = await tx.passwordResetToken.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } });
    if (used.count === 0) throw badRequest("Reset link has already been used");
    await tx.user.update({
      where: { id: row.userId },
      data: { passwordHash, passwordChangedAt: new Date(), failedLoginCount: 0, lockedUntil: null },
    });
    await tx.session.updateMany({ where: { userId: row.userId, revokedAt: null }, data: { revokedAt: new Date() } });
    await audit(tx, { userId: row.userId, action: "auth.password_reset", entityType: "User", entityId: row.userId, ip });
  });
}

export async function changePassword(userId: string, currentSessionId: string, current: string, next: string, ip?: string) {
  passwordPolicy(next);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (!(await argon2.verify(user.passwordHash, current).catch(() => false))) throw badRequest("Current password is incorrect");
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(next), passwordChangedAt: new Date() } });
    // sign out every other device
    await tx.session.updateMany({ where: { userId, revokedAt: null, id: { not: currentSessionId } }, data: { revokedAt: new Date() } });
    await audit(tx, { userId, action: "auth.password_changed", entityType: "User", entityId: userId, ip });
  });
}

export async function beginTwoFactorSetup(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (user.twoFactorEnabled) throw badRequest("Two-factor authentication is already enabled");
  const secret = generateSecret();
  await prisma.user.update({ where: { id: userId }, data: { twoFactorSecret: encrypt(secret) } });
  return { secret, otpauthUrl: generateURI({ issuer: "Bent & Bound", label: user.email, secret }) };
}

export async function enableTwoFactor(userId: string, code: string, ip?: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (!user.twoFactorSecret) throw badRequest("Start two-factor setup first");
  const { valid } = await verifyTotp({ secret: decrypt(user.twoFactorSecret), token: code.replace(/\s/g, "") });
  if (!valid) throw badRequest("Invalid authentication code");
  await prisma.user.update({ where: { id: userId }, data: { twoFactorEnabled: true } });
  await audit(prisma, { userId, action: "auth.2fa_enabled", entityType: "User", entityId: userId, ip });
}

export async function disableTwoFactor(userId: string, password: string, ip?: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (!(await argon2.verify(user.passwordHash, password).catch(() => false))) throw badRequest("Password is incorrect");
  await prisma.user.update({ where: { id: userId }, data: { twoFactorEnabled: false, twoFactorSecret: null } });
  await audit(prisma, { userId, action: "auth.2fa_disabled", entityType: "User", entityId: userId, ip });
}
