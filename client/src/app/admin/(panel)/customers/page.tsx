"use client";

import Link from "next/link";
import { Suspense, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Copy, Download, GitMerge, MessageCircle, Phone, RefreshCw, Tag, Users, X } from "lucide-react";
import { api, download, request } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { bdt, dhakaDay, dhakaTime, telHref, whatsappHref } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { EmptyState, ErrorState, IconAction, LoadingRows, NativeSelect, PageHeader, Pagination } from "@/components/admin/ui";
import { Chip, SearchBox, TableShell, td, th, useUrlFilters, RequirePermission } from "@/components/admin/catalog/shared";
import { MergeCustomersDialog, type MergeCandidate } from "@/components/admin/catalog/customer-merge";

interface CustomerRow {
  id: string; name: string; phone: string; altPhone: string | null; email: string | null; tags: string[];
  totalOrders: number; deliveredOrders: number; cancelledOrders: number; returnedOrders: number; lifetimeValue: string; lastOrderAt: string | null;
  addresses: { addressLine: string; districtName: string | null }[];
}
interface Segment { key: string; label: string; count: number }
interface DuplicatePair { reason: string; customers: [MergeCandidate | undefined, MergeCandidate | undefined] }

const KEYS = ["search", "segment", "tag", "sort", "page", "view"] as const;

function CustomersScreen() {
  const { can } = useAuth();
  const { filters, setFilters } = useUrlFilters(KEYS);
  const [search, setSearch] = useState(filters.search ?? "");
  const [tag, setTag] = useState(filters.tag ?? "");
  const view = filters.view === "duplicates" ? "duplicates" : "list";

  const segments = useQuery({ queryKey: ["customers", "segments"], queryFn: () => api<Segment[]>("/customers/segments"), staleTime: 60_000 });
  const query = { search: filters.search, segment: filters.segment, tag: filters.tag, sort: filters.sort ?? "-lastOrderAt", page: filters.page ?? 1, pageSize: 25 };
  const list = useQuery({
    queryKey: ["customers", "list", query],
    queryFn: () => request<CustomerRow[]>("/customers", { query }),
    placeholderData: keepPreviousData,
    enabled: view === "list",
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Customers"
        description="Everyone who has ordered, with transparent order-history indicators."
        actions={
          <>
            <Button variant={view === "duplicates" ? "default" : "outline"} size="sm" onClick={() => setFilters({ view: view === "duplicates" ? undefined : "duplicates" })}>
              <GitMerge className="size-4" /> {view === "duplicates" ? "Back to all customers" : "Possible duplicates"}
            </Button>
            {can("customers.export") && view === "list" && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm"><Download className="size-4" /> Export</Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => download("/customers/export", { ...query, page: undefined, pageSize: undefined, format: "csv" })}>Export filtered (CSV)</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => download("/customers/export", { ...query, page: undefined, pageSize: undefined, format: "xlsx" })}>Export filtered (Excel)</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </>
        }
      />

      {view === "duplicates" ? (
        <DuplicatesView canMerge={can("customers.edit")} />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-white p-3">
            <SearchBox value={search} onChange={setSearch} onSubmit={(v) => setFilters({ search: v })} placeholder="Phone (any format), name, email or address" label="Search customers" />
            <form
              className="relative w-44"
              onSubmit={(e) => {
                e.preventDefault();
                setFilters({ tag: tag.trim() });
              }}
            >
              <Tag className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={tag} onChange={(e) => setTag(e.target.value)} placeholder="Tag" className="h-9 pl-9 pr-8" aria-label="Filter by tag" />
              {filters.tag && (
                <button type="button" className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" aria-label="Clear tag filter" onClick={() => { setTag(""); setFilters({ tag: undefined }); }}>
                  <X className="size-4" />
                </button>
              )}
            </form>
            <NativeSelect className="w-48" aria-label="Sort" value={filters.sort ?? "-lastOrderAt"} onChange={(e) => setFilters({ sort: e.target.value })}>
              <option value="-lastOrderAt">Most recent order</option>
              <option value="-lifetimeValue">Highest lifetime value</option>
              <option value="-totalOrders">Most orders</option>
              <option value="name">Name A–Z</option>
              <option value="-createdAt">Newest customers</option>
            </NativeSelect>
            <Button variant="outline" size="icon" className="size-9" onClick={() => { list.refetch(); segments.refetch(); }} aria-label="Refresh">
              <RefreshCw className={cn("size-4", list.isFetching && "animate-spin")} />
            </Button>
          </div>

          <div className="flex gap-2 overflow-x-auto pb-1" aria-label="Segments">
            <Chip active={!filters.segment} onClick={() => setFilters({ segment: undefined })}>All</Chip>
            {segments.data?.map((s) => (
              <Chip key={s.key} active={filters.segment === s.key} count={s.count} onClick={() => setFilters({ segment: filters.segment === s.key ? undefined : s.key })}>
                {s.label}
              </Chip>
            ))}
          </div>

          {list.isLoading ? (
            <LoadingRows rows={6} />
          ) : list.isError ? (
            <ErrorState error={list.error} onRetry={() => list.refetch()} />
          ) : !list.data?.data.length ? (
            <EmptyState icon={<Users className="size-8" />} title="No customers match" description={filters.search || filters.segment || filters.tag ? "Try a different search, segment or tag." : "Customers are created automatically when orders are placed."} />
          ) : (
            <TableShell className={cn(list.isFetching && "opacity-70")}>
              <thead>
                <tr>
                  <th className={th}>Customer</th>
                  <th className={th}>Phone</th>
                  <th className={cn(th, "text-right")}>Orders</th>
                  <th className={cn(th, "text-right")}>Delivered</th>
                  <th className={cn(th, "text-right")}>Returned</th>
                  <th className={cn(th, "text-right")}>Cancelled</th>
                  <th className={cn(th, "text-right")}>Lifetime value</th>
                  <th className={th}>Last order</th>
                </tr>
              </thead>
              <tbody>
                {list.data.data.map((c) => (
                  <tr key={c.id} className="hover:bg-muted/30">
                    <td className={td}>
                      <Link href={`/admin/customers/${c.id}`} className="font-medium text-blue-700 hover:underline">{c.name}</Link>
                      {c.addresses[0] && <p className="max-w-64 truncate text-xs text-muted-foreground">{[c.addresses[0].addressLine, c.addresses[0].districtName].filter(Boolean).join(", ")}</p>}
                      {c.tags.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {c.tags.slice(0, 4).map((t) => (
                            <button key={t} type="button" onClick={() => { setTag(t); setFilters({ tag: t }); }} className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-700 hover:bg-slate-200">{t}</button>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className={td}>
                      <div className="flex items-center gap-0.5">
                        <span className="mr-1 tabular-nums">{c.phone}</span>
                        <IconAction label="Copy phone" onClick={() => navigator.clipboard.writeText(c.phone).then(() => toast.success("Phone copied"))}><Copy className="size-4" /></IconAction>
                        <IconAction label="Call" href={telHref(c.phone)}><Phone className="size-4" /></IconAction>
                        <IconAction label="WhatsApp" href={whatsappHref(c.phone)}><MessageCircle className="size-4" /></IconAction>
                      </div>
                    </td>
                    <td className={cn(td, "text-right tabular-nums")}>{c.totalOrders}</td>
                    <td className={cn(td, "text-right tabular-nums text-green-700")}>{c.deliveredOrders}</td>
                    <td className={cn(td, "text-right tabular-nums", c.returnedOrders > 0 && "text-rose-700")}>{c.returnedOrders}</td>
                    <td className={cn(td, "text-right tabular-nums", c.cancelledOrders > 0 && "text-amber-700")}>{c.cancelledOrders}</td>
                    <td className={cn(td, "text-right font-medium tabular-nums")}>{bdt(c.lifetimeValue)}</td>
                    <td className={cn(td, "whitespace-nowrap")}>
                      {c.lastOrderAt ? <>{dhakaDay(c.lastOrderAt)}<span className="block text-xs text-muted-foreground">{dhakaTime(c.lastOrderAt)}</span></> : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </TableShell>
          )}
          <Pagination meta={list.data?.meta} onPage={(p) => setFilters({ page: String(p) }, false)} />
        </>
      )}
    </div>
  );
}

function DuplicatesView({ canMerge }: { canMerge: boolean }) {
  const q = useQuery({ queryKey: ["customers", "duplicates"], queryFn: () => api<DuplicatePair[]>("/customers/duplicates") });
  const [merging, setMerging] = useState<{ pair: [MergeCandidate, MergeCandidate]; reason: string } | null>(null);
  if (q.isLoading) return <LoadingRows rows={5} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const pairs = (q.data ?? []).filter((p): p is { reason: string; customers: [MergeCandidate, MergeCandidate] } => !!p.customers[0] && !!p.customers[1]);
  if (!pairs.length) return <EmptyState icon={<GitMerge className="size-8" />} title="No possible duplicates" description="Profiles sharing an email, an alternate phone, or the same name and address would appear here." />;
  return (
    <>
      <p className="text-sm text-muted-foreground">
        {pairs.length} possible duplicate pair{pairs.length === 1 ? "" : "s"}. These are suggestions based on matching details — check before merging.
      </p>
      <TableShell>
        <thead>
          <tr>
            <th className={th}>Reason</th>
            <th className={th}>Profile A</th>
            <th className={th}>Profile B</th>
            <th className={cn(th, "text-right")}>Action</th>
          </tr>
        </thead>
        <tbody>
          {pairs.map((p) => (
            <tr key={`${p.customers[0].id}-${p.customers[1].id}-${p.reason}`}>
              <td className={cn(td, "text-muted-foreground")}>{p.reason}</td>
              {p.customers.map((c) => (
                <td key={c.id} className={td}>
                  <Link href={`/admin/customers/${c.id}`} className="font-medium text-blue-700 hover:underline">{c.name}</Link>
                  <p className="text-xs tabular-nums text-muted-foreground">{c.phone}{c.email ? ` · ${c.email}` : ""} · {c.totalOrders} order{c.totalOrders === 1 ? "" : "s"}</p>
                </td>
              ))}
              <td className={cn(td, "text-right")}>
                {canMerge ? (
                  <Button size="sm" variant="outline" onClick={() => setMerging({ pair: p.customers, reason: p.reason })}>
                    <GitMerge className="size-4" /> Merge…
                  </Button>
                ) : (
                  <span className="text-xs text-muted-foreground">Needs edit access</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </TableShell>
      <MergeCustomersDialog pair={merging?.pair ?? null} reason={merging?.reason} onClose={() => setMerging(null)} onMerged={() => q.refetch()} />
    </>
  );
}

function CustomersPageInner() {
  return (
    <Suspense>
      <CustomersScreen />
    </Suspense>
  );
}

export default function CustomersPage() {
  return (
    <RequirePermission permission="customers.view">
      <CustomersPageInner  />
    </RequirePermission>
  );
}
