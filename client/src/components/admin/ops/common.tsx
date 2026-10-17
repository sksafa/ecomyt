"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Copy, ImageUp, Loader2, X } from "lucide-react";
import { api, ApiError, errorMessage, upload } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { Tone } from "@/lib/status";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

// ───────────── URL-synced filters ─────────────

/** Filters kept in the query string (shareable, survives reload). Changing a filter resets `page`. */
export function useUrlFilters<K extends string>(keys: readonly K[]) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const filters = useMemo(
    () => Object.fromEntries(keys.map((k) => [k, params.get(k) ?? undefined]).filter(([, v]) => v)) as Partial<Record<K, string>>,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [params],
  );
  const setFilters = useCallback(
    (patch: Partial<Record<K, string | undefined>>, resetPage = true) => {
      const next = new URLSearchParams(params.toString());
      const all: Record<string, string | undefined> = { ...patch };
      if (resetPage && !("page" in patch)) all.page = undefined;
      for (const [k, v] of Object.entries(all)) {
        if (v) next.set(k, v);
        else next.delete(k);
      }
      const s = next.toString();
      router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );
  return [filters, setFilters] as const;
}

// ───────────── errors ─────────────

/** Field errors from a 422 response (keys are dotted paths), or {} for other errors. */
export const fieldErrorsOf = (e: unknown): Record<string, string> =>
  e instanceof ApiError ? Object.fromEntries(Object.entries(e.fieldErrors).map(([k, m]) => [k, /received undefined|expected string, received null/i.test(m) ? "Required" : m])) : {};
export const isForbidden = (e: unknown) => e instanceof ApiError && e.status === 403;

export function Forbidden({ what = "this page" }: { what?: string }) {
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-center text-sm text-amber-900">
      You don&apos;t have permission to view {what}. Ask an administrator if you need access.
    </div>
  );
}

// ───────────── layout bits ─────────────

/** Link tabs for a section with several routes (e.g. Shipping → Shipments / Settlements / Couriers / Zones). */
export function SubNav({ items }: { items: { href: string; label: string; show?: boolean }[] }) {
  const pathname = usePathname();
  const visible = items.filter((i) => i.show !== false);
  return (
    <nav className="-mt-1 mb-4 flex gap-1 overflow-x-auto border-b" aria-label="Section">
      {visible.map((i) => {
        const active = pathname === i.href;
        return (
          <Link
            key={i.href}
            href={i.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "shrink-0 border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              active ? "border-blue-600 text-blue-700" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {i.label}
          </Link>
        );
      })}
    </nav>
  );
}

export const SHIPPING_NAV = (can: (...p: string[]) => boolean) => [
  { href: "/admin/shipments", label: "Shipments" },
  { href: "/admin/shipments/settlements", label: "COD settlements", show: can("finance.view") },
  { href: "/admin/shipments/couriers", label: "Couriers" },
  { href: "/admin/shipments/zones", label: "Delivery zones", show: can("orders.view") },
];

/** Plain table shell that scrolls horizontally on small screens. */
export function TableShell({ children, className, minWidth = 720 }: { children: ReactNode; className?: string; minWidth?: number }) {
  return (
    <div className={cn("overflow-x-auto rounded-xl border bg-white", className)}>
      <table className="w-full text-sm" style={{ minWidth }}>
        {children}
      </table>
    </div>
  );
}
export const TH = "whitespace-nowrap border-b bg-muted/50 px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-600";
export const TD = "border-b px-3 py-2.5 align-top";

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "default" | "good" | "warn" | "bad" }) {
  return (
    <div className="rounded-xl border bg-white p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div
        className={cn(
          "mt-1 text-xl font-semibold tabular-nums",
          tone === "good" && "text-emerald-700",
          tone === "warn" && "text-amber-700",
          tone === "bad" && "text-red-700",
        )}
      >
        {value}
      </div>
      {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

/** Label + explanation + switch, for boolean settings. */
export function ToggleRow({
  id, label, description, checked, onChange, disabled,
}: { id: string; label: ReactNode; description?: ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <div>
        <label htmlFor={id} className="text-sm font-medium">{label}</label>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} disabled={disabled} />
    </div>
  );
}

export function CopyButton({ value, label = "Copy", className }: { value: string; label?: string; className?: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={className}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          toast.error("Copy failed – select the text and copy it manually");
        }
      }}
    >
      {done ? <Check className="size-4" /> : <Copy className="size-4" />} {done ? "Copied" : label}
    </Button>
  );
}

export function JsonBlock({ value, className }: { value: unknown; className?: string }) {
  if (value === null || value === undefined) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <pre className={cn("max-h-80 overflow-auto rounded-md bg-slate-950 p-3 text-xs leading-relaxed text-slate-100", className)}>
      {typeof value === "string" ? value : JSON.stringify(value, null, 2)}
    </pre>
  );
}

const fmt = (v: unknown) => (v === undefined ? "∅" : typeof v === "string" ? v : JSON.stringify(v));

/** Side-by-side before/after of the top-level keys that changed. */
export function JsonDiff({ before, after }: { before: unknown; after: unknown }) {
  const b = (before && typeof before === "object" && !Array.isArray(before) ? before : before === null || before === undefined ? {} : { value: before }) as Record<string, unknown>;
  const a = (after && typeof after === "object" && !Array.isArray(after) ? after : after === null || after === undefined ? {} : { value: after }) as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])];
  if (!keys.length) return <p className="text-xs text-muted-foreground">No data recorded.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] text-xs">
        <thead>
          <tr>
            <th className="w-40 px-2 py-1 text-left font-semibold text-muted-foreground">Field</th>
            <th className="px-2 py-1 text-left font-semibold text-red-700">Before</th>
            <th className="px-2 py-1 text-left font-semibold text-emerald-700">After</th>
          </tr>
        </thead>
        <tbody className="font-mono">
          {keys.map((k) => {
            const changed = JSON.stringify(b[k]) !== JSON.stringify(a[k]);
            return (
              <tr key={k} className={cn("border-t align-top", !changed && "text-muted-foreground")}>
                <td className="px-2 py-1 font-sans font-medium">{k}</td>
                <td className={cn("whitespace-pre-wrap break-all px-2 py-1", changed && k in b && "bg-red-50")}>{k in b ? fmt(b[k]) : "—"}</td>
                <td className={cn("whitespace-pre-wrap break-all px-2 py-1", changed && k in a && "bg-emerald-50")}>{k in a ? fmt(a[k]) : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** URL input with an "Upload" button (POST /uploads) and a thumbnail preview. */
export function ImageField({ id, value, onChange, placeholder = "https://… or /uploads/…", disabled }: { id?: string; value: string; onChange: (url: string) => void; placeholder?: string; disabled?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex items-start gap-2">
      {value ? (
        <img src={value} alt="" className="size-10 shrink-0 rounded border object-cover" />
      ) : (
        <div className="flex size-10 shrink-0 items-center justify-center rounded border border-dashed text-muted-foreground"><ImageUp className="size-4" /></div>
      )}
      <Input id={id} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} disabled={disabled} />
      <input
        ref={ref}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          setBusy(true);
          try {
            const u = await upload(f);
            onChange(u.url);
            toast.success("Image uploaded");
          } catch (err) {
            toast.error(errorMessage(err));
          } finally {
            setBusy(false);
          }
        }}
      />
      <Button type="button" variant="outline" size="sm" className="h-9 shrink-0" disabled={busy || disabled} onClick={() => ref.current?.click()}>
        {busy ? <Loader2 className="size-4 animate-spin" /> : <ImageUp className="size-4" />} Upload
      </Button>
      {value && !disabled && (
        <Button type="button" variant="ghost" size="icon" className="size-9 shrink-0" onClick={() => onChange("")} aria-label="Clear image">
          <X className="size-4" />
        </Button>
      )}
    </div>
  );
}

// ───────────── shared lookups ─────────────

export function useStaffOptions(enabled = true) {
  return useQuery({ queryKey: ["users", "options"], queryFn: () => api<{ id: string; name: string }[]>("/users/options"), staleTime: 5 * 60_000, enabled, retry: false });
}

/** Browser user agent → short "Chrome on Windows" style label. */
export function deviceLabel(ua: string | null | undefined) {
  if (!ua) return "Unknown device";
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : /curl|node|axios|Headless/i.test(ua) ? "Script / API client" : "Browser";
  const os = /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Windows/.test(ua) ? "Windows" : /Mac OS X/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${browser} on ${os}` : browser;
}

// ───────────── return status presentation ─────────────

export const RETURN_STATUS: Record<string, { label: string; tone: Tone }> = {
  REQUESTED: { label: "Requested", tone: "amber" },
  APPROVED: { label: "Approved", tone: "sky" },
  REJECTED: { label: "Rejected", tone: "red" },
  PICKUP_BOOKED: { label: "Pickup booked", tone: "violet" },
  IN_TRANSIT: { label: "In transit", tone: "blue" },
  RECEIVED: { label: "Received", tone: "indigo" },
  INSPECTED: { label: "Inspected", tone: "teal" },
  COMPLETED: { label: "Completed", tone: "green" },
  CANCELLED: { label: "Cancelled", tone: "gray" },
};
export const RETURN_FLOW = ["REQUESTED", "APPROVED", "PICKUP_BOOKED", "IN_TRANSIT", "RECEIVED", "INSPECTED", "COMPLETED"] as const;

export const REFUND_TONE: Record<string, Tone> = { PENDING: "amber", APPROVED: "sky", PAID: "green", REJECTED: "red" };

/** Convert a datetime-local input value (interpreted as Asia/Dhaka, UTC+6, no DST) to ISO. */
export function dhakaLocalToIso(v: string) {
  if (!v) return null;
  return new Date(`${v.length === 16 ? `${v}:00` : v}+06:00`).toISOString();
}
/** ISO → value for a datetime-local input, in Asia/Dhaka time. */
export function isoToDhakaLocal(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(new Date(iso).getTime() + 6 * 3_600_000);
  return d.toISOString().slice(0, 16);
}

/** Whole/fractional days since an ISO date (0 when missing). */
export const daysSince = (iso: string | null | undefined) => (iso ? (Date.now() - new Date(iso).getTime()) / 86_400_000 : 0);
