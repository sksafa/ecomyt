"use client";

import Link from "next/link";
import { Suspense, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { MoreHorizontal, RefreshCw, Search, X } from "lucide-react";
import { api, request } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { bdt, dhakaDateTime, dhakaDaysAgo, num } from "@/lib/format";
import { SHIPMENT_TONE } from "@/lib/status";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { EmptyState, ErrorState, LoadingRows, NativeSelect, PageHeader, Pagination, Pill, Section } from "@/components/admin/ui";
import { useCourierProviders } from "@/components/admin/orders/order-dialogs";
import { SHIPPING_NAV, SubNav, TableShell, TD, TH, useUrlFilters } from "@/components/admin/ops/common";
import { CancelShipmentDialog, LabelDialog, ShipmentDrawer, canCancel, canRetry, canSync, useShipmentMutations } from "@/components/admin/ops/shipment-actions";
import { SHIPMENT_STATUSES, type PerformanceRow, type ShipmentRow } from "@/components/admin/ops/types";

const KEYS = ["q", "status", "providerId", "unsettled", "from", "to", "page", "pageSize", "open"] as const;

function Performance() {
  const { can } = useAuth();
  const [days, setDays] = useState("90");
  const q = useQuery({
    queryKey: ["couriers", "performance", days],
    queryFn: () => api<PerformanceRow[]>("/couriers/performance", { query: days === "all" ? {} : { from: dhakaDaysAgo(Number(days)) } }),
  });
  const finance = can("finance.view");
  return (
    <Section
      title="Courier performance"
      actions={
        <NativeSelect className="h-8 w-36" value={days} onChange={(e) => setDays(e.target.value)} aria-label="Period">
          <option value="30">Last 30 days</option>
          <option value="90">Last 90 days</option>
          <option value="365">Last 12 months</option>
          <option value="all">All time</option>
        </NativeSelect>
      }
    >
      {q.isLoading ? (
        <LoadingRows rows={2} />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data?.length ? (
        <p className="text-sm text-muted-foreground">No shipments in this period.</p>
      ) : (
        <TableShell minWidth={finance ? 900 : 600} className="border-0">
          <thead>
            <tr>
              <th className={TH}>Courier</th>
              <th className={cn(TH, "text-right")}>Shipments</th>
              <th className={cn(TH, "text-right")}>Delivered</th>
              <th className={cn(TH, "text-right")}>Returned</th>
              <th className={cn(TH, "text-right")}>In flight</th>
              <th className={cn(TH, "text-right")}>Failed bookings</th>
              <th className={cn(TH, "text-right")}>Success rate</th>
              {finance && (
                <>
                  <th className={cn(TH, "text-right")}>Delivery fees</th>
                  <th className={cn(TH, "text-right")}>COD charges</th>
                  <th className={cn(TH, "text-right")}>Return fees</th>
                  <th className={cn(TH, "text-right")}>Cost / delivered</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {q.data.map((r) => (
              <tr key={r.provider.id}>
                <td className={cn(TD, "font-medium")}>{r.provider.name}</td>
                <td className={cn(TD, "text-right tabular-nums")}>{num(r.shipments)}</td>
                <td className={cn(TD, "text-right tabular-nums")}>{num(r.delivered)}</td>
                <td className={cn(TD, "text-right tabular-nums")}>{num(r.returned)}</td>
                <td className={cn(TD, "text-right tabular-nums")}>{num(r.inFlight)}</td>
                <td className={cn(TD, "text-right tabular-nums")}>{num(r.failedBookings)}</td>
                <td className={cn(TD, "text-right")}>
                  {r.successRate === null ? "—" : (
                    <span className={cn("font-semibold tabular-nums", r.successRate >= 85 ? "text-emerald-700" : r.successRate >= 70 ? "text-amber-700" : "text-red-700")}>{r.successRate}%</span>
                  )}
                </td>
                {finance && (
                  <>
                    <td className={cn(TD, "text-right tabular-nums")}>{bdt(r.deliveryFees)}</td>
                    <td className={cn(TD, "text-right tabular-nums")}>{bdt(r.codCharges)}</td>
                    <td className={cn(TD, "text-right tabular-nums")}>{bdt(r.returnFees)}</td>
                    <td className={cn(TD, "text-right font-medium tabular-nums")}>{r.avgCostPerDelivered ? bdt(r.avgCostPerDelivered) : "—"}</td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </TableShell>
      )}
      <p className="mt-2 text-xs text-muted-foreground">Success rate = delivered ÷ (delivered + returned). Forward shipments only; cost per delivered order includes delivery, COD and return fees.</p>
    </Section>
  );
}

function ShipmentsScreen() {
  const { can } = useAuth();
  const providers = useCourierProviders();
  const [filters, setFilters] = useUrlFilters(KEYS);
  const [search, setSearch] = useState(filters.q ?? "");
  const [cancelOf, setCancelOf] = useState<ShipmentRow | null>(null);
  const [labelOf, setLabelOf] = useState<ShipmentRow | null>(null);
  const { retry, sync } = useShipmentMutations();

  const query = {
    q: filters.q, status: filters.status, providerId: filters.providerId, unsettled: filters.unsettled, from: filters.from, to: filters.to,
    page: filters.page ?? 1, pageSize: filters.pageSize ?? 25,
  };
  const list = useQuery({ queryKey: ["shipments", query], queryFn: () => request<ShipmentRow[]>("/couriers/shipments", { query }), placeholderData: keepPreviousData });
  const rows = list.data?.data ?? [];
  const active = ["status", "providerId", "unsettled", "from", "to", "q"].some((k) => filters[k as keyof typeof filters]);

  return (
    <div className="space-y-4">
      <PageHeader title="Shipping" description="Courier bookings, tracking and delivery performance." />
      <SubNav items={SHIPPING_NAV(can)} />

      <div className="flex flex-wrap items-end gap-2 rounded-xl border bg-white p-3">
        <form
          className="relative min-w-56 flex-1"
          onSubmit={(e) => {
            e.preventDefault();
            setFilters({ q: search.trim() });
          }}
        >
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Exact tracking code, consignment id or order number" className="h-9 rounded-full pl-9" aria-label="Search shipments" />
          {filters.q && (
            <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" onClick={() => { setSearch(""); setFilters({ q: undefined }); }} aria-label="Clear search">
              <X className="size-4" />
            </button>
          )}
        </form>
        <label className="flex flex-col text-xs text-muted-foreground">
          Status
          <NativeSelect className="w-40" value={filters.status ?? ""} onChange={(e) => setFilters({ status: e.target.value })}>
            <option value="">All statuses</option>
            <option value="PENDING,FAILED">Needs attention</option>
            <option value="BOOKED,PICKED_UP,IN_TRANSIT">In flight</option>
            {SHIPMENT_STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ").toLowerCase()}</option>)}
          </NativeSelect>
        </label>
        <label className="flex flex-col text-xs text-muted-foreground">
          Courier
          <NativeSelect className="w-44" value={filters.providerId ?? ""} onChange={(e) => setFilters({ providerId: e.target.value })}>
            <option value="">All couriers</option>
            {providers.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </NativeSelect>
        </label>
        <label className="flex flex-col text-xs text-muted-foreground">
          From
          <Input type="date" className="h-9 w-36" value={filters.from ?? ""} onChange={(e) => setFilters({ from: e.target.value })} />
        </label>
        <label className="flex flex-col text-xs text-muted-foreground">
          To
          <Input type="date" className="h-9 w-36" value={filters.to ?? ""} onChange={(e) => setFilters({ to: e.target.value })} />
        </label>
        <label className="flex h-9 items-center gap-2 rounded-md border px-3 text-sm">
          <input type="checkbox" className="size-4" checked={filters.unsettled === "true"} onChange={(e) => setFilters({ unsettled: e.target.checked ? "true" : undefined })} />
          Unsettled COD only
        </label>
        {active && <Button variant="ghost" size="sm" className="h-9" onClick={() => { setSearch(""); setFilters({ q: undefined, status: undefined, providerId: undefined, unsettled: undefined, from: undefined, to: undefined }); }}>Clear</Button>}
        <Button variant="outline" size="icon" className="size-9" onClick={() => list.refetch()} aria-label="Refresh">
          <RefreshCw className={cn("size-4", list.isFetching && "animate-spin")} />
        </Button>
      </div>

      {list.isLoading ? (
        <LoadingRows rows={6} />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState title="No shipments match" description={active ? "Try clearing the filters. Search matches exact tracking codes or order numbers." : "Shipments appear here when orders are booked with a courier."} />
      ) : (
        <TableShell minWidth={1000} className={cn(list.isFetching && "opacity-70")}>
          <thead>
            <tr>
              <th className={TH}>Order</th>
              <th className={TH}>Courier / tracking</th>
              <th className={TH}>Status</th>
              <th className={cn(TH, "text-right")}>COD</th>
              <th className={cn(TH, "text-right")}>Fees</th>
              <th className={TH}>Booked</th>
              <th className={TH}>Last update</th>
              <th className={cn(TH, "w-12")}><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => {
              const fees = [s.deliveryFee, s.codCharge, s.returnFee].reduce((n, v) => n + Number(v ?? 0), 0);
              return (
                <tr key={s.id} className="hover:bg-muted/30">
                  <td className={TD}>
                    <Link href={`/admin/orders/${s.order.id}`} className="font-medium text-blue-700 hover:underline">{s.order.orderNumber}</Link>
                    <div className="text-xs text-muted-foreground">{s.order.shippingName} · {s.order.shippingPhone}</div>
                  </td>
                  <td className={TD}>
                    <div>{s.provider.name}{s.isReturn && <span className="ml-1 text-xs text-orange-700">(return)</span>}</div>
                    <button className="font-mono text-xs text-blue-700 hover:underline" onClick={() => setFilters({ open: s.id }, false)}>
                      {s.trackingCode ?? s.consignmentId ?? "not booked yet"}
                    </button>
                  </td>
                  <td className={TD}>
                    <Pill tone={SHIPMENT_TONE[s.status] ?? "gray"}>{s.status.replace(/_/g, " ").toLowerCase()}</Pill>
                    {s.settlementItem && <div className="mt-1 text-xs text-emerald-700">settled</div>}
                    {s.lastError && <div className="mt-1 max-w-56 truncate text-xs text-red-700" title={s.lastError}>{s.lastError}</div>}
                    {s.status === "PENDING" && s.nextRetryAt && <div className="text-xs text-muted-foreground">retry {dhakaDateTime(s.nextRetryAt)}</div>}
                  </td>
                  <td className={cn(TD, "text-right tabular-nums")}>
                    {bdt(s.codAmount)}
                    {s.collectedAmount && s.collectedAmount !== s.codAmount && <div className="text-xs text-muted-foreground">got {bdt(s.collectedAmount)}</div>}
                  </td>
                  <td className={cn(TD, "text-right tabular-nums")}>{fees ? bdt(fees) : "—"}</td>
                  <td className={cn(TD, "whitespace-nowrap text-xs")}>{dhakaDateTime(s.bookedAt ?? s.createdAt)}</td>
                  <td className={cn(TD, "whitespace-nowrap text-xs text-muted-foreground")}>{dhakaDateTime(s.lastEventAt ?? s.updatedAt)}</td>
                  <td className={TD}>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="size-8" aria-label={`Actions for ${s.order.orderNumber}`}><MoreHorizontal className="size-4" /></Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => setFilters({ open: s.id }, false)}>Details & timeline</DropdownMenuItem>
                        {can("shipments.book") && canRetry(s) && <DropdownMenuItem onClick={() => retry.mutate(s.id)}>Retry booking</DropdownMenuItem>}
                        {canSync(s) && <DropdownMenuItem onClick={() => sync.mutate(s.id)}>Sync status from courier</DropdownMenuItem>}
                        <DropdownMenuItem onClick={() => setLabelOf(s)}>Label</DropdownMenuItem>
                        {can("shipments.cancel") && canCancel(s) && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem className="text-red-700" onClick={() => setCancelOf(s)}>Cancel shipment…</DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </TableShell>
      )}
      <Pagination meta={list.data?.meta} onPage={(p) => setFilters({ page: String(p) }, false)} />

      <Performance />

      <ShipmentDrawer id={filters.open ?? null} onClose={() => setFilters({ open: undefined }, false)} onCancel={setCancelOf} onLabel={setLabelOf} />
      <CancelShipmentDialog shipment={cancelOf} onClose={() => setCancelOf(null)} />
      <LabelDialog shipment={labelOf} onClose={() => setLabelOf(null)} />
    </div>
  );
}

export default function ShipmentsPage() {
  return (
    <Suspense>
      <ShipmentsScreen />
    </Suspense>
  );
}
