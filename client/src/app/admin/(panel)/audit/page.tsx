"use client";

import { Fragment, Suspense, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, RefreshCw } from "lucide-react";
import { request } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { dhakaDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState, ErrorState, LoadingRows, NativeSelect, PageHeader, Pagination } from "@/components/admin/ui";
import { Forbidden, JsonDiff, TableShell, TD, TH, useStaffOptions, useUrlFilters } from "@/components/admin/ops/common";

interface AuditRow {
  id: string; userId: string | null; action: string; entityType: string; entityId: string | null; before: unknown; after: unknown;
  reason: string | null; ip: string | null; createdAt: string; user: { id: string; name: string } | null;
}

const ENTITY_TYPES = [
  "Order", "Customer", "Product", "ProductVariant", "InventoryLevel", "Shipment", "CourierProvider", "CourierSettlement", "ReturnRequest", "Payment",
  "Expense", "Account", "PurchaseOrder", "Supplier", "User", "Role", "Session", "Setting", "DeliveryZone", "District", "Banner", "Page", "Testimonial", "Faq",
  "NotificationTemplate", "NotificationOptOut",
];
const ACTION_PREFIXES = ["order.", "shipment.", "courier.", "settlement.", "return.", "refund.", "payment.", "inventory.", "user.", "role.", "auth.", "settings.", "shipping.", "page.", "banner."];

const KEYS = ["entityType", "entityId", "userId", "action", "page"] as const;

function AuditScreen() {
  const { can } = useAuth();
  const staff = useStaffOptions(can("orders.view"));
  const [filters, setFilters] = useUrlFilters(KEYS);
  const [entityId, setEntityId] = useState(filters.entityId ?? "");
  const [action, setAction] = useState(filters.action ?? "");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const query = { entityType: filters.entityType, entityId: filters.entityId, userId: filters.userId, action: filters.action, page: filters.page ?? 1, pageSize: 50 };
  const list = useQuery({ queryKey: ["audit", query], queryFn: () => request<AuditRow[]>("/audit-logs", { query }), placeholderData: keepPreviousData, enabled: can("audit.view") });
  if (!can("audit.view")) return <Forbidden what="the audit log" />;
  const rows = list.data?.data ?? [];
  const any = KEYS.some((k) => k !== "page" && filters[k]);
  const toggle = (id: string) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <div className="space-y-4">
      <PageHeader title="Audit log" description="Who changed what and when. Every sensitive action is recorded with its before and after values." />
      <form
        className="grid gap-2 rounded-xl border bg-white p-3 sm:grid-cols-2 lg:grid-cols-[180px_minmax(0,1fr)_200px_200px_auto_auto]"
        onSubmit={(e) => { e.preventDefault(); setFilters({ entityId: entityId.trim(), action: action.trim() }); }}
      >
        <NativeSelect aria-label="Entity type" value={filters.entityType ?? ""} onChange={(e) => setFilters({ entityType: e.target.value })}>
          <option value="">All entities</option>
          {ENTITY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </NativeSelect>
        <Input aria-label="Entity id" placeholder="Entity id (exact)" value={entityId} onChange={(e) => setEntityId(e.target.value)} className="h-9 font-mono text-xs" />
        <NativeSelect aria-label="User" value={filters.userId ?? ""} onChange={(e) => setFilters({ userId: e.target.value })}>
          <option value="">Any user</option>
          {staff.data?.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </NativeSelect>
        <Input aria-label="Action prefix" list="audit-actions" placeholder="Action starts with… e.g. order." value={action} onChange={(e) => setAction(e.target.value)} className="h-9" />
        <datalist id="audit-actions">{ACTION_PREFIXES.map((a) => <option key={a} value={a} />)}</datalist>
        <Button type="submit" size="sm" className="h-9">Apply</Button>
        <div className="flex gap-1">
          {any && <Button type="button" variant="ghost" size="sm" className="h-9" onClick={() => { setEntityId(""); setAction(""); setFilters({ entityType: undefined, entityId: undefined, userId: undefined, action: undefined }); }}>Clear</Button>}
          <Button type="button" variant="outline" size="icon" className="size-9" onClick={() => list.refetch()} aria-label="Refresh"><RefreshCw className={cn("size-4", list.isFetching && "animate-spin")} /></Button>
        </div>
      </form>

      {list.isLoading ? <LoadingRows rows={8} /> : list.isError ? <ErrorState error={list.error} onRetry={() => list.refetch()} /> : rows.length === 0 ? <EmptyState title="No audit entries match" /> : (
        <TableShell minWidth={820} className={cn(list.isFetching && "opacity-70")}>
          <thead>
            <tr>
              <th className={cn(TH, "w-8")}><span className="sr-only">Expand</span></th>
              <th className={TH}>When</th>
              <th className={TH}>User</th>
              <th className={TH}>Action</th>
              <th className={TH}>Entity</th>
              <th className={TH}>Reason</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const isOpen = open.has(r.id);
              return (
                <Fragment key={r.id}>
                  <tr className="cursor-pointer hover:bg-muted/30" onClick={() => toggle(r.id)}>
                    <td className={TD}><button aria-expanded={isOpen} aria-label={isOpen ? "Hide changes" : "Show changes"} onClick={(e) => { e.stopPropagation(); toggle(r.id); }}>{isOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}</button></td>
                    <td className={cn(TD, "whitespace-nowrap text-xs")}>{dhakaDateTime(r.createdAt)}</td>
                    <td className={TD}>
                      {r.user ? <button className="text-blue-700 hover:underline" onClick={(e) => { e.stopPropagation(); setFilters({ userId: r.user!.id }); }}>{r.user.name}</button> : <span className="text-muted-foreground">System</span>}
                      {r.ip && <div className="text-[11px] text-muted-foreground">{r.ip}</div>}
                    </td>
                    <td className={cn(TD, "font-mono text-xs")}>{r.action}</td>
                    <td className={TD}>
                      <div className="text-sm">{r.entityType}</div>
                      {r.entityId && <button className="font-mono text-[11px] text-blue-700 hover:underline" title="Show history of this record" onClick={(e) => { e.stopPropagation(); setEntityId(r.entityId!); setFilters({ entityType: r.entityType, entityId: r.entityId! }); }}>{r.entityId}</button>}
                    </td>
                    <td className={cn(TD, "max-w-64 text-xs")}>{r.reason ?? <span className="text-muted-foreground">—</span>}</td>
                  </tr>
                  {isOpen && (
                    <tr>
                      <td colSpan={6} className="border-b bg-slate-50 px-4 py-3"><JsonDiff before={r.before} after={r.after} /></td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </TableShell>
      )}
      <Pagination meta={list.data?.meta} onPage={(p) => setFilters({ page: String(p) }, false)} />
    </div>
  );
}

export default function AuditPage() {
  return <Suspense><AuditScreen /></Suspense>;
}
