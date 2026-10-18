"use client";

import Link from "next/link";
import { Suspense, useCallback, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Bookmark, Download, Filter, MoreHorizontal, Plus, Printer, RefreshCw, Search, Truck, UserPlus, X } from "lucide-react";
import { api, download, errorMessage, request } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { ORDER_STATUS, ORDER_TABS, CHANNELS, type OrderStatus } from "@/lib/status";
import type { OrderListItem } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState, ErrorState, LoadingRows, NativeSelect, Pagination, ConfirmDialog } from "@/components/admin/ui";
import { OrderRow } from "@/components/admin/orders/order-row";
import { BookCourierDialog, StatusDialog, StatusHistoryDialog, useCourierProviders } from "@/components/admin/orders/order-dialogs";

const FILTER_KEYS = ["q", "tab", "channel", "paymentStatus", "booked", "providerId", "assignedToId", "from", "to", "flagged", "page", "pageSize", "sort"] as const;
type Filters = Partial<Record<(typeof FILTER_KEYS)[number], string>>;

function OrdersScreen() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const qc = useQueryClient();
  const { can } = useAuth();
  const providers = useCourierProviders();
  const staff = useQuery({ queryKey: ["users", "options"], queryFn: () => api<{ id: string; name: string }[]>("/users/options"), staleTime: 5 * 60_000 });

  const filters: Filters = useMemo(() => Object.fromEntries(FILTER_KEYS.map((k) => [k, params.get(k) ?? undefined]).filter(([, v]) => v)), [params]);
  const setFilters = useCallback(
    (patch: Filters, resetPage = true) => {
      const next = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries({ ...patch, ...(resetPage && !("page" in patch) ? { page: undefined } : {}) })) {
        if (v) next.set(k, v);
        else next.delete(k);
      }
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    },
    [params, pathname, router],
  );

  const tab = ORDER_TABS.find((t) => t.key === (filters.tab ?? "all")) ?? ORDER_TABS[0];
  const [search, setSearch] = useState(filters.q ?? "");
  const [showFilters, setShowFilters] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [historyOf, setHistoryOf] = useState<OrderListItem | null>(null);
  const [statusOf, setStatusOf] = useState<OrderListItem | null>(null);
  const [bookIds, setBookIds] = useState<string[] | null>(null);
  const [bulkStatus, setBulkStatus] = useState<OrderStatus | null>(null);

  const query = {
    q: filters.q, status: tab.statuses ?? undefined, channel: filters.channel, paymentStatus: filters.paymentStatus, booked: filters.booked,
    providerId: filters.providerId, assignedToId: filters.assignedToId, from: filters.from, to: filters.to, flagged: filters.flagged,
    page: filters.page ?? 1, pageSize: filters.pageSize ?? 25, sort: filters.sort ?? "-createdAt",
  };
  const list = useQuery({
    queryKey: ["orders", query],
    queryFn: () => request<OrderListItem[]>("/orders", { query }),
    placeholderData: keepPreviousData,
    // live updates come from useOrderStream; these are a safety net if the stream is unavailable
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
  const orders = list.data?.data ?? [];
  const counts = (list.data?.meta?.statusCounts ?? {}) as Record<string, number>;
  const tabCount = (statuses: OrderStatus[] | null) => (statuses ? statuses.reduce((n, s) => n + (counts[s] ?? 0), 0) : (counts.ALL ?? 0));

  const savedFilters = useQuery({ queryKey: ["saved-filters", "orders"], queryFn: () => api<{ id: string; name: string; filters: Filters }[]>("/saved-filters", { query: { module: "orders" } }), retry: false });
  const saveFilter = useMutation({
    mutationFn: (name: string) => api("/saved-filters", { method: "POST", body: { module: "orders", name, filters, isShared: false } }),
    onSuccess: () => {
      toast.success("Filter saved");
      qc.invalidateQueries({ queryKey: ["saved-filters", "orders"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const assign = useMutation({
    mutationFn: (assigneeId: string | null) => api("/orders/bulk/assign", { method: "POST", body: { ids: [...selected], assigneeId } }),
    onSuccess: () => {
      toast.success("Assignment updated");
      qc.invalidateQueries({ queryKey: ["orders"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const allSelected = orders.length > 0 && orders.every((o) => selected.has(o.id));
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(orders.map((o) => o.id)));
  const printIds = (ids: string[], type = "invoice") => window.open(`/admin/orders/print?type=${type}&ids=${ids.join(",")}`, "_blank");
  const activeFilterCount = ["channel", "paymentStatus", "booked", "providerId", "assignedToId", "from", "to", "flagged"].filter((k) => filters[k as keyof Filters]).length;

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-end gap-2 rounded-xl border bg-white p-3">
        <label className="flex flex-col text-xs text-muted-foreground">
          Count
          <NativeSelect className="w-20" value={filters.pageSize ?? "25"} onChange={(e) => setFilters({ pageSize: e.target.value })}>
            {[10, 25, 50, 100].map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </NativeSelect>
        </label>
        <label className="flex flex-col text-xs text-muted-foreground">
          Courier booked
          <NativeSelect className="w-32" value={filters.booked ?? ""} onChange={(e) => setFilters({ booked: e.target.value })}>
            <option value="">All</option>
            <option value="yes">Booked</option>
            <option value="no">Not booked</option>
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
        <form
          className="relative min-w-60 flex-1"
          onSubmit={(e) => {
            e.preventDefault();
            setFilters({ q: search.trim() });
          }}
        >
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search order / phone / name / tracking / SKU" className="h-9 rounded-full pl-9" aria-label="Search orders" />
          {filters.q && (
            <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" onClick={() => { setSearch(""); setFilters({ q: undefined }); }} aria-label="Clear search">
              <X className="size-4" />
            </button>
          )}
        </form>
        <Button variant="outline" size="sm" className="h-9" onClick={() => setShowFilters((v) => !v)}>
          <Filter className="size-4" /> Filters {activeFilterCount > 0 && <span className="rounded-full bg-primary px-1.5 text-xs text-white">{activeFilterCount}</span>}
        </Button>
        {can("orders.create") && (
          <Button size="sm" className="h-9" asChild>
            <Link href="/admin/orders/new">
              <Plus className="size-4" /> Create
            </Link>
          </Button>
        )}
        <Button variant="outline" size="icon" className="size-9" onClick={() => list.refetch()} aria-label="Refresh">
          <RefreshCw className={cn("size-4", list.isFetching && "animate-spin")} />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon" className="size-9" aria-label="More actions">
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            {can("orders.export") && (
              <>
                <DropdownMenuItem onClick={() => download("/orders/export", { ...query, page: undefined, pageSize: undefined, format: "csv" })}>
                  <Download className="size-4" /> Export filtered (CSV)
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => download("/orders/export", { ...query, page: undefined, pageSize: undefined, format: "xlsx" })}>
                  <Download className="size-4" /> Export filtered (Excel)
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuItem
              onClick={() => {
                const name = window.prompt("Name this filter");
                if (name) saveFilter.mutate(name);
              }}
            >
              <Bookmark className="size-4" /> Save current filters
            </DropdownMenuItem>
            {!!savedFilters.data?.length && <DropdownMenuLabel className="text-xs text-muted-foreground">Saved filters</DropdownMenuLabel>}
            {savedFilters.data?.map((f) => (
              <DropdownMenuItem key={f.id} onClick={() => router.replace(`${pathname}?${new URLSearchParams(f.filters as Record<string, string>).toString()}`)}>
                {f.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {showFilters && (
        <div className="grid gap-3 rounded-xl border bg-white p-3 sm:grid-cols-2 lg:grid-cols-6">
          <NativeSelect aria-label="Channel" value={filters.channel ?? ""} onChange={(e) => setFilters({ channel: e.target.value })}>
            <option value="">All channels</option>
            {CHANNELS.map((c) => <option key={c} value={c}>{c.toLowerCase()}</option>)}
          </NativeSelect>
          <NativeSelect aria-label="Payment status" value={filters.paymentStatus ?? ""} onChange={(e) => setFilters({ paymentStatus: e.target.value })}>
            <option value="">Any payment</option>
            {["UNPAID", "PARTIALLY_PAID", "PAID", "PARTIALLY_REFUNDED", "REFUNDED"].map((s) => <option key={s} value={s}>{s.replace("_", " ").toLowerCase()}</option>)}
          </NativeSelect>
          <NativeSelect aria-label="Courier" value={filters.providerId ?? ""} onChange={(e) => setFilters({ providerId: e.target.value })}>
            <option value="">Any courier</option>
            {providers.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </NativeSelect>
          <NativeSelect aria-label="Assigned to" value={filters.assignedToId ?? ""} onChange={(e) => setFilters({ assignedToId: e.target.value })}>
            <option value="">Anyone</option>
            <option value="none">Unassigned</option>
            {staff.data?.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </NativeSelect>
          <NativeSelect aria-label="Risk" value={filters.flagged ?? ""} onChange={(e) => setFilters({ flagged: e.target.value })}>
            <option value="">All orders</option>
            <option value="true">Only flagged (needs a call)</option>
          </NativeSelect>
          <NativeSelect aria-label="Sort" value={filters.sort ?? "-createdAt"} onChange={(e) => setFilters({ sort: e.target.value })}>
            <option value="-createdAt">Newest first</option>
            <option value="createdAt">Oldest first</option>
            <option value="-total">Highest value</option>
            <option value="-riskScore">Highest risk</option>
          </NativeSelect>
          {activeFilterCount > 0 && (
            <Button variant="ghost" size="sm" className="justify-self-start" onClick={() => setFilters({ channel: undefined, paymentStatus: undefined, booked: undefined, providerId: undefined, assignedToId: undefined, from: undefined, to: undefined, flagged: undefined })}>
              Clear filters
            </Button>
          )}
        </div>
      )}

      {/* Status tabs */}
      <div className="flex gap-2 overflow-x-auto pb-1" role="tablist">
        {ORDER_TABS.map((t) => {
          const active = t.key === tab.key;
          return (
            <button
              key={t.key}
              role="tab"
              aria-selected={active}
              onClick={() => { setSelected(new Set()); setFilters({ tab: t.key === "all" ? undefined : t.key }); }}
              className={cn("flex shrink-0 items-center gap-1.5 rounded-full border px-4 py-1.5 text-sm font-medium transition-colors", active ? "border-blue-600 bg-blue-600 text-white" : "bg-white text-slate-700 hover:bg-muted")}
            >
              {t.label}
              <span className={cn("rounded-full px-1.5 text-xs", active ? "bg-white/20" : "bg-muted text-muted-foreground")}>{tabCount(t.statuses)}</span>
            </button>
          );
        })}
      </div>

      {/* Bulk bar */}
      {selected.size > 0 && (
        <div className="sticky top-16 z-30 flex flex-wrap items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 p-2 text-sm">
          <span className="px-2 font-medium">{selected.size} selected</span>
          {can("orders.bulk") && (
            <NativeSelect className="h-8 w-48 bg-white" value="" onChange={(e) => e.target.value && setBulkStatus(e.target.value as OrderStatus)} aria-label="Bulk status">
              <option value="">Change status…</option>
              {(["CONFIRMED", "PROCESSING", "READY_TO_SHIP", "ON_HOLD", "CANCELLED"] as OrderStatus[]).map((s) => <option key={s} value={s}>{ORDER_STATUS[s].en}</option>)}
            </NativeSelect>
          )}
          {can("orders.assign") && (
            <NativeSelect className="h-8 w-44 bg-white" value="" onChange={(e) => e.target.value && assign.mutate(e.target.value === "none" ? null : e.target.value)} aria-label="Assign to">
              <option value="">Assign to…</option>
              <option value="none">Unassign</option>
              {staff.data?.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </NativeSelect>
          )}
          {can("shipments.book", "orders.bulk") && (
            <Button size="sm" variant="outline" className="h-8 bg-white" onClick={() => setBookIds([...selected])}>
              <Truck className="size-4" /> Book courier
            </Button>
          )}
          <Button size="sm" variant="outline" className="h-8 bg-white" onClick={() => printIds([...selected], "invoice")}>
            <Printer className="size-4" /> Invoices
          </Button>
          <Button size="sm" variant="outline" className="h-8 bg-white" onClick={() => printIds([...selected], "label")}>
            <Printer className="size-4" /> Labels
          </Button>
          <Button size="sm" variant="outline" className="h-8 bg-white" onClick={() => printIds([...selected], "packing")}>
            <Printer className="size-4" /> Packing slips
          </Button>
          {can("orders.export") && (
            <Button size="sm" variant="outline" className="h-8 bg-white" onClick={() => download("/orders/export", { ids: [...selected].join(","), format: "xlsx" })}>
              <Download className="size-4" /> Export
            </Button>
          )}
          <Button size="sm" variant="ghost" className="ml-auto h-8" onClick={() => setSelected(new Set())}>
            <UserPlus className="hidden" /> Clear
          </Button>
        </div>
      )}

      {/* Table */}
      <div className="overflow-hidden rounded-xl border bg-white">
        <div className="hidden grid-cols-[28px_110px_minmax(0,1.6fr)_minmax(0,1.2fr)_170px_120px_150px] gap-4 border-b bg-muted/50 px-4 py-3 text-sm font-medium text-slate-700 lg:grid">
          <input type="checkbox" className="size-4" checked={allSelected} onChange={toggleAll} aria-label="Select all on page" />
          <span className="text-center">Date</span>
          <span>Customer</span>
          <span>Products</span>
          <span>COD</span>
          <span className="text-center">Status</span>
          <span className="text-center">Action</span>
        </div>
        {list.isLoading ? (
          <LoadingRows rows={6} className="p-4" />
        ) : list.isError ? (
          <div className="p-4">
            <ErrorState error={list.error} onRetry={() => list.refetch()} />
          </div>
        ) : orders.length === 0 ? (
          <div className="p-4">
            <EmptyState
              title="No orders match"
              description={filters.q || activeFilterCount ? "Try clearing the search or filters." : "Orders from the website and staff will appear here."}
              action={can("orders.create") ? <Button asChild size="sm"><Link href="/admin/orders/new">Create an order</Link></Button> : undefined}
            />
          </div>
        ) : (
          <div className={cn(list.isFetching && "opacity-70")}>
            {orders.map((o) => (
              <OrderRow
                key={o.id}
                order={o}
                selected={selected.has(o.id)}
                onSelect={(v) => setSelected((s) => { const n = new Set(s); if (v) n.add(o.id); else n.delete(o.id); return n; })}
                actions={{
                  onHistory: setHistoryOf,
                  onStatus: setStatusOf,
                  onPrint: (x) => printIds([x.id]),
                  onBook: (x) => setBookIds([x.id]),
                  canEdit: can("orders.edit"),
                  canBook: can("shipments.book"),
                  canFinance: can("finance.view"),
                }}
              />
            ))}
          </div>
        )}
      </div>
      <Pagination meta={list.data?.meta} onPage={(p) => setFilters({ page: String(p) }, false)} />

      <StatusHistoryDialog order={historyOf} onClose={() => setHistoryOf(null)} />
      <StatusDialog order={statusOf} onClose={() => setStatusOf(null)} />
      <BookCourierDialog orderIds={bookIds} onClose={() => setBookIds(null)} />
      <ConfirmDialog
        open={!!bulkStatus}
        onOpenChange={(o) => !o && setBulkStatus(null)}
        title={`Move ${selected.size} order${selected.size === 1 ? "" : "s"} to ${bulkStatus ? ORDER_STATUS[bulkStatus].en : ""}?`}
        description="Orders that cannot make this transition are skipped and reported."
        destructive={bulkStatus === "CANCELLED"}
        requireReason={bulkStatus === "CANCELLED"}
        reasonLabel="Cancellation reason"
        confirmLabel="Apply"
        onConfirm={async (reason) => {
          const r = await api<{ succeeded: number; failed: number; results: { ok: boolean; error?: string }[] }>("/orders/bulk/status", { method: "POST", body: { ids: [...selected], status: bulkStatus, reason: reason || undefined } });
          toast[r.failed ? "warning" : "success"](`${r.succeeded} updated${r.failed ? `, ${r.failed} skipped (${r.results.find((x) => !x.ok)?.error})` : ""}`);
          setSelected(new Set());
          qc.invalidateQueries({ queryKey: ["orders"] });
        }}
      />
    </div>
  );
}

export default function OrdersPage() {
  return (
    <Suspense>
      <OrdersScreen />
    </Suspense>
  );
}
