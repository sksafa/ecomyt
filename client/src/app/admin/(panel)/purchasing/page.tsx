"use client";

import Link from "next/link";
import { Suspense, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ClipboardList, Plus, RefreshCw } from "lucide-react";
import { request } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { bdt, dhakaDay } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, LoadingRows, NativeSelect, PageHeader, Pagination, Pill } from "@/components/admin/ui";
import { Chip, PO_STATUS, SearchBox, TableShell, td, th, useSupplierOptions, useUrlFilters, RequirePermission } from "@/components/admin/catalog/shared";
import type { PurchaseOrder } from "@/components/admin/catalog/po-form";

const KEYS = ["status", "supplierId", "search", "page"] as const;

function PurchaseOrdersScreen() {
  const { can } = useAuth();
  const { filters, setFilters } = useUrlFilters(KEYS);
  const [search, setSearch] = useState(filters.search ?? "");
  const suppliers = useSupplierOptions();
  const query = { status: filters.status, supplierId: filters.supplierId, search: filters.search, page: filters.page ?? 1, pageSize: 25 };
  const list = useQuery({ queryKey: ["purchase-orders", query], queryFn: () => request<PurchaseOrder[]>("/purchase-orders", { query }), placeholderData: keepPreviousData });
  const finance = can("finance.view");

  return (
    <div className="space-y-4">
      <PageHeader
        title="Purchase orders"
        description="Buy finished goods and materials from suppliers, then receive them into stock."
        actions={
          <>
            <Button variant="outline" size="sm" asChild><Link href="/admin/purchasing/suppliers">Suppliers</Link></Button>
            <Button variant="outline" size="sm" asChild><Link href="/admin/purchasing/materials">Materials</Link></Button>
            {can("purchasing.manage") && <Button size="sm" asChild><Link href="/admin/purchasing/new"><Plus className="size-4" /> New purchase order</Link></Button>}
          </>
        }
      />
      <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-white p-3">
        <SearchBox value={search} onChange={setSearch} onSubmit={(v) => setFilters({ search: v })} placeholder="PO number" label="Search purchase orders" />
        <NativeSelect className="w-56" aria-label="Supplier" value={filters.supplierId ?? ""} onChange={(e) => setFilters({ supplierId: e.target.value })}>
          <option value="">All suppliers</option>
          {suppliers.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </NativeSelect>
        <Button variant="outline" size="icon" className="size-9" onClick={() => list.refetch()} aria-label="Refresh"><RefreshCw className={cn("size-4", list.isFetching && "animate-spin")} /></Button>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        <Chip active={!filters.status} onClick={() => setFilters({ status: undefined })}>All</Chip>
        {Object.entries(PO_STATUS).map(([k, v]) => <Chip key={k} active={filters.status === k} onClick={() => setFilters({ status: k })}>{v.label}</Chip>)}
      </div>
      {list.isLoading ? (
        <LoadingRows rows={5} />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : !list.data?.data.length ? (
        <EmptyState
          icon={<ClipboardList className="size-8" />}
          title="No purchase orders"
          description={filters.status || filters.search || filters.supplierId ? "Try clearing the filters." : "Create a purchase order when you buy stock or materials."}
          action={can("purchasing.manage") ? <Button size="sm" asChild><Link href="/admin/purchasing/new">New purchase order</Link></Button> : undefined}
        />
      ) : (
        <TableShell className={cn(list.isFetching && "opacity-70")}>
          <thead>
            <tr>
              <th className={th}>PO</th><th className={th}>Supplier</th><th className={th}>Status</th><th className={th}>Created</th><th className={th}>Expected</th>
              <th className={cn(th, "text-right")}>Items</th><th className={cn(th, "text-right")}>Total</th>{finance && <th className={cn(th, "text-right")}>Open balance</th>}
            </tr>
          </thead>
          <tbody>
            {list.data.data.map((po) => (
              <tr key={po.id} className="hover:bg-muted/30">
                <td className={td}><Link href={`/admin/purchasing/${po.id}`} className="font-medium text-blue-700 hover:underline">{po.number}</Link></td>
                <td className={td}>{po.supplier.name}</td>
                <td className={td}><Pill tone={PO_STATUS[po.status]?.tone ?? "gray"}>{PO_STATUS[po.status]?.label ?? po.status}</Pill></td>
                <td className={cn(td, "whitespace-nowrap")}>{dhakaDay(po.createdAt)}</td>
                <td className={cn(td, "whitespace-nowrap")}>{dhakaDay(po.expectedAt)}</td>
                <td className={cn(td, "text-right tabular-nums")}>{po.items.length}</td>
                <td className={cn(td, "text-right font-medium tabular-nums")}>{bdt(po.total)}</td>
                {finance && <td className={cn(td, "text-right tabular-nums", Number(po.openBalance) > 0 && ["ORDERED", "PARTIALLY_RECEIVED", "RECEIVED"].includes(po.status) && "text-amber-700")}>{["DRAFT", "CANCELLED"].includes(po.status) ? "—" : bdt(po.openBalance)}</td>}
              </tr>
            ))}
          </tbody>
        </TableShell>
      )}
      <Pagination meta={list.data?.meta} onPage={(p) => setFilters({ page: String(p) }, false)} />
    </div>
  );
}

function PurchasingPageInner() {
  return (
    <Suspense>
      <PurchaseOrdersScreen />
    </Suspense>
  );
}

export default function PurchasingPage() {
  return (
    <RequirePermission permission="purchasing.view">
      <PurchasingPageInner  />
    </RequirePermission>
  );
}
