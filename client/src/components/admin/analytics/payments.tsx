"use client";

import { useState } from "react";
import Link from "next/link";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, CheckCircle2, RefreshCw, Search, X, XCircle } from "lucide-react";
import { api, request, type PageMeta } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { bdt, dhakaDateTime, titleCase } from "@/lib/format";
import { PAYMENT_METHODS } from "@/lib/status";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmDialog, EmptyState, ErrorState, Field, LoadingRows, NativeSelect, PageHeader, Pagination, Pill } from "@/components/admin/ui";
import { useUrlState } from "./url-state";
import { methodLabel, useAccounts } from "./finance-common";

interface Payment {
  id: string; orderId: string; method: string; kind: string; provider: string | null; amount: string; status: "PENDING" | "COMPLETED" | "FAILED" | "CANCELLED";
  transactionId: string | null; senderNumber: string | null; accountId: string | null; verifiedAt: string | null; note: string | null; createdAt: string;
  order: { id: string; orderNumber: string; shippingName: string }; account: { name: string } | null;
}
interface Gateway { code: string; name: string; configured: boolean; sandbox?: boolean; note?: string }

const STATUS_TONE = { PENDING: "amber", COMPLETED: "green", FAILED: "red", CANCELLED: "gray" } as const;
const KEYS = ["status", "method", "q", "from", "to", "page"] as const;

export function PaymentsScreen() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [f, set] = useUrlState(KEYS);
  const [search, setSearch] = useState(f.q ?? "");
  const [verifying, setVerifying] = useState<Payment | null>(null);
  const [rejecting, setRejecting] = useState<Payment | null>(null);
  const [accountId, setAccountId] = useState("");
  const accounts = useAccounts();
  const query = { status: f.status, method: f.method, q: f.q, from: f.from, to: f.to, page: f.page ?? 1, pageSize: 25 };
  const list = useQuery({ queryKey: ["payments", query], queryFn: () => request<Payment[]>("/payments", { query }), placeholderData: keepPreviousData });
  const gateways = useQuery({ queryKey: ["payments", "gateways"], queryFn: () => api<Gateway[]>("/payments/gateways"), staleTime: 5 * 60_000 });
  const canRecord = can("payments.record");
  const refresh = () => qc.invalidateQueries({ queryKey: ["payments"] });
  const active = ["status", "method", "q", "from", "to"].some((k) => f[k as keyof typeof f]);

  return (
    <div className="space-y-4">
      <PageHeader title="Payments" description="Advance, online and COD payments. Pending payments need checking against the bKash / Nagad / bank statement before verifying." />
      <section className="rounded-xl border bg-white p-3">
        <h2 className="sr-only">Online gateways</h2>
        {gateways.isError ? (
          <ErrorState error={gateways.error} onRetry={() => gateways.refetch()} />
        ) : (
          <ul className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 xl:grid-cols-4">
            {gateways.data?.map((g) => (
              <li key={g.code} className="flex min-w-0 items-start gap-2">
                {g.configured ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-label="Configured" /> : <XCircle className="mt-0.5 size-4 shrink-0 text-slate-400" aria-label="Not configured" />}
                <div className="min-w-0">
                  <p className="font-medium">
                    {g.name} {g.sandbox && g.configured && <Pill tone="amber" className="ml-1">sandbox</Pill>}
                  </p>
                  <p className="line-clamp-2 text-xs text-muted-foreground" title={g.note}>{g.note ?? (g.configured ? "Configured" : "Not configured")}</p>
                </div>
              </li>
            ))}
            {gateways.isLoading && <li className="text-muted-foreground">Loading gateways…</li>}
          </ul>
        )}
      </section>
      <div className="space-y-4">
        <div className="min-w-0 space-y-4">
          <div className="flex flex-wrap items-end gap-2 rounded-xl border bg-white p-3">
            <div role="tablist" aria-label="Status" className="flex flex-wrap gap-1">
              {[undefined, "PENDING", "COMPLETED", "FAILED", "CANCELLED"].map((s) => (
                <button
                  key={s ?? "all"}
                  role="tab"
                  type="button"
                  aria-selected={f.status === s}
                  onClick={() => set({ status: s })}
                  className={cn("rounded-full border px-3 py-1.5 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", f.status === s ? "border-slate-900 bg-slate-900 text-white" : "bg-white text-slate-700 hover:bg-muted")}
                >
                  {s ? titleCase(s) : "All"}
                </button>
              ))}
            </div>
            <NativeSelect aria-label="Method" className="w-40" value={f.method ?? ""} onChange={(e) => set({ method: e.target.value || undefined })}>
              <option value="">Any method</option>
              {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{methodLabel(m)}</option>)}
            </NativeSelect>
            <label className="flex flex-col text-xs text-muted-foreground">
              From
              <Input type="date" className="h-9 w-40" value={f.from ?? ""} onChange={(e) => set({ from: e.target.value || undefined })} />
            </label>
            <label className="flex flex-col text-xs text-muted-foreground">
              To
              <Input type="date" className="h-9 w-40" value={f.to ?? ""} onChange={(e) => set({ to: e.target.value || undefined })} />
            </label>
            <form className="relative min-w-52 flex-1" onSubmit={(e) => { e.preventDefault(); set({ q: search.trim() || undefined }); }}>
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Transaction id, order no., sender number" className="h-9 pl-9" aria-label="Search payments" />
            </form>
            {active && <Button variant="ghost" size="sm" className="h-9" onClick={() => { setSearch(""); set({ status: undefined, method: undefined, q: undefined, from: undefined, to: undefined }); }}>Clear</Button>}
            <Button variant="outline" size="icon" className="size-9" aria-label="Refresh" onClick={() => list.refetch()}>
              <RefreshCw className={cn("size-4", list.isFetching && "animate-spin")} />
            </Button>
          </div>

          {list.isError ? (
            <ErrorState error={list.error} onRetry={() => list.refetch()} />
          ) : list.isLoading ? (
            <LoadingRows rows={6} />
          ) : !list.data?.data.length ? (
            <EmptyState title="No payments match" description={active ? "Try clearing the filters." : "Payments recorded on orders appear here."} />
          ) : (
            <div className={cn("overflow-x-auto rounded-xl border bg-white", list.isFetching && "opacity-70")}>
              <table className="w-full min-w-[920px] text-sm">
                <thead className="border-b bg-muted/50 text-left text-xs text-slate-600">
                  <tr>
                    <th className="px-3 py-2 font-medium">Date</th>
                    <th className="px-3 py-2 font-medium">Order</th>
                    <th className="px-3 py-2 font-medium">Method</th>
                    <th className="px-3 py-2 font-medium">Reference</th>
                    <th className="px-3 py-2 text-right font-medium">Amount</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 font-medium">Account</th>
                    {canRecord && <th className="px-3 py-2 text-right font-medium">Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {list.data.data.map((p) => (
                    <tr key={p.id} className={cn("border-b last:border-0", p.status === "PENDING" && "bg-amber-50/40")}>
                      <td className="whitespace-nowrap px-3 py-2">{dhakaDateTime(p.createdAt)}</td>
                      <td className="px-3 py-2">
                        <Link href={`/admin/orders/${p.order.id}`} className="font-medium text-blue-700 hover:underline">{p.order.orderNumber}</Link>
                        <span className="block text-xs text-muted-foreground">{p.order.shippingName}</span>
                      </td>
                      <td className="px-3 py-2">
                        {methodLabel(p.method)}
                        <span className="block whitespace-nowrap text-xs text-muted-foreground">{titleCase(p.kind)}</span>
                      </td>
                      <td className="max-w-[220px] px-3 py-2">
                        <span className="block truncate font-mono text-xs">{p.transactionId ?? "—"}</span>
                        {p.senderNumber && <span className="block text-xs text-muted-foreground">from {p.senderNumber}</span>}
                        {p.note && <span className="block truncate text-xs text-muted-foreground" title={p.note}>{p.note}</span>}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right font-medium tabular-nums">{bdt(p.amount)}</td>
                      <td className="px-3 py-2"><Pill tone={STATUS_TONE[p.status] ?? "gray"}>{titleCase(p.status)}</Pill></td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{p.account?.name ?? "—"}</td>
                      {canRecord && (
                        <td className="whitespace-nowrap px-3 py-2 text-right">
                          {p.status === "PENDING" && (
                            <div className="inline-flex gap-1">
                              <Button size="sm" variant="outline" className="h-8 border-emerald-300 text-emerald-800 hover:bg-emerald-50" onClick={() => { setAccountId(""); setVerifying(p); }}>
                                <Check className="size-4" /> Verify
                              </Button>
                              <Button size="sm" variant="outline" className="h-8 text-red-700 hover:bg-red-50" onClick={() => setRejecting(p)}>
                                <X className="size-4" /> Reject
                              </Button>
                            </div>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Pagination meta={list.data?.meta as PageMeta | undefined} onPage={(p) => set({ page: String(p) })} />
        </div>

      </div>

      <ConfirmDialog
        open={!!verifying}
        onOpenChange={(o) => !o && setVerifying(null)}
        title={`Verify ${verifying ? bdt(verifying.amount) : ""} for ${verifying?.order.orderNumber ?? ""}?`}
        description={
          verifying && (
            <div className="space-y-3 text-left">
              <p>
                Only verify after you have seen this money in the account. {methodLabel(verifying.method)}
                {verifying.transactionId ? `, transaction ${verifying.transactionId}` : ""}
                {verifying.senderNumber ? ` from ${verifying.senderNumber}` : ""}.
              </p>
              {accounts.data && (
                <Field label="Received into account" htmlFor="verify-account" hint="Records the cash movement in that account's statement.">
                  <NativeSelect id="verify-account" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                    <option value="">Not specified</option>
                    {accounts.data.filter((a) => a.isActive).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </NativeSelect>
                </Field>
              )}
            </div>
          )
        }
        confirmLabel="Verify payment"
        onConfirm={async () => {
          await api(`/payments/${verifying!.id}/verify`, { method: "POST", body: { accountId: accountId || null } });
          toast.success(`Payment for ${verifying!.order.orderNumber} verified`);
          refresh();
        }}
      />
      <ConfirmDialog
        open={!!rejecting}
        onOpenChange={(o) => !o && setRejecting(null)}
        title={`Reject ${rejecting ? bdt(rejecting.amount) : ""} for ${rejecting?.order.orderNumber ?? ""}?`}
        description="Use this when the money was not received or the transaction id is wrong. The order's paid amount is not changed."
        destructive
        requireReason
        reasonLabel="Why is it rejected?"
        confirmLabel="Reject payment"
        onConfirm={async (reason) => {
          await api(`/payments/${rejecting!.id}/reject`, { method: "POST", body: { reason } });
          toast.success("Payment rejected");
          refresh();
        }}
      />
    </div>
  );
}
