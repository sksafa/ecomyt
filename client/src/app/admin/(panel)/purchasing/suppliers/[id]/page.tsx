"use client";

import Link from "next/link";
import { use, useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Mail, MapPin, Pencil, Phone, Plus } from "lucide-react";
import { api, request } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { bdt, dhakaDay, telHref, titleCase } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, LoadingRows, PageHeader, Pagination, Pill, Section } from "@/components/admin/ui";
import { PO_STATUS, Stat, TableShell, td, th, type Supplier, RequirePermission } from "@/components/admin/catalog/shared";
import { SupplierDialog } from "@/components/admin/catalog/supplier-dialog";
import { SupplierPaymentForm } from "@/components/admin/catalog/supplier-payment";

interface SupplierDetail extends Supplier {
  purchaseHistory: { id: string; number: string; status: string; orderedAt: string | null; receivedAt: string | null; total: string; paidAmount: string; createdAt: string; itemCount: number }[];
}
interface Payment { id: string; amount: string; method: string; reference: string | null; paidAt: string; note: string | null; account: { id: string; name: string } | null; purchaseOrder: { id: string; number: string } | null }

function SupplierDetailPageInner({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { can } = useAuth();
  const qc = useQueryClient();
  const finance = can("finance.view");
  const manage = can("purchasing.manage");
  const [editing, setEditing] = useState(false);
  const [payPage, setPayPage] = useState(1);
  const [paying, setPaying] = useState(false);
  const q = useQuery({ queryKey: ["supplier", id], queryFn: () => api<SupplierDetail>(`/suppliers/${id}`) });
  const payments = useQuery({
    queryKey: ["supplier", id, "payments", payPage],
    queryFn: () => request<Payment[]>(`/suppliers/${id}/payments`, { query: { page: payPage, pageSize: 20 } }),
    enabled: finance,
    placeholderData: keepPreviousData,
  });

  if (q.isLoading) return <LoadingRows rows={8} />;
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const s = q.data;
  const openPos = s.purchaseHistory
    .filter((p) => ["ORDERED", "PARTIALLY_RECEIVED", "RECEIVED"].includes(p.status) && Number(p.total) > Number(p.paidAmount))
    .map((p) => ({ id: p.id, number: p.number, openBalance: (Number(p.total) - Number(p.paidAmount)).toFixed(2) }));

  return (
    <div className="space-y-4">
      <Link href="/admin/purchasing/suppliers" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> Suppliers</Link>
      <PageHeader
        title={s.name}
        description={s.contactName ? `Contact: ${s.contactName}` : undefined}
        actions={
          manage && (
            <>
              <Button variant="outline" size="sm" onClick={() => setEditing(true)}><Pencil className="size-4" /> Edit</Button>
              {s.isActive && <Button size="sm" asChild><Link href="/admin/purchasing/new"><Plus className="size-4" /> New purchase order</Link></Button>}
            </>
          )
        }
      >
        {!s.isActive && <Pill tone="gray" className="mt-2">Deactivated</Pill>}
      </PageHeader>

      {finance && s.balance && (
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat label="Purchased (committed)" value={bdt(s.balance.purchased)} hint="Ordered + received purchase orders" />
          <Stat label="Paid" value={bdt(s.balance.paid)} />
          <Stat label={Number(s.balance.outstanding) < 0 ? "Advance with supplier" : "Outstanding"} value={bdt(Math.abs(Number(s.balance.outstanding)))} tone={Number(s.balance.outstanding) > 0 ? "warn" : "good"} />
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Section title={`Purchase history (${s.purchaseHistory.length})`}>
            {s.purchaseHistory.length === 0 ? (
              <EmptyState title="No purchase orders yet" />
            ) : (
              <TableShell className="border-0">
                <thead><tr><th className={th}>PO</th><th className={th}>Status</th><th className={th}>Created</th><th className={th}>Received</th><th className={cn(th, "text-right")}>Items</th><th className={cn(th, "text-right")}>Total</th>{finance && <th className={cn(th, "text-right")}>Paid</th>}</tr></thead>
                <tbody>
                  {s.purchaseHistory.map((p) => (
                    <tr key={p.id} className="hover:bg-muted/30">
                      <td className={td}><Link className="font-medium text-blue-700 hover:underline" href={`/admin/purchasing/${p.id}`}>{p.number}</Link></td>
                      <td className={td}><Pill tone={PO_STATUS[p.status]?.tone ?? "gray"}>{PO_STATUS[p.status]?.label ?? p.status}</Pill></td>
                      <td className={cn(td, "whitespace-nowrap")}>{dhakaDay(p.createdAt)}</td>
                      <td className={cn(td, "whitespace-nowrap")}>{dhakaDay(p.receivedAt)}</td>
                      <td className={cn(td, "text-right tabular-nums")}>{p.itemCount}</td>
                      <td className={cn(td, "text-right tabular-nums")}>{bdt(p.total)}</td>
                      {finance && <td className={cn(td, "text-right tabular-nums")}>{bdt(p.paidAmount)}</td>}
                    </tr>
                  ))}
                </tbody>
              </TableShell>
            )}
          </Section>

          {finance && (
            <Section title="Payments" actions={manage && !paying ? <Button size="sm" variant="outline" onClick={() => setPaying(true)}><Plus className="size-4" /> Record payment</Button> : undefined}>
              {paying && (
                <div className="mb-4">
                  <SupplierPaymentForm
                    supplierId={s.id}
                    poOptions={openPos}
                    onDone={() => {
                      setPaying(false);
                      qc.invalidateQueries({ queryKey: ["supplier", id] });
                      qc.invalidateQueries({ queryKey: ["suppliers"] });
                    }}
                  />
                  <div className="mt-1 flex justify-end"><Button size="sm" variant="ghost" onClick={() => setPaying(false)}>Close</Button></div>
                </div>
              )}
              {payments.isLoading ? <LoadingRows rows={3} /> : payments.isError ? <ErrorState error={payments.error} onRetry={() => payments.refetch()} /> : !payments.data?.data.length ? (
                <p className="text-sm text-muted-foreground">No payments recorded.</p>
              ) : (
                <>
                  <TableShell className="border-0">
                    <thead><tr><th className={th}>Date</th><th className={cn(th, "text-right")}>Amount</th><th className={th}>Method</th><th className={th}>Account</th><th className={th}>PO</th><th className={th}>Reference / note</th></tr></thead>
                    <tbody>
                      {payments.data.data.map((p) => (
                        <tr key={p.id}>
                          <td className={cn(td, "whitespace-nowrap")}>{dhakaDay(p.paidAt)}</td>
                          <td className={cn(td, "text-right font-medium tabular-nums")}>{bdt(p.amount)}</td>
                          <td className={td}>{titleCase(p.method)}</td>
                          <td className={td}>{p.account?.name ?? "—"}</td>
                          <td className={td}>{p.purchaseOrder ? <Link className="text-blue-700 hover:underline" href={`/admin/purchasing/${p.purchaseOrder.id}`}>{p.purchaseOrder.number}</Link> : <span className="text-muted-foreground">Advance</span>}</td>
                          <td className={cn(td, "text-xs")}>{[p.reference, p.note].filter(Boolean).join(" · ") || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </TableShell>
                  <Pagination meta={payments.data.meta} onPage={setPayPage} />
                </>
              )}
            </Section>
          )}
        </div>

        <Section title="Contact">
          <ul className="space-y-2 text-sm">
            <li className="flex gap-2"><Phone className="mt-0.5 size-4 text-muted-foreground" />{s.phone ? <a className="tabular-nums text-blue-700 hover:underline" href={telHref(s.phone)}>{s.phone}</a> : "—"}</li>
            <li className="flex gap-2"><Mail className="mt-0.5 size-4 text-muted-foreground" />{s.email ? <a className="break-all text-blue-700 hover:underline" href={`mailto:${s.email}`}>{s.email}</a> : "—"}</li>
            <li className="flex gap-2"><MapPin className="mt-0.5 size-4 text-muted-foreground" /><span className="whitespace-pre-wrap">{s.address || "—"}</span></li>
          </ul>
          {s.notes && <p className="mt-3 whitespace-pre-wrap border-t pt-3 text-sm">{s.notes}</p>}
        </Section>
      </div>

      {editing && <SupplierDialog key={s.id} supplier={s} open onClose={() => setEditing(false)} />}
    </div>
  );
}

export default function SupplierDetailPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <RequirePermission permission="purchasing.view">
      <SupplierDetailPageInner params={params} />
    </RequirePermission>
  );
}
