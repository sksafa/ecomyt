"use client";

import Link from "next/link";
import { Suspense, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Boxes, History, RefreshCw, SlidersHorizontal, X } from "lucide-react";
import { api, request } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { bdt, dhakaDateTime, num } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState, ErrorState, IconAction, LoadingRows, NativeSelect, PageHeader, Pagination, Pill } from "@/components/admin/ui";
import { Chip, SearchBox, Stat, TableShell, Thumb, td, th, useUrlFilters, RequirePermission } from "@/components/admin/catalog/shared";
import { AdjustStockDialog, VariantFilterPicker, type StockRow } from "@/components/admin/catalog/inventory-parts";

interface Movement {
  id: string; variantId: string; type: string; quantity: number; availableDelta: number; reservedDelta: number; damagedDelta: number; returnedDelta: number;
  availableAfter: number; reason: string | null; orderId: string | null; purchaseOrderId: string | null; returnId: string | null; createdAt: string;
  variant: { sku: string; name: string; product: { name: string } }; user: { id: string; name: string } | null;
}

const MOVEMENT_TYPES: Record<string, { label: string; tone: "green" | "blue" | "amber" | "gray" | "red" | "orange" | "teal" | "violet" | "rose" }> = {
  RECEIVE: { label: "Received", tone: "green" },
  ADJUST: { label: "Adjustment", tone: "blue" },
  RESERVE: { label: "Reserved", tone: "amber" },
  RELEASE: { label: "Released", tone: "gray" },
  FULFILL: { label: "Shipped out", tone: "violet" },
  RETURN_RECEIVED: { label: "Return received", tone: "orange" },
  RESTOCK: { label: "Restocked", tone: "teal" },
  DAMAGE: { label: "Marked damaged", tone: "red" },
  DISPOSE: { label: "Disposed", tone: "rose" },
};

const KEYS = ["view", "search", "lowStock", "page", "variantId", "variantLabel", "type", "from", "to"] as const;

function InventoryScreen() {
  const { can } = useAuth();
  const { filters, setFilters } = useUrlFilters(KEYS);
  const view = filters.view === "movements" ? "movements" : "stock";
  const finance = can("finance.view");
  const valuation = useQuery({
    queryKey: ["inventory", "valuation"],
    queryFn: () => api<{ units: number; value: string; damagedUnits: number; method: string }>("/inventory/valuation"),
    enabled: finance,
  });

  return (
    <div className="space-y-4">
      <PageHeader title="Inventory" description="Stock per variant. Available = sellable now; reserved = held by open orders." />
      {finance && (
        <div className="grid gap-3 sm:grid-cols-3">
          {valuation.isError ? (
            <div className="sm:col-span-3"><ErrorState error={valuation.error} onRetry={() => valuation.refetch()} /></div>
          ) : (
            <>
              <Stat label="Stock value at cost" value={valuation.data ? bdt(valuation.data.value) : "…"} hint={valuation.data?.method} />
              <Stat label="Units on hand" value={valuation.data ? num(valuation.data.units) : "…"} hint="Available + reserved" />
              <Stat label="Damaged units" value={valuation.data ? num(valuation.data.damagedUnits) : "…"} hint="Not counted in value" tone={valuation.data?.damagedUnits ? "warn" : undefined} />
            </>
          )}
        </div>
      )}
      <div className="flex gap-2">
        <Chip active={view === "stock"} onClick={() => setFilters({ view: undefined })}>Stock levels</Chip>
        <Chip active={view === "movements"} onClick={() => setFilters({ view: "movements" })}>Movement history</Chip>
      </div>
      {view === "stock" ? <StockView filters={filters} setFilters={setFilters} /> : <MovementsView filters={filters} setFilters={setFilters} />}
    </div>
  );
}

type F = Partial<Record<(typeof KEYS)[number], string>>;
type SetF = (patch: F, resetPage?: boolean) => void;

function StockView({ filters, setFilters }: { filters: F; setFilters: SetF }) {
  const { can } = useAuth();
  const [search, setSearch] = useState(filters.search ?? "");
  const [adjusting, setAdjusting] = useState<StockRow | null>(null);
  const finance = can("finance.view");
  const query = { search: filters.search, lowStock: filters.lowStock, page: filters.page ?? 1, pageSize: 50 };
  const list = useQuery({ queryKey: ["inventory", "levels", query], queryFn: () => request<StockRow[]>("/inventory", { query }), placeholderData: keepPreviousData });

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-white p-3">
        <SearchBox value={search} onChange={setSearch} onSubmit={(v) => setFilters({ search: v })} placeholder="Search product name or SKU" label="Search stock" />
        <label className="flex h-9 items-center gap-2 rounded-md border px-3 text-sm">
          <input type="checkbox" className="size-4" checked={filters.lowStock === "true"} onChange={(e) => setFilters({ lowStock: e.target.checked ? "true" : undefined })} /> Low stock only
        </label>
        <Button variant="outline" size="icon" className="size-9" onClick={() => list.refetch()} aria-label="Refresh"><RefreshCw className={cn("size-4", list.isFetching && "animate-spin")} /></Button>
      </div>
      {list.isLoading ? (
        <LoadingRows rows={6} />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : !list.data?.data.length ? (
        <EmptyState icon={<Boxes className="size-8" />} title={filters.lowStock ? "Nothing is low on stock" : "No variants found"} description={filters.search ? "Try another search." : undefined} />
      ) : (
        <TableShell className={cn(list.isFetching && "opacity-70")}>
          <thead>
            <tr>
              <th className={th}>Variant</th>
              <th className={cn(th, "text-right")}>Available</th>
              <th className={cn(th, "text-right")}>Reserved</th>
              <th className={cn(th, "text-right")}>Damaged</th>
              <th className={cn(th, "text-right")} title="Returned, awaiting inspection">Returned (inspect)</th>
              <th className={cn(th, "text-right")}>Alert at</th>
              {finance && <th className={cn(th, "text-right")}>Stock value</th>}
              <th className={cn(th, "text-right")}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {list.data.data.map((r) => (
              <tr key={r.variantId} className={cn("hover:bg-muted/30", !r.isActive && "opacity-60")}>
                <td className={td}>
                  <div className="flex items-center gap-3">
                    <Thumb src={r.imageUrl} alt={r.productName} size={36} />
                    <div className="min-w-0">
                      <Link href={`/admin/products/${r.productId}`} className="font-medium text-blue-700 hover:underline">{r.productName}</Link>
                      <p className="text-xs text-muted-foreground">{r.name} · <span className="font-mono">{r.sku}</span>{!r.isActive && " · inactive"}</p>
                    </div>
                  </div>
                </td>
                <td className={cn(td, "text-right tabular-nums")}>
                  <span className={cn("font-semibold", r.lowStock && "text-amber-700")}>{r.available}</span>
                  {r.lowStock && <Pill tone="amber" className="ml-2">Low</Pill>}
                </td>
                <td className={cn(td, "text-right tabular-nums")}>{r.reserved}</td>
                <td className={cn(td, "text-right tabular-nums", r.damaged > 0 && "text-red-700")}>{r.damaged}</td>
                <td className={cn(td, "text-right tabular-nums", r.returned > 0 && "text-orange-700")}>{r.returned}</td>
                <td className={cn(td, "text-right tabular-nums text-muted-foreground")}>{r.lowStockThreshold}</td>
                {finance && (
                  <td className={cn(td, "text-right tabular-nums")}>
                    {bdt(r.stockValue)}
                    <span className="block text-xs text-muted-foreground">@ {bdt(r.unitCost)}</span>
                  </td>
                )}
                <td className={cn(td, "whitespace-nowrap text-right")}>
                  <IconAction label="Movement history" onClick={() => setFilters({ view: "movements", variantId: r.variantId, variantLabel: `${r.productName} – ${r.name}`, search: undefined, lowStock: undefined })}><History className="size-4" /></IconAction>
                  {can("inventory.adjust") && <IconAction label="Adjust stock" onClick={() => setAdjusting(r)}><SlidersHorizontal className="size-4" /></IconAction>}
                </td>
              </tr>
            ))}
          </tbody>
        </TableShell>
      )}
      <Pagination meta={list.data?.meta} onPage={(p) => setFilters({ page: String(p) }, false)} />
      <AdjustStockDialog key={adjusting?.variantId ?? "none"} row={adjusting} onClose={() => setAdjusting(null)} />
    </>
  );
}

function MovementsView({ filters, setFilters }: { filters: F; setFilters: SetF }) {
  const query = { variantId: filters.variantId, type: filters.type, from: filters.from, to: filters.to, page: filters.page ?? 1, pageSize: 50 };
  const list = useQuery({ queryKey: ["inventory", "movements", query], queryFn: () => request<Movement[]>("/inventory/movements", { query }), placeholderData: keepPreviousData });
  const delta = (n: number) => (n === 0 ? <span className="text-muted-foreground">·</span> : <span className={n > 0 ? "text-green-700" : "text-red-700"}>{n > 0 ? `+${n}` : n}</span>);
  return (
    <>
      <div className="flex flex-wrap items-end gap-2 rounded-xl border bg-white p-3">
        <div className="min-w-60 flex-1">
          <span className="mb-1 block text-xs text-muted-foreground">Variant</span>
          {filters.variantId ? (
            <div className="flex h-9 items-center gap-2 rounded-md border bg-muted/40 px-3 text-sm">
              <span className="flex-1 truncate">{filters.variantLabel ?? filters.variantId}</span>
              <button type="button" aria-label="Clear variant filter" onClick={() => setFilters({ variantId: undefined, variantLabel: undefined })}><X className="size-4" /></button>
            </div>
          ) : (
            <VariantFilterPicker onPick={(v) => setFilters({ variantId: v.id, variantLabel: `${v.productName} – ${v.name}` })} />
          )}
        </div>
        <label className="flex flex-col text-xs text-muted-foreground">
          Type
          <NativeSelect className="w-44" value={filters.type ?? ""} onChange={(e) => setFilters({ type: e.target.value })}>
            <option value="">All types</option>
            {Object.entries(MOVEMENT_TYPES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </NativeSelect>
        </label>
        <label className="flex flex-col text-xs text-muted-foreground">
          From
          <Input type="date" className="h-9 w-40" value={filters.from ?? ""} onChange={(e) => setFilters({ from: e.target.value })} />
        </label>
        <label className="flex flex-col text-xs text-muted-foreground">
          To
          <Input type="date" className="h-9 w-40" value={filters.to ?? ""} onChange={(e) => setFilters({ to: e.target.value })} />
        </label>
        <Button variant="outline" size="icon" className="size-9" onClick={() => list.refetch()} aria-label="Refresh"><RefreshCw className={cn("size-4", list.isFetching && "animate-spin")} /></Button>
      </div>
      {list.isLoading ? (
        <LoadingRows rows={6} />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : !list.data?.data.length ? (
        <EmptyState icon={<History className="size-8" />} title="No stock movements" description="Try widening the date range or clearing filters." />
      ) : (
        <TableShell className={cn(list.isFetching && "opacity-70")}>
          <thead>
            <tr>
              <th className={th}>When (Dhaka)</th>
              <th className={th}>Variant</th>
              <th className={th}>Type</th>
              <th className={cn(th, "text-right")}>Avail.</th>
              <th className={cn(th, "text-right")}>Res.</th>
              <th className={cn(th, "text-right")}>Dmg.</th>
              <th className={cn(th, "text-right")}>Ret.</th>
              <th className={cn(th, "text-right")}>Avail. after</th>
              <th className={th}>Who / why</th>
            </tr>
          </thead>
          <tbody>
            {list.data.data.map((m) => (
              <tr key={m.id}>
                <td className={cn(td, "whitespace-nowrap")}>{dhakaDateTime(m.createdAt)}</td>
                <td className={td}>
                  <p className="font-medium">{m.variant.product.name}</p>
                  <p className="text-xs text-muted-foreground">{m.variant.name} · <span className="font-mono">{m.variant.sku}</span></p>
                </td>
                <td className={td}><Pill tone={MOVEMENT_TYPES[m.type]?.tone ?? "gray"}>{MOVEMENT_TYPES[m.type]?.label ?? m.type}</Pill></td>
                <td className={cn(td, "text-right tabular-nums")}>{delta(m.availableDelta)}</td>
                <td className={cn(td, "text-right tabular-nums")}>{delta(m.reservedDelta)}</td>
                <td className={cn(td, "text-right tabular-nums")}>{delta(m.damagedDelta)}</td>
                <td className={cn(td, "text-right tabular-nums")}>{delta(m.returnedDelta)}</td>
                <td className={cn(td, "text-right font-medium tabular-nums")}>{m.availableAfter}</td>
                <td className={cn(td, "max-w-72")}>
                  <p className="text-xs font-medium">{m.user?.name ?? "System"}</p>
                  {m.reason && <p className="text-xs text-muted-foreground">{m.reason}</p>}
                  <div className="flex gap-2 text-xs">
                    {m.orderId && <Link className="text-blue-700 hover:underline" href={`/admin/orders/${m.orderId}`}>Order</Link>}
                    {m.purchaseOrderId && <Link className="text-blue-700 hover:underline" href={`/admin/purchasing/${m.purchaseOrderId}`}>Purchase order</Link>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </TableShell>
      )}
      <Pagination meta={list.data?.meta} onPage={(p) => setFilters({ page: String(p) }, false)} />
    </>
  );
}

function InventoryPageInner() {
  return (
    <Suspense>
      <InventoryScreen />
    </Suspense>
  );
}

export default function InventoryPage() {
  return (
    <RequirePermission permission="inventory.view">
      <InventoryPageInner  />
    </RequirePermission>
  );
}
