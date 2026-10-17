import type { PageMeta } from "@/lib/api";
import type { HomeData } from "./types";

// Server components talk to the Express API directly (absolute URL); the browser uses the /api/v1 proxy.
const API_URL = process.env.API_URL || "http://localhost:8080";

export class NotFoundError extends Error {}

/** GET a public storefront endpoint. Throws NotFoundError for 404 so pages can call notFound(). */
export async function storeFetch<T>(path: string, opts: { revalidate?: number } = {}): Promise<{ data: T; meta?: PageMeta }> {
  const res = await fetch(`${API_URL}/api/v1${path}`, {
    headers: { Accept: "application/json" },
    next: { revalidate: opts.revalidate ?? 30 },
  });
  if (res.status === 404) throw new NotFoundError(path);
  if (!res.ok) throw new Error(`Storefront API ${path} failed (${res.status})`);
  const body = (await res.json()) as { data: T; meta?: PageMeta };
  return body;
}

export const storeData = async <T,>(path: string, opts?: { revalidate?: number }) => (await storeFetch<T>(path, opts)).data;

/** Home payload (store info, announcement, footer, pixel id). Returns null if the API is down so the shell still renders. */
export async function getHome(): Promise<HomeData | null> {
  try {
    return await storeData<HomeData>("/storefront/home", { revalidate: 60 });
  } catch {
    return null;
  }
}

/** Absolute URL for OpenGraph images (relative /uploads paths are served by this origin). */
export function absoluteUrl(path: string | null | undefined) {
  if (!path) return undefined;
  if (/^https?:\/\//.test(path)) return path;
  const site = process.env.NEXT_PUBLIC_SITE_URL || process.env.CLIENT_URL?.split(",")[0] || "http://localhost:3000";
  return `${site.replace(/\/$/, "")}${path.startsWith("/") ? "" : "/"}${path}`;
}
