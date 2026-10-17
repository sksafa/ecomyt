// Thin client for the Express API (proxied at /api/v1). Session cookie is httpOnly; state-changing
// requests echo the readable bb_csrf cookie in the x-csrf-token header (double-submit CSRF).

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
  /** Field errors from a 422 VALIDATION_ERROR response, keyed by dotted path. */
  get fieldErrors(): Record<string, string> {
    if (!Array.isArray(this.details)) return {};
    return Object.fromEntries((this.details as { path?: string; message?: string }[]).filter((d) => d.path).map((d) => [d.path!, d.message ?? "Invalid"]));
  }
}

export interface Envelope<T> {
  success: boolean;
  data: T;
  meta?: PageMeta & Record<string, unknown>;
}

export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

type Query = Record<string, string | number | boolean | null | undefined | string[]>;

export function qs(query?: Query) {
  if (!query) return "";
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0)) continue;
    p.set(k, Array.isArray(v) ? v.join(",") : String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : "";
}

function readCookie(name: string) {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return m ? decodeURIComponent(m[1]) : null;
}

let csrfPromise: Promise<string> | null = null;
async function csrfToken(): Promise<string> {
  const existing = readCookie("bb_csrf");
  if (existing) return existing;
  csrfPromise ??= fetch("/api/v1/auth/csrf", { credentials: "include" })
    .then((r) => r.json())
    .then((b: Envelope<{ csrfToken: string }>) => b.data.csrfToken)
    .finally(() => {
      csrfPromise = null;
    });
  return csrfPromise;
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  query?: Query;
  idempotencyKey?: string;
  signal?: AbortSignal;
}

/** Returns the full envelope (data + meta). */
export async function request<T>(path: string, opts: RequestOptions = {}): Promise<Envelope<T>> {
  const method = opts.method ?? (opts.body !== undefined ? "POST" : "GET");
  const headers: Record<string, string> = { Accept: "application/json" };
  const isForm = typeof FormData !== "undefined" && opts.body instanceof FormData;
  if (opts.body !== undefined && !isForm) headers["Content-Type"] = "application/json";
  if (method !== "GET") headers["x-csrf-token"] = await csrfToken();
  if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;

  const res = await fetch(`/api/v1${path}${qs(opts.query)}`, {
    method,
    headers,
    credentials: "include",
    body: opts.body === undefined ? undefined : isForm ? (opts.body as FormData) : JSON.stringify(opts.body),
    signal: opts.signal,
  });
  let payload: unknown = null;
  try {
    payload = await res.json();
  } catch {
    // non-JSON (e.g. gateway error)
  }
  if (!res.ok) {
    const err = (payload as { error?: { code?: string; message?: string; details?: unknown } } | null)?.error;
    if (res.status === 401 && typeof window !== "undefined" && !path.startsWith("/auth/")) {
      window.dispatchEvent(new CustomEvent("bb:unauthorized"));
    }
    throw new ApiError(res.status, err?.code ?? "HTTP_ERROR", err?.message ?? `Request failed (${res.status})`, err?.details);
  }
  return payload as Envelope<T>;
}

/** Returns only `data`. */
export const api = async <T>(path: string, opts?: RequestOptions) => (await request<T>(path, opts)).data;

/** Trigger a browser download for an export endpoint (cookie auth, GET). */
export function download(path: string, query?: Query) {
  const a = document.createElement("a");
  a.href = `/api/v1${path}${qs(query)}`;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export async function upload(file: File): Promise<{ id: string; url: string; filename: string }> {
  const form = new FormData();
  form.append("file", file);
  return api("/uploads", { method: "POST", body: form });
}

export const newIdempotencyKey = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export const errorMessage = (e: unknown) => (e instanceof ApiError ? e.message : e instanceof Error ? e.message : "Something went wrong");
