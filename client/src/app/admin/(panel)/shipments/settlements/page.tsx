"use client";

import Link from "next/link";
import { Suspense } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { api, request } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { ago, bdt, dhakaDateTime, dhakaDay } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { EmptyState, ErrorState, LoadingRows, PageHeader, Pagination, Pill, Section } from "@/components/admin/ui";
import { daysSince, Forbidden, SHIPPING_NAV, Stat, SubNav, TableShell, TD, TH, useUrlFilters } from "@/components/admin/ops/common";
import type { CodSummaryRow, SettlementDetail, SettlementRow } from "@/components/admin/ops/types";

function SettlementSheet({ id, onClose }: { id: string | null; onClose: () => void }) {
  const q = useQuery({ queryKey: ["settlement", id], queryFn: () => api<SettlementDetail>(`/couriers/settlements/${id}`), enabled: !!id });
  const s = q.data;
  const variance = s ? Number(s.receivedAmount) - Number(s.netPayable) : 0;
  return (
    <Sheet open={!!id} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>Settlement {s?.reference ?? ""}</SheetTitle>
          <SheetDescription>{s ? `${s.provider.name} · received ${dhakaDateTime(s.receivedAt)} into ${s.account?.name ?? "—"}` : "Loading…"}</SheetDescription>
        </SheetHeader>
        <div className="space-y-4 px-4 pb-6">
          {q.isLoading ? (
            <LoadingRows rows={4} />
          ) : q.isError || !s ? (
            <ErrorState error={q.error} onRetry={() => q.refetch()} />
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Stat label="COD collected" value={bdt(s.totalCollected)} />
                <Stat label="Courier fees" value={bdt(s.totalFees)} />
                <Stat label="Net payable" value={bdt(s.netPayable)} />
                <Stat label="Received" value={bdt(s.receivedAmount)} hint={variance === 0 ? "matches" : `variance ${bdt(variance)}`} tone={variance === 0 ? "good" : "warn"} />
              </div>
              {(s.periodStart || s.periodEnd) && <p className="text-sm text-muted-foreground">Period {dhakaDay(s.periodStart)} – {dhakaDay(s.periodEnd)}</p>}
              {s.note && <p className="rounded-md bg-muted p-2 text-sm">{s.note}</p>}
              <TableShell minWidth={620}>
                <thead>
                  <tr>
                    <th className={TH}>Order / tracking</th>
                    <th className={cn(TH, "text-right")}>Collected</th>
                    <th className={cn(TH, "text-right")}>Delivery</th>
                    <th className={cn(TH, "text-right")}>COD fee</th>
                    <th className={cn(TH, "text-right")}>Return</th>
                    <th className={cn(TH, "text-right")}>Net</th>
                  </tr>
                </thead>
                <tbody>
                  {s.items.map((i) => (
                    <tr key={i.id}>
                      <td className={TD}>
                        <Link href={`/admin/orders/${i.shipment.order.id}`} className="font-medium text-blue-700 hover:underline">{i.shipment.order.orderNumber}</Link>
                        <div className="font-mono text-xs text-muted-foreground">{i.shipment.trackingCode ?? i.shipment.consignmentId}</div>
                      </td>
                      <td className={cn(TD, "text-right tabular-nums")}>{bdt(i.collected)}</td>
                      <td className={cn(TD, "text-right tabular-nums")}>{bdt(i.deliveryFee)}</td>
                      <td className={cn(TD, "text-right tabular-nums")}>{bdt(i.codCharge)}</td>
                      <td className={cn(TD, "text-right tabular-nums")}>{bdt(i.returnFee)}</td>
                      <td className={cn(TD, "text-right font-medium tabular-nums")}>{bdt(i.net)}</td>
                    </tr>
                  ))}
                </tbody>
              </TableShell>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function SettlementsScreen() {
  const { can } = useAuth();
  const [filters, setFilters] = useUrlFilters(["page", "id"] as const);
  const allowed = can("shipments.view", "finance.view");
  const summary = useQuery({ queryKey: ["cod-summary"], queryFn: () => api<CodSummaryRow[]>("/couriers/cod/summary"), enabled: allowed });
  const query = { page: filters.page ?? 1, pageSize: 25 };
  const list = useQuery({ queryKey: ["settlements", query], queryFn: () => request<SettlementRow[]>("/couriers/settlements", { query }), placeholderData: keepPreviousData, enabled: allowed });

  if (!allowed) return <><PageHeader title="Shipping" /><SubNav items={SHIPPING_NAV(can)} /><Forbidden what="COD settlements" /></>;

  const totals = (summary.data ?? []).reduce((t, r) => ({ n: t.n + r.unsettledShipments, c: t.c + Number(r.codCollected), p: t.p + Number(r.expectedPayout) }), { n: 0, c: 0, p: 0 });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Shipping"
        description="Reconcile cash-on-delivery money collected by couriers against the payouts you receive."
        actions={can("accounts.reconcile") && (
          <Button size="sm" asChild><Link href="/admin/shipments/settlements/new"><Plus className="size-4" /> Record settlement</Link></Button>
        )}
      />
      <SubNav items={SHIPPING_NAV(can)} />

      <Section title="Awaiting settlement">
        {summary.isLoading ? (
          <LoadingRows rows={2} />
        ) : summary.isError ? (
          <ErrorState error={summary.error} onRetry={() => summary.refetch()} />
        ) : !summary.data?.length ? (
          <p className="text-sm text-muted-foreground">Every delivered and returned parcel has been settled.</p>
        ) : (
          <div className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-3">
              <Stat label="Unsettled parcels" value={totals.n} />
              <Stat label="COD held by couriers" value={bdt(totals.c)} />
              <Stat label="Expected payout" value={bdt(totals.p)} hint="after known courier fees" />
            </div>
            <TableShell minWidth={760}>
              <thead>
                <tr>
                  <th className={TH}>Courier</th>
                  <th className={cn(TH, "text-right")}>Parcels</th>
                  <th className={cn(TH, "text-right")}>COD collected</th>
                  <th className={cn(TH, "text-right")}>Known fees</th>
                  <th className={cn(TH, "text-right")}>Expected payout</th>
                  <th className={TH}>Oldest unsettled</th>
                  <th className={TH}><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {summary.data.map((r) => {
                  const days = daysSince(r.oldestUnsettledAt);
                  return (
                    <tr key={r.provider.id}>
                      <td className={cn(TD, "font-medium")}>{r.provider.name}</td>
                      <td className={cn(TD, "text-right tabular-nums")}>{r.unsettledShipments}</td>
                      <td className={cn(TD, "text-right tabular-nums")}>{bdt(r.codCollected)}</td>
                      <td className={cn(TD, "text-right tabular-nums")}>{bdt(r.knownFees)}</td>
                      <td className={cn(TD, "text-right font-semibold tabular-nums")}>{bdt(r.expectedPayout)}</td>
                      <td className={TD}>
                        <span className={cn(days > 14 ? "font-medium text-red-700" : days > 7 ? "text-amber-700" : "")}>{dhakaDay(r.oldestUnsettledAt)}</span>
                        <div className="text-xs text-muted-foreground">{ago(r.oldestUnsettledAt)}</div>
                      </td>
                      <td className={cn(TD, "whitespace-nowrap text-right")}>
                        <Button variant="ghost" size="sm" asChild><Link href={`/admin/shipments?providerId=${r.provider.id}&unsettled=true`}>Parcels</Link></Button>
                        {can("accounts.reconcile") && <Button variant="outline" size="sm" asChild><Link href={`/admin/shipments/settlements/new?providerId=${r.provider.id}`}>Settle</Link></Button>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </TableShell>
          </div>
        )}
      </Section>

      <Section title="Recorded settlements">
        {list.isLoading ? (
          <LoadingRows rows={3} />
        ) : list.isError ? (
          <ErrorState error={list.error} onRetry={() => list.refetch()} />
        ) : !list.data?.data.length ? (
          <EmptyState title="No settlements yet" description="Record a courier payout to reconcile its parcels and post the cash to an account." />
        ) : (
          <>
            <TableShell minWidth={860}>
              <thead>
                <tr>
                  <th className={TH}>Reference</th>
                  <th className={TH}>Courier</th>
                  <th className={TH}>Received</th>
                  <th className={TH}>Account</th>
                  <th className={cn(TH, "text-right")}>Parcels</th>
                  <th className={cn(TH, "text-right")}>Net payable</th>
                  <th className={cn(TH, "text-right")}>Received</th>
                  <th className={cn(TH, "text-right")}>Variance</th>
                </tr>
              </thead>
              <tbody>
                {list.data.data.map((s) => {
                  const v = Number(s.receivedAmount) - Number(s.netPayable);
                  return (
                    <tr key={s.id} className="cursor-pointer hover:bg-muted/30" onClick={() => setFilters({ id: s.id }, false)}>
                      <td className={TD}><button className="font-medium text-blue-700 hover:underline">{s.reference}</button></td>
                      <td className={TD}>{s.provider.name}</td>
                      <td className={cn(TD, "whitespace-nowrap")}>{dhakaDay(s.receivedAt)}</td>
                      <td className={TD}>{s.account?.name ?? "—"}</td>
                      <td className={cn(TD, "text-right tabular-nums")}>{s._count?.items ?? "—"}</td>
                      <td className={cn(TD, "text-right tabular-nums")}>{bdt(s.netPayable)}</td>
                      <td className={cn(TD, "text-right tabular-nums")}>{bdt(s.receivedAmount)}</td>
                      <td className={cn(TD, "text-right")}>{v === 0 ? <Pill tone="green">matched</Pill> : <Pill tone={v < 0 ? "red" : "amber"}>{bdt(v)}</Pill>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </TableShell>
            <Pagination meta={list.data.meta} onPage={(p) => setFilters({ page: String(p) }, false)} />
          </>
        )}
      </Section>
      <SettlementSheet id={filters.id ?? null} onClose={() => setFilters({ id: undefined }, false)} />
    </div>
  );
}

export default function SettlementsPage() {
  return (
    <Suspense>
      <SettlementsScreen />
    </Suspense>
  );
}
