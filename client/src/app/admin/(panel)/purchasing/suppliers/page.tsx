"use client";

import Link from "next/link";
import { Suspense, useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Ban, Pencil, Plus, RefreshCw, Truck } from "lucide-react";
import { api, request } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { bdt } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, EmptyState, ErrorState, IconAction, LoadingRows, NativeSelect, PageHeader, Pagination, Pill } from "@/components/admin/ui";
import { SearchBox, TableShell, td, th, useUrlFilters, type Supplier, RequirePermission } from "@/components/admin/catalog/shared";
import { SupplierDialog } from "@/components/admin/catalog/supplier-dialog";

const KEYS = ["search", "active", "page"] as const;

function SuppliersScreen() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const { filters, setFilters } = useUrlFilters(KEYS);
  const [search, setSearch] = useState(filters.search ?? "");
  const [editing, setEditing] = useState<{ supplier: Supplier | null } | null>(null);
  const [deactivating, setDeactivating] = useState<Supplier | null>(null);
  const query = { search: filters.search, active: filters.active ?? "true", page: filters.page ?? 1, pageSize: 25 };
  const list = useQuery({ queryKey: ["suppliers", "list", query], queryFn: () => request<Supplier[]>("/suppliers", { query }), placeholderData: keepPreviousData });
  const manage = can("purchasing.manage");
  const finance = can("finance.view");

  return (
    <div className="space-y-4">
      <Link href="/admin/purchasing" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> Purchase orders</Link>
      <PageHeader
        title="Suppliers"
        description={finance ? "Outstanding = ordered/received purchase orders − payments made." : "Who you buy finished goods and materials from."}
        actions={manage && <Button size="sm" onClick={() => setEditing({ supplier: null })}><Plus className="size-4" /> New supplier</Button>}
      />
      <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-white p-3">
        <SearchBox value={search} onChange={setSearch} onSubmit={(v) => setFilters({ search: v })} placeholder="Name, contact or phone" label="Search suppliers" />
        <NativeSelect className="w-40" aria-label="Status" value={filters.active ?? "true"} onChange={(e) => setFilters({ active: e.target.value === "true" ? undefined : e.target.value })}>
          <option value="true">Active</option>
          <option value="false">Deactivated</option>
          <option value="all">All</option>
        </NativeSelect>
        <Button variant="outline" size="icon" className="size-9" onClick={() => list.refetch()} aria-label="Refresh"><RefreshCw className={cn("size-4", list.isFetching && "animate-spin")} /></Button>
      </div>
      {list.isLoading ? (
        <LoadingRows rows={5} />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : !list.data?.data.length ? (
        <EmptyState icon={<Truck className="size-8" />} title="No suppliers" description={filters.search ? "Try another search." : "Add the fabric houses, embroiderers and makers you buy from."} action={manage && !filters.search ? <Button size="sm" onClick={() => setEditing({ supplier: null })}>New supplier</Button> : undefined} />
      ) : (
        <TableShell className={cn(list.isFetching && "opacity-70")}>
          <thead>
            <tr>
              <th className={th}>Supplier</th><th className={th}>Contact</th><th className={cn(th, "text-right")}>POs</th>
              {finance && <><th className={cn(th, "text-right")}>Purchased</th><th className={cn(th, "text-right")}>Paid</th><th className={cn(th, "text-right")}>Outstanding</th></>}
              <th className={th}>Status</th><th className={cn(th, "text-right")}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {list.data.data.map((s) => (
              <tr key={s.id} className="hover:bg-muted/30">
                <td className={td}><Link href={`/admin/purchasing/suppliers/${s.id}`} className="font-medium text-blue-700 hover:underline">{s.name}</Link></td>
                <td className={td}>
                  {s.contactName && <p>{s.contactName}</p>}
                  <p className="text-xs tabular-nums text-muted-foreground">{[s.phone, s.email].filter(Boolean).join(" · ") || "—"}</p>
                </td>
                <td className={cn(td, "text-right tabular-nums")}>{s.purchaseOrderCount ?? 0}</td>
                {finance && (
                  <>
                    <td className={cn(td, "text-right tabular-nums")}>{bdt(s.balance?.purchased)}</td>
                    <td className={cn(td, "text-right tabular-nums")}>{bdt(s.balance?.paid)}</td>
                    <td className={cn(td, "text-right font-medium tabular-nums", Number(s.balance?.outstanding) > 0 ? "text-amber-700" : Number(s.balance?.outstanding) < 0 && "text-green-700")}>
                      {bdt(s.balance?.outstanding)}{Number(s.balance?.outstanding) < 0 && <span className="block text-xs font-normal">advance</span>}
                    </td>
                  </>
                )}
                <td className={td}><Pill tone={s.isActive ? "green" : "gray"}>{s.isActive ? "Active" : "Deactivated"}</Pill></td>
                <td className={cn(td, "whitespace-nowrap text-right")}>
                  {manage && (
                    <>
                      <IconAction label="Edit" onClick={() => setEditing({ supplier: s })}><Pencil className="size-4" /></IconAction>
                      {s.isActive && <IconAction label="Deactivate" onClick={() => setDeactivating(s)}><Ban className="size-4" /></IconAction>}
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </TableShell>
      )}
      <Pagination meta={list.data?.meta} onPage={(p) => setFilters({ page: String(p) }, false)} />
      {editing && <SupplierDialog key={editing.supplier?.id ?? "new"} supplier={editing.supplier} open onClose={() => setEditing(null)} />}
      <ConfirmDialog
        open={!!deactivating}
        onOpenChange={(o) => !o && setDeactivating(null)}
        title={`Deactivate ${deactivating?.name ?? ""}?`}
        description="The supplier is hidden from new purchase orders. Purchase history, payments and balances are kept, and you can reactivate later by editing the supplier."
        confirmLabel="Deactivate"
        destructive
        onConfirm={async () => {
          await api(`/suppliers/${deactivating!.id}`, { method: "DELETE" });
          toast.success("Supplier deactivated");
          qc.invalidateQueries({ queryKey: ["suppliers"] });
        }}
      />
    </div>
  );
}

function SuppliersPageInner() {
  return (
    <Suspense>
      <SuppliersScreen />
    </Suspense>
  );
}

export default function SuppliersPage() {
  return (
    <RequirePermission permission="purchasing.view">
      <SuppliersPageInner  />
    </RequirePermission>
  );
}
