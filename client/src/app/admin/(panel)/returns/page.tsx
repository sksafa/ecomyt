"use client";

import Link from "next/link";
import { Suspense, useState } from "react";
import { useRouter } from "next/navigation";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { RefreshCw, Search, X } from "lucide-react";
import { request } from "@/lib/api";
import { dhakaDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState, ErrorState, LoadingRows, NativeSelect, PageHeader, Pagination, Pill } from "@/components/admin/ui";
import { RETURN_STATUS, TableShell, TD, TH, useUrlFilters } from "@/components/admin/ops/common";

interface ReturnListItem {
  id: string; returnNumber: string; type: "RETURN" | "EXCHANGE"; status: string; isRto: boolean; reason: string; createdAt: string;
  order: { id: string; orderNumber: string; shippingName: string; shippingPhone: string };
  items: { id: string; quantity: number; orderItem: { productName: string; variantName: string | null; imageUrl: string | null } }[];
}

const KEYS = ["q", "status", "type", "rto", "from", "to", "page"] as const;
const TABS = [
  { key: "", label: "All" },
  { key: "REQUESTED", label: "Awaiting approval" },
  { key: "APPROVED,PICKUP_BOOKED,IN_TRANSIT", label: "Coming back" },
  { key: "RECEIVED", label: "To inspect" },
  { key: "INSPECTED", label: "To close" },
  { key: "COMPLETED", label: "Completed" },
  { key: "REJECTED,CANCELLED", label: "Rejected / cancelled" },
];

function ReturnsScreen() {
  const router = useRouter();
  const [filters, setFilters] = useUrlFilters(KEYS);
  const [search, setSearch] = useState(filters.q ?? "");
  const query = { q: filters.q, status: filters.status, type: filters.type, rto: filters.rto, from: filters.from, to: filters.to, page: filters.page ?? 1, pageSize: 25 };
  const list = useQuery({ queryKey: ["returns", query], queryFn: () => request<ReturnListItem[]>("/returns", { query }), placeholderData: keepPreviousData });
  const rows = list.data?.data ?? [];
  const anyFilter = KEYS.some((k) => k !== "page" && filters[k]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Returns & exchanges"
        description="Customer returns, exchanges and undelivered parcels coming back (RTO). Open a new return from a delivered order's page."
      />
      <div className="flex gap-2 overflow-x-auto pb-1" role="tablist">
        {TABS.map((t) => {
          const active = (filters.status ?? "") === t.key;
          return (
            <button key={t.label} role="tab" aria-selected={active} onClick={() => setFilters({ status: t.key || undefined })}
              className={cn("shrink-0 rounded-full border px-4 py-1.5 text-sm font-medium", active ? "border-blue-600 bg-blue-600 text-white" : "bg-white text-slate-700 hover:bg-muted")}>
              {t.label}
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap items-end gap-2 rounded-xl border bg-white p-3">
        <form className="relative min-w-56 flex-1" onSubmit={(e) => { e.preventDefault(); setFilters({ q: search.trim() }); }}>
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Return no., order no. or phone" className="h-9 rounded-full pl-9" aria-label="Search returns" />
          {filters.q && <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" onClick={() => { setSearch(""); setFilters({ q: undefined }); }} aria-label="Clear search"><X className="size-4" /></button>}
        </form>
        <label className="flex flex-col text-xs text-muted-foreground">Type
          <NativeSelect className="w-36" value={filters.type ?? ""} onChange={(e) => setFilters({ type: e.target.value })}>
            <option value="">Returns & exchanges</option>
            <option value="RETURN">Returns</option>
            <option value="EXCHANGE">Exchanges</option>
          </NativeSelect>
        </label>
        <label className="flex flex-col text-xs text-muted-foreground">Origin
          <NativeSelect className="w-40" value={filters.rto ?? ""} onChange={(e) => setFilters({ rto: e.target.value })}>
            <option value="">All</option>
            <option value="false">Customer returns</option>
            <option value="true">RTO (undelivered)</option>
          </NativeSelect>
        </label>
        <label className="flex flex-col text-xs text-muted-foreground">From<Input type="date" className="h-9 w-36" value={filters.from ?? ""} onChange={(e) => setFilters({ from: e.target.value })} /></label>
        <label className="flex flex-col text-xs text-muted-foreground">To<Input type="date" className="h-9 w-36" value={filters.to ?? ""} onChange={(e) => setFilters({ to: e.target.value })} /></label>
        {anyFilter && <Button variant="ghost" size="sm" className="h-9" onClick={() => { setSearch(""); setFilters({ q: undefined, status: undefined, type: undefined, rto: undefined, from: undefined, to: undefined }); }}>Clear</Button>}
        <Button variant="outline" size="icon" className="size-9" onClick={() => list.refetch()} aria-label="Refresh"><RefreshCw className={cn("size-4", list.isFetching && "animate-spin")} /></Button>
      </div>

      {list.isLoading ? <LoadingRows rows={6} /> : list.isError ? <ErrorState error={list.error} onRetry={() => list.refetch()} /> : rows.length === 0 ? (
        <EmptyState title="No returns match" description={anyFilter ? "Try clearing the filters." : "Returns are opened from a delivered order (Order → Return / exchange). RTO parcels appear here automatically."} />
      ) : (
        <TableShell minWidth={900} className={cn(list.isFetching && "opacity-70")}>
          <thead>
            <tr>
              <th className={TH}>Return</th>
              <th className={TH}>Order / customer</th>
              <th className={TH}>Items</th>
              <th className={TH}>Reason</th>
              <th className={TH}>Status</th>
              <th className={TH}>Opened</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="cursor-pointer hover:bg-muted/30" onClick={() => router.push(`/admin/returns/${r.id}`)}>
                <td className={TD}>
                  <Link href={`/admin/returns/${r.id}`} className="font-medium text-blue-700 hover:underline" onClick={(e) => e.stopPropagation()}>{r.returnNumber}</Link>
                  <div className="mt-0.5 flex gap-1">
                    <Pill tone={r.type === "EXCHANGE" ? "cyan" : "orange"}>{r.type === "EXCHANGE" ? "Exchange" : "Return"}</Pill>
                    {r.isRto && <Pill tone="rose">RTO</Pill>}
                  </div>
                </td>
                <td className={TD}>
                  <Link href={`/admin/orders/${r.order.id}`} className="text-blue-700 hover:underline" onClick={(e) => e.stopPropagation()}>{r.order.orderNumber}</Link>
                  <div className="text-xs text-muted-foreground">{r.order.shippingName} · {r.order.shippingPhone}</div>
                </td>
                <td className={TD}>
                  <div className="flex items-center gap-2">
                    {r.items[0]?.orderItem.imageUrl ? <img src={r.items[0].orderItem.imageUrl} alt="" className="size-9 rounded object-cover" /> : <div className="size-9 rounded bg-muted" />}
                    <div className="min-w-0 text-xs">
                      {r.items.slice(0, 2).map((i) => <div key={i.id} className="max-w-56 truncate">{i.quantity} × {i.orderItem.productName}{i.orderItem.variantName ? ` (${i.orderItem.variantName})` : ""}</div>)}
                      {r.items.length > 2 && <div className="text-muted-foreground">+{r.items.length - 2} more</div>}
                    </div>
                  </div>
                </td>
                <td className={cn(TD, "max-w-60")}><span className="line-clamp-2 text-xs">{r.reason}</span></td>
                <td className={TD}><Pill tone={RETURN_STATUS[r.status]?.tone ?? "gray"}>{RETURN_STATUS[r.status]?.label ?? r.status}</Pill></td>
                <td className={cn(TD, "whitespace-nowrap text-xs")}>{dhakaDateTime(r.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </TableShell>
      )}
      <Pagination meta={list.data?.meta} onPage={(p) => setFilters({ page: String(p) }, false)} />
    </div>
  );
}

export default function ReturnsPage() {
  return <Suspense><ReturnsScreen /></Suspense>;
}
