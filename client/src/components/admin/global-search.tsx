"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Search } from "lucide-react";
import { api } from "@/lib/api";
import { bdt } from "@/lib/format";
import { cn } from "@/lib/utils";

type Hit = { id: string; title: string; subtitle?: string; href: string };
type Results = Record<string, Hit[]>;

interface RawResults {
  orders?: { id: string; orderNumber: string; shippingName?: string; shippingPhone?: string; status?: string; total?: string }[];
  customers?: { id: string; name: string; phone: string }[];
  products?: { id: string; name: string; sku: string }[];
  shipments?: { id: string; trackingCode?: string | null; order?: { id: string; orderNumber: string } }[];
}

/** Normalises whatever the /search endpoint returns into navigable hits. */
function toHits(raw: RawResults): Results {
  return {
    Orders: (raw.orders ?? []).map((o) => ({ id: o.id, title: o.orderNumber, subtitle: [o.shippingName, o.shippingPhone, o.total ? bdt(o.total) : null].filter(Boolean).join(" · "), href: `/admin/orders/${o.id}` })),
    Customers: (raw.customers ?? []).map((c) => ({ id: c.id, title: c.name, subtitle: c.phone, href: `/admin/customers/${c.id}` })),
    Products: (raw.products ?? []).map((p) => ({ id: p.id, title: p.name, subtitle: p.sku, href: `/admin/products/${p.id}` })),
    Shipments: (raw.shipments ?? []).map((s) => ({ id: s.id, title: s.trackingCode ?? s.id, subtitle: s.order?.orderNumber, href: s.order ? `/admin/orders/${s.order.id}` : "/admin/shipments" })),
  };
}

export function GlobalSearch() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const { data, isFetching } = useQuery({
    queryKey: ["search", debounced],
    queryFn: () => api<RawResults>("/search", { query: { q: debounced } }),
    enabled: debounced.length >= 2,
  });
  const groups = data ? toHits(data) : {};
  const flat = Object.values(groups).flat();

  const go = (hit: Hit) => {
    setOpen(false);
    setQ("");
    router.push(hit.href);
  };

  return (
    <div ref={box} className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <input
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, flat.length - 1)); }
          if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
          if (e.key === "Enter" && flat[active]) go(flat[active]);
          if (e.key === "Escape") setOpen(false);
        }}
        placeholder="Search orders, phone, customers, products, tracking…"
        aria-label="Global search"
        className="h-10 w-full rounded-full border bg-muted/40 pl-9 pr-9 text-sm outline-none focus:border-ring focus:bg-white focus:ring-2 focus:ring-ring/20"
      />
      {isFetching && <Loader2 className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />}
      {open && debounced.length >= 2 && data && (
        <div className="absolute inset-x-0 top-12 z-50 max-h-96 overflow-y-auto rounded-lg border bg-popover p-1 shadow-lg">
          {flat.length === 0 ? (
            <p className="p-3 text-sm text-muted-foreground">No results for “{debounced}”</p>
          ) : (
            Object.entries(groups)
              .filter(([, hits]) => hits.length)
              .map(([label, hits]) => (
                <div key={label}>
                  <p className="px-2 pb-1 pt-2 text-xs font-semibold uppercase text-muted-foreground">{label}</p>
                  {hits.map((h) => {
                    const idx = flat.indexOf(h);
                    return (
                      <button
                        key={`${label}-${h.id}`}
                        onMouseEnter={() => setActive(idx)}
                        onClick={() => go(h)}
                        className={cn("flex w-full flex-col items-start rounded-md px-2 py-1.5 text-left text-sm", idx === active && "bg-accent")}
                      >
                        <span className="font-medium">{h.title}</span>
                        {h.subtitle && <span className="text-xs text-muted-foreground">{h.subtitle}</span>}
                      </button>
                    );
                  })}
                </div>
              ))
          )}
        </div>
      )}
    </div>
  );
}
