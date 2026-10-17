import { randomBytes } from "node:crypto";

/** Unguessable, URL-safe file id. */
export const createId = () => `${Date.now().toString(36)}${randomBytes(9).toString("base64url")}`;
