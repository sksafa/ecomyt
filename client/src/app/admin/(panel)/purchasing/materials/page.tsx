"use client";

import Link from "next/link";
import { Suspense, useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Ban, Loader2, Pencil, Plus, RefreshCw, Scissors } from "lucide-react";
import { api, ApiError, errorMessage, request } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { bdt, dhakaDay } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ConfirmDialog, EmptyState, ErrorState, Field, IconAction, LoadingRows, NativeSelect, PageHeader, Pagination, Pill } from "@/components/admin/ui";
import { SearchBox, TableShell, td, th, useUrlFilters, type Material, RequirePermission } from "@/components/admin/catalog/shared";

const KEYS = ["search", "active", "page"] as const;
const UNITS = ["yard", "metre", "piece", "gram", "kg", "spool", "roll", "hour", "set"];

function MaterialsScreen() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const { filters, setFilters } = useUrlFilters(KEYS);
  const [search, setSearch] = useState(filters.search ?? "");
  const [editing, setEditing] = useState<{ m: Material | null } | null>(null);
  const [deactivating, setDeactivating] = useState<Material | null>(null);
  const query = { search: filters.search, active: filters.active ?? "true", page: filters.page ?? 1, pageSize: 50 };
  const list = useQuery({ queryKey: ["materials", "list", query], queryFn: () => request<Material[]>("/materials", { query }), placeholderData: keepPreviousData });
  const manage = can("purchasing.manage");

  return (
    <div className="space-y-4">
      <Link href="/admin/purchasing" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> Purchase orders</Link>
      <PageHeader
        title="Materials"
        description="Fabric, lace, thread and packaging. Unit costs feed product cost breakdowns; stock grows when purchase orders are received."
        actions={manage && <Button size="sm" onClick={() => setEditing({ m: null })}><Plus className="size-4" /> New material</Button>}
      />
      <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-white p-3">
        <SearchBox value={search} onChange={setSearch} onSubmit={(v) => setFilters({ search: v })} placeholder="Search materials" label="Search materials" />
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
        <EmptyState icon={<Scissors className="size-8" />} title="No materials" description={filters.search ? "Try another search." : "Add the raw materials you buy, e.g. Silk blend fabric (yard), Zari thread (spool)."} action={manage && !filters.search ? <Button size="sm" onClick={() => setEditing({ m: null })}>New material</Button> : undefined} />
      ) : (
        <TableShell className={cn(list.isFetching && "opacity-70")}>
          <thead><tr><th className={th}>Material</th><th className={th}>Unit</th><th className={cn(th, "text-right")}>Unit cost</th><th className={cn(th, "text-right")}>In stock</th><th className={th}>Updated</th><th className={th}>Status</th><th className={cn(th, "text-right")}>Actions</th></tr></thead>
          <tbody>
            {list.data.data.map((m) => (
              <tr key={m.id} className="hover:bg-muted/30">
                <td className={cn(td, "font-medium")}>{m.name}</td>
                <td className={td}>{m.unit}</td>
                <td className={cn(td, "text-right tabular-nums")}>{bdt(m.unitCost)}</td>
                <td className={cn(td, "text-right tabular-nums")}>{Number(m.stockQty).toLocaleString("en-IN", { maximumFractionDigits: 3 })} <span className="text-xs text-muted-foreground">{m.unit}</span></td>
                <td className={cn(td, "whitespace-nowrap")}>{dhakaDay(m.updatedAt)}</td>
                <td className={td}><Pill tone={m.isActive ? "green" : "gray"}>{m.isActive ? "Active" : "Deactivated"}</Pill></td>
                <td className={cn(td, "whitespace-nowrap text-right")}>
                  {manage && (
                    <>
                      <IconAction label="Edit" onClick={() => setEditing({ m })}><Pencil className="size-4" /></IconAction>
                      {m.isActive && <IconAction label="Deactivate" onClick={() => setDeactivating(m)}><Ban className="size-4" /></IconAction>}
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </TableShell>
      )}
      <Pagination meta={list.data?.meta} onPage={(p) => setFilters({ page: String(p) }, false)} />
      {editing && <MaterialDialog key={editing.m?.id ?? "new"} material={editing.m} onClose={() => setEditing(null)} />}
      <ConfirmDialog
        open={!!deactivating}
        onOpenChange={(o) => !o && setDeactivating(null)}
        title={`Deactivate ${deactivating?.name ?? ""}?`}
        description="It will no longer be offered in purchase orders and cost breakdowns. Existing product cost lines and purchase history are kept."
        confirmLabel="Deactivate"
        destructive
        onConfirm={async () => {
          await api(`/materials/${deactivating!.id}`, { method: "DELETE" });
          toast.success("Material deactivated");
          qc.invalidateQueries({ queryKey: ["materials"] });
        }}
      />
    </div>
  );
}

function MaterialDialog({ material, onClose }: { material: Material | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [d, setD] = useState({ name: material?.name ?? "", unit: material?.unit ?? "yard", unitCost: material ? String(Number(material.unitCost)) : "", isActive: material?.isActive ?? true });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: () => api(material ? `/materials/${material.id}` : "/materials", { method: material ? "PUT" : "POST", body: { name: d.name.trim(), unit: d.unit.trim(), unitCost: d.unitCost.trim(), isActive: d.isActive } }),
    onSuccess: () => {
      toast.success(material ? "Material updated" : "Material added");
      qc.invalidateQueries({ queryKey: ["materials"] });
      onClose();
    },
    onError: (e) => {
      if (e instanceof ApiError) setErrors(e.status === 409 ? { name: e.message } : e.fieldErrors);
      toast.error(errorMessage(e));
    },
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{material ? "Edit material" : "New material"}</DialogTitle>
          {material && <DialogDescription>Stock on hand ({Number(material.stockQty)} {material.unit}) changes only by receiving purchase orders.</DialogDescription>}
        </DialogHeader>
        <form
          id="mat-form"
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            const local: Record<string, string> = {};
            if (d.name.trim().length < 2) local.name = "Name is required";
            if (!d.unit.trim()) local.unit = "Unit is required";
            if (!/^\d+(\.\d{1,2})?$/.test(d.unitCost.trim())) local.unitCost = "Enter an amount like 450 or 450.50";
            setErrors(local);
            if (!Object.keys(local).length) save.mutate();
          }}
        >
          <Field label="Name" htmlFor="m-name" error={errors.name}><Input id="m-name" value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} autoFocus placeholder="e.g. Silk blend fabric" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Unit" htmlFor="m-unit" error={errors.unit}>
              <Input id="m-unit" list="material-units" value={d.unit} onChange={(e) => setD({ ...d, unit: e.target.value })} />
              <datalist id="material-units">{UNITS.map((u) => <option key={u} value={u} />)}</datalist>
            </Field>
            <Field label="Unit cost (৳)" htmlFor="m-cost" error={errors.unitCost}><Input id="m-cost" inputMode="decimal" value={d.unitCost} onChange={(e) => setD({ ...d, unitCost: e.target.value })} /></Field>
          </div>
          {material && <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4" checked={d.isActive} onChange={(e) => setD({ ...d, isActive: e.target.checked })} /> Active</label>}
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="mat-form" disabled={save.isPending}>{save.isPending && <Loader2 className="size-4 animate-spin" />} Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MaterialsPageInner() {
  return (
    <Suspense>
      <MaterialsScreen />
    </Suspense>
  );
}

export default function MaterialsPage() {
  return (
    <RequirePermission permission="purchasing.view">
      <MaterialsPageInner  />
    </RequirePermission>
  );
}
