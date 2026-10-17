"use client";

import { useState } from "react";
import Link from "next/link";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Banknote, Check, Loader2, RefreshCw, X } from "lucide-react";
import { api, errorMessage, request, type PageMeta } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { bdt, dhakaDateTime, titleCase } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ConfirmDialog, EmptyState, ErrorState, Field, LoadingRows, NativeSelect, PageHeader, Pagination, Pill } from "@/components/admin/ui";
import { useUrlState } from "./url-state";
import { methodLabel, useAccounts } from "./finance-common";

interface Refund {
  id: string; orderId: string; amount: string; method: string; status: "PENDING" | "APPROVED" | "PAID" | "REJECTED"; reason: string; reference: string | null;
  approvedAt: string | null; paidAt: string | null; createdAt: string;
  order: { id: string; orderNumber: string; shippingName: string }; return: { id: string; returnNumber: string } | null; account: { name: string } | null;
}
const STATUS_TONE = { PENDING: "amber", APPROVED: "blue", PAID: "green", REJECTED: "gray" } as const;
const KEYS = ["status", "page"] as const;

export function RefundsScreen() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [f, set] = useUrlState(KEYS);
  const [approving, setApproving] = useState<Refund | null>(null);
  const [rejecting, setRejecting] = useState<Refund | null>(null);
  const [paying, setPaying] = useState<Refund | null>(null);
  const query = { status: f.status, page: f.page ?? 1, pageSize: 25 };
  const list = useQuery({ queryKey: ["refunds", query], queryFn: () => request<Refund[]>("/refunds", { query }), placeholderData: keepPreviousData });
  const canApprove = can("refunds.approve");
  const refresh = () => qc.invalidateQueries({ queryKey: ["refunds"] });

  return (
    <div className="space-y-4">
      <PageHeader title="Refunds" description="Refunds are requested from returns or orders, approved by a manager, then paid from an account." />
      <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-white p-3">
        <div role="tablist" aria-label="Status" className="flex flex-wrap gap-1">
          {[undefined, "PENDING", "APPROVED", "PAID", "REJECTED"].map((s) => (
            <button
              key={s ?? "all"}
              role="tab"
              type="button"
              aria-selected={f.status === s}
              onClick={() => set({ status: s })}
              className={cn("rounded-full border px-3 py-1.5 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", f.status === s ? "border-slate-900 bg-slate-900 text-white" : "bg-white text-slate-700 hover:bg-muted")}
            >
              {s ? (s === "APPROVED" ? "Approved · to pay" : titleCase(s)) : "All"}
            </button>
          ))}
        </div>
        <Button variant="outline" size="icon" className="ml-auto size-9" aria-label="Refresh" onClick={() => list.refetch()}>
          <RefreshCw className={cn("size-4", list.isFetching && "animate-spin")} />
        </Button>
      </div>
      {!canApprove && <p className="text-xs text-muted-foreground">You can view refunds; approving and paying needs the refunds.approve permission.</p>}

      {list.isError ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : list.isLoading ? (
        <LoadingRows rows={5} />
      ) : !list.data?.data.length ? (
        <EmptyState title={f.status ? `No ${f.status.toLowerCase()} refunds` : "No refunds yet"} description="Refunds requested from a return or an order appear here for approval." />
      ) : (
        <div className={cn("overflow-x-auto rounded-xl border bg-white", list.isFetching && "opacity-70")}>
          <table className="w-full min-w-[880px] text-sm">
            <thead className="border-b bg-muted/50 text-left text-xs text-slate-600">
              <tr>
                <th className="px-3 py-2 font-medium">Requested</th>
                <th className="px-3 py-2 font-medium">Order</th>
                <th className="px-3 py-2 font-medium">Reason</th>
                <th className="px-3 py-2 font-medium">Method</th>
                <th className="px-3 py-2 text-right font-medium">Amount</th>
                <th className="px-3 py-2 font-medium">Status</th>
                {canApprove && <th className="px-3 py-2 text-right font-medium">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {list.data.data.map((r) => (
                <tr key={r.id} className="border-b last:border-0">
                  <td className="whitespace-nowrap px-3 py-2">{dhakaDateTime(r.createdAt)}</td>
                  <td className="px-3 py-2">
                    <Link href={`/admin/orders/${r.order.id}`} className="font-medium text-blue-700 hover:underline">{r.order.orderNumber}</Link>
                    <span className="block text-xs text-muted-foreground">
                      {r.order.shippingName}
                      {r.return && <> · <Link href={`/admin/returns/${r.return.id}`} className="hover:underline">{r.return.returnNumber}</Link></>}
                    </span>
                  </td>
                  <td className="max-w-[260px] px-3 py-2"><span className="line-clamp-2" title={r.reason}>{r.reason}</span></td>
                  <td className="px-3 py-2">{methodLabel(r.method)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right font-medium tabular-nums">{bdt(r.amount)}</td>
                  <td className="px-3 py-2">
                    <Pill tone={STATUS_TONE[r.status]}>{titleCase(r.status)}</Pill>
                    {r.status === "PAID" && (
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {dhakaDateTime(r.paidAt)} · {r.account?.name}{r.reference ? ` · ${r.reference}` : ""}
                      </span>
                    )}
                  </td>
                  {canApprove && (
                    <td className="whitespace-nowrap px-3 py-2 text-right">
                      {r.status === "PENDING" && (
                        <div className="inline-flex gap-1">
                          <Button size="sm" variant="outline" className="h-8 border-emerald-300 text-emerald-800 hover:bg-emerald-50" onClick={() => setApproving(r)}><Check className="size-4" /> Approve</Button>
                          <Button size="sm" variant="outline" className="h-8 text-red-700 hover:bg-red-50" onClick={() => setRejecting(r)}><X className="size-4" /> Reject</Button>
                        </div>
                      )}
                      {r.status === "APPROVED" && (
                        <Button size="sm" className="h-8" onClick={() => setPaying(r)}><Banknote className="size-4" /> Mark paid</Button>
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

      <ConfirmDialog
        open={!!approving}
        onOpenChange={(o) => !o && setApproving(null)}
        title={`Approve refund of ${approving ? bdt(approving.amount) : ""}?`}
        description={approving && <>For {approving.order.orderNumber} ({approving.order.shippingName}) by {methodLabel(approving.method)}. Reason: {approving.reason}. It still has to be paid afterwards.</>}
        confirmLabel="Approve"
        onConfirm={async () => {
          await api(`/refunds/${approving!.id}/approve`, { method: "POST", body: {} });
          toast.success("Refund approved – now pay it from an account");
          refresh();
        }}
      />
      <ConfirmDialog
        open={!!rejecting}
        onOpenChange={(o) => !o && setRejecting(null)}
        title={`Reject refund of ${rejecting ? bdt(rejecting.amount) : ""}?`}
        description={rejecting && <>For {rejecting.order.orderNumber}. The requester will see your note.</>}
        destructive
        requireReason
        reasonLabel="Note (why it is rejected)"
        confirmLabel="Reject refund"
        onConfirm={async (note) => {
          await api(`/refunds/${rejecting!.id}/reject`, { method: "POST", body: { note } });
          toast.success("Refund rejected");
          refresh();
        }}
      />
      <PayRefundDialog refund={paying} onClose={() => setPaying(null)} onPaid={refresh} />
    </div>
  );
}

function PayRefundDialog({ refund, onClose, onPaid }: { refund: Refund | null; onClose: () => void; onPaid: () => void }) {
  const accounts = useAccounts();
  const [accountId, setAccountId] = useState("");
  const [reference, setReference] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const account = accounts.data?.find((a) => a.id === accountId);
  const close = () => { setAccountId(""); setReference(""); setConfirming(false); setErr(null); onClose(); };
  const pay = async () => {
    setBusy(true);
    setErr(null);
    try {
      await api(`/refunds/${refund!.id}/pay`, { method: "POST", body: { accountId, reference: reference.trim() || null } });
      toast.success(`Refund of ${bdt(refund!.amount)} paid from ${account?.name}`);
      onPaid();
      close();
    } catch (e) {
      setErr(errorMessage(e));
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={!!refund} onOpenChange={(o) => !o && close()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Pay refund · {refund ? bdt(refund.amount) : ""}</DialogTitle>
          <DialogDescription>
            {refund?.order.orderNumber} · {refund?.order.shippingName} · {refund && methodLabel(refund.method)}. Send the money first, then record it here.
          </DialogDescription>
        </DialogHeader>
        {!confirming ? (
          <div className="space-y-3">
            <Field label="Paid from account" htmlFor="pay-account" hint={account ? `Balance ${bdt(account.balance)}` : undefined}>
              <NativeSelect id="pay-account" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                <option value="">Choose an account…</option>
                {accounts.data?.filter((a) => a.isActive).map((a) => <option key={a.id} value={a.id}>{a.name} ({bdt(a.balance)})</option>)}
              </NativeSelect>
            </Field>
            <Field label="Reference (optional)" htmlFor="pay-ref" hint="bKash / bank transaction id">
              <Input id="pay-ref" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={100} />
            </Field>
          </div>
        ) : (
          <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            Record {bdt(refund?.amount)} paid from <b>{account?.name}</b>{reference ? ` (ref ${reference})` : ""}? This posts a cash-out to the account and cannot be undone here.
          </p>
        )}
        {err && <p className="text-sm text-red-600">{err}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => (confirming ? setConfirming(false) : close())} disabled={busy}>{confirming ? "Back" : "Cancel"}</Button>
          {!confirming ? (
            <Button disabled={!accountId} onClick={() => setConfirming(true)}>Continue</Button>
          ) : (
            <Button onClick={pay} disabled={busy}>{busy && <Loader2 className="size-4 animate-spin" />} Confirm payment</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
