"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2, Search } from "lucide-react";
import { cn } from "@/lib/utils";

const SORTS = [
  { value: "newest", label: "Newest" },
  { value: "featured", label: "Featured" },
  { value: "price_asc", label: "Price: low to high" },
  { value: "price_desc", label: "Price: high to low" },
  { value: "name", label: "Name A–Z" },
];

/** URL-synced filters for /shop (collection, category, search, sort). Resets page on every change. */
export function ShopFilters({ collections, categories, showCollections = true }: { collections: { name: string; slug: string }[]; categories: { name: string; slug: string }[]; showCollections?: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, start] = useTransition();
  const [q, setQ] = useState(sp.get("search") ?? "");

  const update = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    next.delete("page");
    const s = next.toString();
    start(() => router.push(s ? `${pathname}?${s}` : pathname, { scroll: false }));
  };

  const activeCollection = sp.get("collection");
  const activeCategory = sp.get("category");
  const chips = [
    ...(showCollections ? collections.map((c) => ({ key: "collection", ...c })) : []),
    ...categories.map((c) => ({ key: "category", ...c })),
  ];

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        {pathname === "/shop" && (
          <form
            role="search"
            className="relative min-w-0 flex-1"
            onSubmit={(e) => {
              e.preventDefault();
              update({ search: q.trim() || null });
            }}
          >
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search orna…"
              aria-label="Search products"
              className="h-11 w-full rounded-md border border-input bg-card pl-9 pr-3 text-base outline-none focus:border-primary sm:text-sm"
            />
          </form>
        )}
        <label className="sr-only" htmlFor="shop-sort">
          Sort by
        </label>
        <select
          id="shop-sort"
          value={sp.get("sort") ?? "newest"}
          onChange={(e) => update({ sort: e.target.value === "newest" ? null : e.target.value })}
          className={cn("h-11 rounded-md border border-input bg-card px-3 text-sm outline-none focus:border-primary", pathname !== "/shop" && "ml-auto")}
        >
          {SORTS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        {pending && <Loader2 className="my-auto size-4 shrink-0 animate-spin text-muted-foreground" aria-label="Loading" />}
      </div>
      {chips.length > 0 && (
        <div className="bb-scroll-x -mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0">
          {pathname === "/shop" && (
            <button
              type="button"
              onClick={() => update({ collection: null, category: null })}
              className={cn("h-9 shrink-0 rounded-full border px-4 text-sm", !activeCollection && !activeCategory ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:border-primary")}
            >
              All
            </button>
          )}
          {chips.map((c) => {
            const active = (c.key === "collection" ? activeCollection : activeCategory) === c.slug;
            return (
              <button
                key={`${c.key}:${c.slug}`}
                type="button"
                aria-pressed={active}
                onClick={() => update(c.key === "collection" ? { collection: active ? null : c.slug, category: null } : { category: active ? null : c.slug, collection: null })}
                className={cn("h-9 shrink-0 rounded-full border px-4 text-sm", active ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:border-primary")}
              >
                {c.name}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function Pager({ page, totalPages, basePath, params }: { page: number; totalPages: number; basePath: string; params: Record<string, string | undefined> }) {
  if (totalPages <= 1) return null;
  const href = (p: number) => {
    const s = new URLSearchParams(Object.entries({ ...params, page: p > 1 ? String(p) : undefined }).filter(([, v]) => v) as [string, string][]).toString();
    return s ? `${basePath}?${s}` : basePath;
  };
  return (
    <nav className="mt-10 flex items-center justify-center gap-2" aria-label="Pagination">
      {page > 1 ? (
        <Link href={href(page - 1)} className="inline-flex h-11 items-center rounded-md border border-border bg-card px-4 text-sm hover:border-primary">
          ← Previous
        </Link>
      ) : null}
      <span className="px-3 text-sm text-muted-foreground">
        Page {page} of {totalPages}
      </span>
      {page < totalPages ? (
        <Link href={href(page + 1)} className="inline-flex h-11 items-center rounded-md border border-border bg-card px-4 text-sm hover:border-primary">
          Next →
        </Link>
      ) : null}
    </nav>
  );
}
