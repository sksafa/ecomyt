"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ImageOff, Search, ShieldOff, X } from "lucide-react";
import { api, request } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import type { Tone } from "@/lib/status";

// ───────────── shared types ─────────────

export interface Category { id: string; name: string; slug: string; parentId: string | null; description: string | null; imageUrl: string | null; sortOrder: number; isActive: boolean; _count?: { products: number } }
export interface Collection { id: string; name: string; slug: string; description: string | null; imageUrl: string | null; isActive: boolean; isFeatured: boolean; sortOrder: number; _count?: { products: number } }
export interface Material { id: string; name: string; unit: string; unitCost: string; stockQty: string; isActive: boolean; createdAt: string; updatedAt: string }
export interface Supplier {
  id: string; name: string; contactName: string | null; phone: string | null; email: string | null; address: string | null; notes: string | null; isActive: boolean;
  createdAt: string; purchaseOrderCount?: number; balance?: { purchased: string; paid: string; outstanding: string };
}
export interface Account { id: string; name: string; type: string; isActive: boolean; balance: string }

export interface VariantOption { id: string; sku: string; name: string; productName: string; imageUrl: string | null; available: number; unitCost?: string; price?: string }

export const PO_STATUS: Record<string, { label: string; tone: Tone }> = {
  DRAFT: { label: "Draft", tone: "gray" },
  ORDERED: { label: "Ordered", tone: "blue" },
  PARTIALLY_RECEIVED: { label: "Partially received", tone: "amber" },
  RECEIVED: { label: "Received", tone: "green" },
  CANCELLED: { label: "Cancelled", tone: "red" },
};

export const PRODUCT_STATUS: Record<string, { label: string; tone: Tone }> = {
  DRAFT: { label: "Draft", tone: "gray" },
  ACTIVE: { label: "Active", tone: "green" },
  ARCHIVED: { label: "Archived", tone: "rose" },
};

export const COST_COMPONENT_TYPES = ["MATERIAL", "FABRIC", "LACE", "EMBROIDERY", "LABOR", "FINISHING", "PACKAGING", "OTHER"] as const;

// ───────────── hooks ─────────────

/** Filters kept in the URL query string (shareable, survives refresh). */
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
  return { filters, setFilters };
}

export function useDebounced<T>(value: T, ms = 250) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export const useCategories = () => useQuery({ queryKey: ["categories"], queryFn: () => api<Category[]>("/categories"), staleTime: 60_000 });
export const useCollections = () => useQuery({ queryKey: ["collections"], queryFn: () => api<Collection[]>("/collections"), staleTime: 60_000 });

export function useMaterials(enabled = true) {
  return useQuery({
    queryKey: ["materials", "options"],
    queryFn: () => api<Material[]>("/materials", { query: { pageSize: 200 } }),
    staleTime: 60_000,
    enabled,
    retry: false,
  });
}

export function useAccounts(enabled = true) {
  return useQuery({ queryKey: ["finance", "accounts"], queryFn: () => api<Account[]>("/finance/accounts"), enabled, staleTime: 60_000, retry: false });
}

export function useSupplierOptions() {
  return useQuery({ queryKey: ["suppliers", "options"], queryFn: () => api<Supplier[]>("/suppliers", { query: { pageSize: 200, active: "true" } }), staleTime: 60_000 });
}

/** Variant search for pickers. Uses the inventory list (inventory.view) or the order-entry search (orders.view). */
export function useVariantSearch(q: string, enabled = true) {
  const { can } = useAuth();
  const viaInventory = can("inventory.view");
  return useQuery({
    queryKey: ["variant-search", viaInventory, q],
    enabled,
    queryFn: async (): Promise<VariantOption[]> => {
      if (viaInventory) {
        const r = await request<{ variantId: string; sku: string; name: string; productName: string; imageUrl: string | null; available: number; unitCost?: string; isActive: boolean }[]>("/inventory", { query: { search: q || undefined, pageSize: 20 } });
        return r.data.filter((v) => v.isActive).map((v) => ({ id: v.variantId, sku: v.sku, name: v.name, productName: v.productName, imageUrl: v.imageUrl, available: v.available, unitCost: v.unitCost }));
      }
      return api<VariantOption[]>("/products/variants/search", { query: { q, limit: 20 } });
    },
    staleTime: 15_000,
  });
}

// ───────────── small UI pieces ─────────────

export function SearchBox({ value, onChange, onSubmit, placeholder, label, className }: { value: string; onChange: (v: string) => void; onSubmit: (v: string) => void; placeholder: string; label: string; className?: string }) {
  return (
    <form
      className={cn("relative min-w-56 flex-1", className)}
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(value.trim());
      }}
    >
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="h-9 rounded-full pl-9 pr-9" aria-label={label} />
      {value && (
        <button
          type="button"
          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          onClick={() => {
            onChange("");
            onSubmit("");
          }}
          aria-label="Clear search"
        >
          <X className="size-4" />
        </button>
      )}
    </form>
  );
}

export function Chip({ active, onClick, children, count }: { active: boolean; onClick: () => void; children: ReactNode; count?: number }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors",
        active ? "border-blue-600 bg-blue-600 text-white" : "bg-white text-slate-700 hover:bg-muted",
      )}
    >
      {children}
      {count !== undefined && <span className={cn("rounded-full px-1.5 text-xs", active ? "bg-white/20" : "bg-muted text-muted-foreground")}>{count.toLocaleString("en-IN")}</span>}
    </button>
  );
}

export function Thumb({ src, alt, size = 40 }: { src: string | null | undefined; alt: string; size?: number }) {
  if (!src)
    return (
      <div className="flex shrink-0 items-center justify-center rounded-md border bg-muted text-muted-foreground" style={{ width: size, height: size }}>
        <ImageOff className="size-4" />
      </div>
    );
  return <img src={src} alt={alt} width={size} height={size} className="shrink-0 rounded-md border bg-muted object-cover" style={{ width: size, height: size }} loading="lazy" />;
}

/** Horizontal-scroll table wrapper with house styling. */
export function TableShell({ children, className, minWidth = 720 }: { children: ReactNode; className?: string; minWidth?: number }) {
  return (
    <div className={cn("overflow-x-auto rounded-xl border bg-white", className)}>
      <table className="w-full text-sm" style={{ minWidth }}>{children}</table>
    </div>
  );
}

export const th = "whitespace-nowrap border-b bg-muted/50 px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-600";
export const td = "border-b px-3 py-2.5 align-middle";

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "good" | "warn" | "bad" }) {
  return (
    <div className="rounded-xl border bg-white p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn("mt-1 text-xl font-semibold tabular-nums", tone === "good" && "text-green-700", tone === "warn" && "text-amber-700", tone === "bad" && "text-red-700")}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** Field error lookup that tolerates server paths ("variants.0.sku") and client paths. */
export function serverFieldErrors(fe: Record<string, string>) {
  return (path: string) => fe[path] ?? fe[`body.${path}`];
}

/** Shows a friendly no-access state instead of firing requests the API would reject with 403. */
export function RequirePermission({ permission, children }: { permission: string; children: ReactNode }) {
  const { can } = useAuth();
  if (can(permission)) return <>{children}</>;
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed bg-white px-6 py-12 text-center">
      <ShieldOff className="size-8 text-muted-foreground" />
      <p className="font-medium">You don&apos;t have access to this page</p>
      <p className="max-w-md text-sm text-muted-foreground">It needs the “{permission}” permission. Ask an admin if you need it.</p>
    </div>
  );
}
