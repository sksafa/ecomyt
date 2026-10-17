import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "../config/env.js";

const key = Buffer.from(env.ENCRYPTION_KEY, "hex");

/** AES-256-GCM for secrets at rest (courier / payment credentials, 2FA secrets). */
export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64"), tag.toString("base64"), data.toString("base64")].join(":");
}

export function decrypt(payload: string): string {
  const [version, iv, tag, data] = payload.split(":");
  if (version !== "v1" || !iv || !tag || !data) throw new Error("Unsupported ciphertext");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
}

export function encryptJson(value: unknown): string {
  return encrypt(JSON.stringify(value));
}

export function decryptJson<T = Record<string, string>>(payload: string | null | undefined): T | null {
  if (!payload) return null;
  return JSON.parse(decrypt(payload)) as T;
}

export const randomToken = (bytes = 32) => randomBytes(bytes).toString("base64url");

/** Session / reset tokens are stored as SHA-256 so a DB leak does not leak live tokens. */
export const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

export function hmacSha256(secret: string, payload: string | Buffer, encoding: "hex" | "base64" = "hex") {
  return createHmac("sha256", secret).update(payload).digest(encoding);
}

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}
