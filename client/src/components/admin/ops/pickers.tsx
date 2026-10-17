"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Plus, Search, X } from "lucide-react";
import { api } from "@/lib/api";
import { bdt } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/admin/ui";

interface ProductLite { id: string; name: string; sku: string; status: string; isPublished: boolean; regularPrice: string; salePrice: string | null; images: { url: string }[] }
export interface Collection { id: string; name: string; slug: string; isActive: boolean; _count?: { products: number } }

export const useCollections = () => useQuery({ queryKey: ["collections"], queryFn: () => api<Collection[]>("/collections"), staleTime: 5 * 60_000 });

function useProductsByIds(ids: string[]) {
  // resolve names for already-selected ids (small lists; products are fetched individually and cached)
  return useQuery({
    queryKey: ["products", "by-ids", [...ids].sort().join(",")],
    queryFn: async () => Object.fromEntries((await Promise.all(ids.map((id) => api<ProductLite>(`/products/${id}`).catch(() => null)))).filter(Boolean).map((p) => [p!.id, p!])),
    enabled: ids.length > 0,
    staleTime: 5 * 60_000,
  });
}

/** Search products and pick one (single) or many (multiple). Value is product ids. */
export function ProductPicker({ value, onChange, multiple = true, id }: { value: string[]; onChange: (ids: string[]) => void; multiple?: boolean; id?: string }) {
  const [q, setQ] = useState("");
  const [term, setTerm] = useState("");
  const known = useProductsByIds(value);
  const hits = useQuery({ queryKey: ["products", "picker", term], queryFn: () => api<ProductLite[]>("/products", { query: { search: term, pageSize: 8 } }), enabled: term.length >= 2 });
  const add = (pid: string) => onChange(multiple ? (value.includes(pid) ? value : [...value, pid]) : [pid]);
  return (
    <div className="space-y-2">
      {value.length > 0 && (
        <ul className="space-y-1">
          {value.map((pid, i) => {
            const p = known.data?.[pid];
            return (
              <li key={pid} className="flex items-center gap-2 rounded border bg-white px-2 py-1 text-sm">
                {p?.images[0] ? <img src={p.images[0].url} alt="" className="size-7 rounded object-cover" /> : <div className="size-7 rounded bg-muted" />}
                <span className="min-w-0 flex-1 truncate">{p ? p.name : known.isLoading ? "Loading…" : <span className="font-mono text-xs text-red-700">{pid} (not found)</span>}</span>
                {p && !p.isPublished && <span className="text-[11px] text-amber-700">unpublished</span>}
                {multiple && i > 0 && <Button type="button" variant="ghost" size="sm" className="h-6 px-1 text-xs" onClick={() => { const n = [...value]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; onChange(n); }} aria-label="Move up">↑</Button>}
                <Button type="button" variant="ghost" size="icon" className="size-6" aria-label="Remove product" onClick={() => onChange(value.filter((x) => x !== pid))}><X className="size-3.5" /></Button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input id={id} className="h-8 pl-8" placeholder={multiple || !value.length ? "Search products to add" : "Search to replace"} value={q} onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); setTerm(q.trim()); } }} />
        </div>
        <Button type="button" size="sm" variant="outline" className="h-8" disabled={q.trim().length < 2} onClick={() => setTerm(q.trim())}>Search</Button>
      </div>
      {hits.isFetching && <Loader2 className="size-4 animate-spin" />}
      {hits.data && term && (
        <ul className="max-h-48 divide-y overflow-y-auto rounded border bg-white">
          {hits.data.length === 0 && <li className="p-2 text-xs text-muted-foreground">No products match “{term}”.</li>}
          {hits.data.map((p) => (
            <li key={p.id} className="flex items-center gap-2 p-1.5 text-sm">
              {p.images[0] ? <img src={p.images[0].url} alt="" className="size-7 rounded object-cover" /> : <div className="size-7 rounded bg-muted" />}
              <span className="min-w-0 flex-1 truncate">{p.name}<span className="ml-1 text-xs text-muted-foreground">{p.sku} · {bdt(p.salePrice ?? p.regularPrice)}</span></span>
              <Button type="button" size="sm" variant="ghost" className="h-7" disabled={value.includes(p.id)} onClick={() => add(p.id)}><Plus className="size-3.5" /> {multiple ? "Add" : "Choose"}</Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function CollectionSelect({ value, onChange, id }: { value: string; onChange: (slug: string) => void; id?: string }) {
  const c = useCollections();
  return (
    <NativeSelect id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">— none —</option>
      {c.data?.map((x) => <option key={x.id} value={x.slug}>{x.name}{x.isActive ? "" : " (inactive)"}{x._count ? ` · ${x._count.products}` : ""}</option>)}
      {value && c.data && !c.data.some((x) => x.slug === value) && <option value={value}>{value} (missing)</option>}
    </NativeSelect>
  );
}
