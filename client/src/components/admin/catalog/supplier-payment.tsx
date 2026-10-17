"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { api, errorMessage, newIdempotencyKey } from "@/lib/api";
import { bdt, dhakaToday, titleCase } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, NativeSelect } from "@/components/admin/ui";
import { useAccounts } from "./shared";

export const PAY_METHODS = ["CASH", "BANK_TRANSFER", "BKASH", "NAGAD", "ROCKET", "CHEQUE", "CARD", "OTHER"] as const;

/** Records a payment to a supplier (optionally against one PO). Uses an Idempotency-Key and a confirmation step. */
export function SupplierPaymentForm({ supplierId, purchaseOrderId, maxAmount, onDone, poOptions }: { supplierId: string; purchaseOrderId?: string; maxAmount?: string; onDone: () => void; poOptions?: { id: string; number: string; openBalance: string }[] }) {
  const accounts = useAccounts();
  const [idem, setIdem] = useState(newIdempotencyKey);
  const [v, setV] = useState({ amount: "", method: "BANK_TRANSFER", accountId: "", paidAt: dhakaToday(), reference: "", note: "", poId: purchaseOrderId ?? "" });
  const [confirming, setConfirming] = useState(false);
  const limit = purchaseOrderId ? maxAmount : poOptions?.find((p) => p.id === v.poId)?.openBalance;
  let err: string | undefined;
  if (v.amount && (!/^\d+(\.\d{1,2})?$/.test(v.amount) || Number(v.amount) <= 0)) err = "Enter a positive amount";
  else if (limit && Number(v.amount) > Number(limit)) err = `Cannot exceed open balance ${bdt(limit)}`;
  const ok = !!v.amount && !err && !!v.accountId && !!v.paidAt;
  const pay = useMutation({
    mutationFn: () =>
      api(`/suppliers/${supplierId}/payments`, {
        method: "POST", idempotencyKey: idem,
        body: { amount: v.amount, method: v.method, accountId: v.accountId, purchaseOrderId: v.poId || null, paidAt: v.paidAt, reference: v.reference.trim() || null, note: v.note.trim() || null },
      }),
    onSuccess: () => {
      toast.success("Payment recorded");
      setV((x) => ({ ...x, amount: "", reference: "", note: "" }));
      setIdem(newIdempotencyKey());
      setConfirming(false);
      onDone();
    },
    onError: (e) => { toast.error(errorMessage(e)); setConfirming(false); },
  });
  return (
    <form className="space-y-2 rounded-md border bg-muted/30 p-3" onSubmit={(e) => { e.preventDefault(); if (ok) setConfirming(true); }}>
      <p className="text-sm font-medium">Record a payment</p>
      {poOptions && (
        <Field label="Against purchase order" htmlFor="sp-po">
          <NativeSelect id="sp-po" value={v.poId} onChange={(e) => setV({ ...v, poId: e.target.value })}>
            <option value="">General / advance (no PO)</option>
            {poOptions.map((p) => <option key={p.id} value={p.id}>{p.number} — open {bdt(p.openBalance)}</option>)}
          </NativeSelect>
        </Field>
      )}
      <div className="grid grid-cols-2 gap-2">
        <Field label="Amount (৳)" htmlFor="sp-amt" error={err}><Input id="sp-amt" inputMode="decimal" value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value })} placeholder={limit ? String(Number(limit)) : ""} /></Field>
        <Field label="Date" htmlFor="sp-date"><Input id="sp-date" type="date" value={v.paidAt} onChange={(e) => setV({ ...v, paidAt: e.target.value })} /></Field>
        <Field label="Method" htmlFor="sp-method">
          <NativeSelect id="sp-method" value={v.method} onChange={(e) => setV({ ...v, method: e.target.value })}>
            {PAY_METHODS.map((m) => <option key={m} value={m}>{titleCase(m)}</option>)}
          </NativeSelect>
        </Field>
        <Field label="Paid from" htmlFor="sp-acc" error={accounts.isError ? errorMessage(accounts.error) : undefined}>
          <NativeSelect id="sp-acc" value={v.accountId} onChange={(e) => setV({ ...v, accountId: e.target.value })}>
            <option value="">Choose account…</option>
            {accounts.data?.filter((a) => a.isActive).map((a) => <option key={a.id} value={a.id}>{a.name} ({bdt(a.balance)})</option>)}
          </NativeSelect>
        </Field>
      </div>
      <Field label="Reference" htmlFor="sp-ref"><Input id="sp-ref" value={v.reference} onChange={(e) => setV({ ...v, reference: e.target.value })} placeholder="Transaction ID / cheque no." /></Field>
      <Field label="Note" htmlFor="sp-note"><Input id="sp-note" value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} /></Field>
      {confirming ? (
        <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-sm">
          <p>Pay <strong>{bdt(v.amount)}</strong> from {accounts.data?.find((a) => a.id === v.accountId)?.name}? This posts a cash-out entry to the ledger.</p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setConfirming(false)}>Back</Button>
            <Button type="button" size="sm" disabled={pay.isPending} onClick={() => pay.mutate()}>{pay.isPending && <Loader2 className="size-4 animate-spin" />} Confirm payment</Button>
          </div>
        </div>
      ) : (
        <div className="flex justify-end"><Button type="submit" size="sm" disabled={!ok}>Record payment</Button></div>
      )}
    </form>
  );
}
