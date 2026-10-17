"use client";

import Link from "next/link";
import { use, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Check, FileText, Loader2, Paperclip, Plus, Search, Trash2 } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { bdt, dhakaDateTime } from "@/lib/format";
import { ORDER_STATUS, type OrderStatus } from "@/lib/status";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmDialog, ErrorState, Field, LoadingRows, NativeSelect, PageHeader, Pill, Section } from "@/components/admin/ui";
import { fieldErrorsOf, REFUND_TONE, RETURN_FLOW, RETURN_STATUS, useStaffOptions } from "@/components/admin/ops/common";

interface ReturnDetail {
  id: string; returnNumber: string; orderId: string; type: "RETURN" | "EXCHANGE"; status: string; reason: string; customerNote: string | null; isRto: boolean;
  returnShippingCost: string; refundAmount: string; additionalCollection: string; exchangeOrderId: string | null; approvedAt: string | null;
  rejectedReason: string | null; receivedAt: string | null; completedAt: string | null; createdAt: string;
  order: { id: string; orderNumber: string; status: OrderStatus; shippingName: string; shippingPhone: string; total: string; paidAmount: string; refundedAmount: string; paymentMethod: string };
  exchangeOrder: { id: string; orderNumber: string; status: OrderStatus; total: string } | null;
  items: {
    id: string; quantity: number; condition: string; disposition: string; notes: string | null; inspectedAt: string | null;
    orderItem: { id: string; productName: string; variantName: string | null; sku: string; imageUrl: string | null; quantity: number; unitPrice: string; lineTotal: string; variantId: string | null };
  }[];
  attachments: { id: string; url: string; filename: string; mimeType: string; size: number; createdAt: string }[];
  history: { id: string; fromStatus: string | null; toStatus: string; userId: string | null; note: string | null; createdAt: string }[];
  refunds: { id: string; amount: string; method: string; status: string; reason: string; createdAt: string; paidAt: string | null }[];
  financial?: { originalOrderValue: string; returnedItemsValue: string; refunded: string; recoveredInventoryCost: string; lostInventoryCost: string; returnShippingCost: string };
}

interface VariantHit { id: string; sku: string; name: string | null; productName: string; imageUrl: string | null; price: string; available: number }

const REFUND_METHODS = ["BKASH", "NAGAD", "ROCKET", "BANK_TRANSFER", "CASH", "CARD", "SSLCOMMERZ"] as const;
const money = (v: string) => /^\d+(\.\d{1,2})?$/.test(v.trim());

function Stepper({ r }: { r: ReturnDetail }) {
  const reached = new Set(r.history.map((h) => h.toStatus));
  const steps = RETURN_FLOW.filter((s) => s !== "PICKUP_BOOKED" || reached.has("PICKUP_BOOKED"));
  const currentIdx = steps.indexOf(r.status as (typeof steps)[number]);
  const terminal = r.status === "REJECTED" || r.status === "CANCELLED";
  return (
    <ol className="flex flex-wrap items-center gap-y-2 rounded-xl border bg-white p-3 text-xs sm:text-sm" aria-label="Return progress">
      {steps.map((s, i) => {
        const done = !terminal && (i < currentIdx || r.status === "COMPLETED");
        const current = !terminal && i === currentIdx && r.status !== "COMPLETED";
        const skipped = !terminal && i < currentIdx && !reached.has(s);
        return (
          <li key={s} className="flex items-center" aria-current={current ? "step" : undefined}>
            <span className={cn("flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium",
              done ? "bg-emerald-50 text-emerald-700" : current ? "bg-blue-600 text-white" : "text-muted-foreground", skipped && "opacity-60")}>
              {done ? <Check className="size-3.5" /> : <span className="flex size-4 items-center justify-center rounded-full border text-[10px]">{i + 1}</span>}
              {RETURN_STATUS[s].label}
            </span>
            {i < steps.length - 1 && <span className="mx-1 h-px w-4 bg-border sm:w-6" />}
          </li>
        );
      })}
      {terminal && <li className="ml-2"><Pill tone={RETURN_STATUS[r.status].tone}>{RETURN_STATUS[r.status].label}</Pill></li>}
    </ol>
  );
}

function useReturnAction(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ path, body }: { path: string; body?: unknown; success: string }) => api(`/returns/${id}/${path}`, { method: "POST", body: body ?? {} }),
    onSuccess: (_d, v) => {
      toast.success(v.success);
      qc.invalidateQueries({ queryKey: ["return", id] });
      qc.invalidateQueries({ queryKey: ["returns"] });
      qc.invalidateQueries({ queryKey: ["orders"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
}

function NextStep({ r }: { r: ReturnDetail }) {
  const { can } = useAuth();
  const act = useReturnAction(r.id);
  const [note, setNote] = useState("");
  const [cost, setCost] = useState(String(r.returnShippingCost ?? "0"));
  const [rejectOpen, setRejectOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const manage = can("returns.manage");
  const busy = act.isPending;
  const cancelBtn = manage && ["REQUESTED", "APPROVED", "PICKUP_BOOKED"].includes(r.status) && (
    <Button variant="ghost" className="text-red-700" onClick={() => setCancelOpen(true)}>Cancel request</Button>
  );
  let body: ReactNode = null;

  if (r.status === "REQUESTED") {
    body = can("returns.approve") ? (
      <div className="space-y-3">
        <p className="text-sm">Check the reason and evidence, then approve or reject.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Approval note (optional)" htmlFor="ap-note"><Input id="ap-note" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          <Field label="Expected return shipping cost (৳)" htmlFor="ap-cost" hint="Can be corrected when received"><Input id="ap-cost" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} /></Field>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy || !money(cost)} onClick={() => act.mutate({ path: "approve", body: { note: note.trim() || null, returnShippingCost: cost.trim() }, success: "Approved" })}>{busy && <Loader2 className="size-4 animate-spin" />} Approve</Button>
          <Button variant="outline" className="text-red-700" disabled={busy} onClick={() => setRejectOpen(true)}>Reject…</Button>
          {cancelBtn}
        </div>
      </div>
    ) : <p className="text-sm text-muted-foreground">Waiting for a manager to approve or reject. {cancelBtn}</p>;
  } else if (["APPROVED", "PICKUP_BOOKED", "IN_TRANSIT"].includes(r.status)) {
    body = manage ? (
      <div className="space-y-3">
        <p className="text-sm">{r.status === "IN_TRANSIT" ? "The items are on their way back. Receive them at the warehouse when they arrive." : "Arrange the pickup, or record that the customer is sending the items."}</p>
        <Field label="Note (optional)" htmlFor="tr-note"><Input id="tr-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Pickup booked with Steadfast, ref 1234" /></Field>
        <div className="flex flex-wrap items-end gap-2">
          {r.status === "APPROVED" && <Button variant="outline" disabled={busy} onClick={() => act.mutate({ path: "pickup", body: { pickupBooked: true, note: note.trim() || null }, success: "Pickup booked" })}>Pickup booked</Button>}
          {r.status !== "IN_TRANSIT" && <Button variant="outline" disabled={busy} onClick={() => act.mutate({ path: "pickup", body: { pickupBooked: false, note: note.trim() || null }, success: "Marked in transit" })}>Items on the way</Button>}
        </div>
        <div className="flex flex-wrap items-end gap-2 border-t pt-3">
          <Field label="Return shipping cost (৳)" htmlFor="rc-cost"><Input id="rc-cost" className="w-36" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} /></Field>
          <Button disabled={busy || !money(cost)} onClick={() => act.mutate({ path: "receive", body: { returnShippingCost: cost.trim(), note: note.trim() || null }, success: "Received – ready for inspection" })}>{busy && <Loader2 className="size-4 animate-spin" />} Receive at warehouse</Button>
          {cancelBtn}
        </div>
        <p className="text-xs text-muted-foreground">Receiving puts the stock into the “returned” bucket until inspection and books the return shipping cost as an expense.</p>
      </div>
    ) : <p className="text-sm text-muted-foreground">Waiting for the items to come back.</p>;
  } else if (r.status === "RECEIVED") {
    body = manage ? <InspectionForm r={r} /> : <p className="text-sm text-muted-foreground">Waiting for warehouse inspection.</p>;
  } else if (r.status === "INSPECTED") {
    const openRefund = r.refunds.some((f) => f.status === "PENDING" || f.status === "APPROVED");
    const exchangeMissing = r.type === "EXCHANGE" && !r.exchangeOrderId;
    body = (
      <div className="space-y-2 text-sm">
        <p>Inspection is done. {r.type === "RETURN" && !r.isRto ? "Request the refund (if any) below, then close the return." : r.type === "EXCHANGE" ? "Create the replacement order below, then close." : "Close the return to finish."}</p>
        {openRefund && <p className="text-amber-700">A refund is still open — it must be paid or rejected (Finance → Refunds) before closing.</p>}
        {exchangeMissing && <p className="text-amber-700">Create the replacement order before closing.</p>}
        {manage && <Button disabled={busy || openRefund || exchangeMissing} onClick={() => act.mutate({ path: "complete", success: "Return completed" })}>{busy && <Loader2 className="size-4 animate-spin" />} Complete return</Button>}
      </div>
    );
  } else if (r.status === "COMPLETED") {
    body = <p className="text-sm text-emerald-700">Completed {dhakaDateTime(r.completedAt)}.</p>;
  } else if (r.status === "REJECTED") {
    body = <p className="text-sm text-red-700">Rejected: {r.rejectedReason}</p>;
  } else if (r.status === "CANCELLED") {
    body = <p className="text-sm text-muted-foreground">The request was cancelled.</p>;
  }

  return (
    <Section title="Next step" className="border-blue-200">
      {body}
      <ConfirmDialog open={rejectOpen} onOpenChange={setRejectOpen} title={`Reject ${r.returnNumber}?`} description="The customer keeps the items and the order returns to Delivered." destructive requireReason reasonLabel="Reason (shared with the team)" confirmLabel="Reject"
        onConfirm={(reason) => act.mutateAsync({ path: "reject", body: { note: reason }, success: "Rejected" })} />
      <ConfirmDialog open={cancelOpen} onOpenChange={setCancelOpen} title={`Cancel ${r.returnNumber}?`} description="Use this when the customer withdraws the request." destructive requireReason confirmLabel="Cancel request"
        onConfirm={(reason) => act.mutateAsync({ path: "cancel", body: { note: reason }, success: "Request cancelled" })} />
    </Section>
  );
}

function InspectionForm({ r }: { r: ReturnDetail }) {
  const act = useReturnAction(r.id);
  const [d, setD] = useState<Record<string, { condition: string; disposition: string; notes: string }>>(() => Object.fromEntries(r.items.map((i) => [i.id, { condition: "GOOD", disposition: "RESTOCK", notes: "" }])));
  const invalid = Object.values(d).some((x) => x.condition === "MISSING" && x.disposition === "RESTOCK");
  return (
    <div className="space-y-3">
      <p className="text-sm">Inspect each item. Restocked units go back to sellable stock; damaged or disposed units are written off.</p>
      {r.items.map((i) => {
        const v = d[i.id];
        const set = (patch: Partial<typeof v>) => setD({ ...d, [i.id]: { ...v, ...patch } });
        return (
          <div key={i.id} className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[minmax(0,1fr)_140px_160px]">
            <div className="flex items-center gap-2">
              {i.orderItem.imageUrl ? <img src={i.orderItem.imageUrl} alt="" className="size-10 rounded object-cover" /> : <div className="size-10 rounded bg-muted" />}
              <div className="min-w-0 text-sm"><div className="truncate font-medium">{i.quantity} × {i.orderItem.productName}</div><div className="text-xs text-muted-foreground">{i.orderItem.variantName ?? i.orderItem.sku}</div></div>
            </div>
            <NativeSelect aria-label={`Condition of ${i.orderItem.productName}`} value={v.condition} onChange={(e) => set({ condition: e.target.value, ...(e.target.value === "GOOD" ? { disposition: "RESTOCK" } : e.target.value === "MISSING" ? { disposition: "DISPOSE" } : { disposition: "DAMAGED" }) })}>
              <option value="GOOD">Good</option>
              <option value="DAMAGED">Damaged</option>
              <option value="MISSING">Missing</option>
            </NativeSelect>
            <NativeSelect aria-label={`Disposition of ${i.orderItem.productName}`} value={v.disposition} onChange={(e) => set({ disposition: e.target.value })}>
              <option value="RESTOCK" disabled={v.condition === "MISSING"}>Restock (sellable)</option>
              <option value="DAMAGED">Damaged stock</option>
              <option value="DISPOSE">Dispose</option>
            </NativeSelect>
            <Input className="sm:col-span-3" placeholder="Inspection note (optional)" value={v.notes} onChange={(e) => set({ notes: e.target.value })} aria-label={`Note for ${i.orderItem.productName}`} />
          </div>
        );
      })}
      {invalid && <p className="text-xs text-red-600">Missing items cannot be restocked.</p>}
      <Button disabled={act.isPending || invalid} onClick={() => act.mutate({ path: "inspect", body: { items: Object.entries(d).map(([returnItemId, x]) => ({ returnItemId, condition: x.condition, disposition: x.disposition, notes: x.notes.trim() || null })) }, success: "Inspection recorded" })}>
        {act.isPending && <Loader2 className="size-4 animate-spin" />} Save inspection
      </Button>
    </div>
  );
}

function RefundPanel({ r, value }: { r: ReturnDetail; value: number }) {
  const qc = useQueryClient();
  const committed = r.refunds.filter((f) => f.status === "PENDING" || f.status === "APPROVED").reduce((s, f) => s + Number(f.amount), 0);
  const refundable = Math.max(0, Number(r.order.paidAmount) - Number(r.order.refundedAmount) - committed);
  const [amount, setAmount] = useState(() => Math.min(value, refundable).toFixed(2));
  const [method, setMethod] = useState("BKASH");
  const [reason, setReason] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const over = money(amount) && Number(amount) > refundable + 0.001;
  return (
    <Section title="Refund">
      {r.refunds.length > 0 && (
        <ul className="mb-3 space-y-1 text-sm">
          {r.refunds.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 rounded border px-2 py-1.5">
              <span>{bdt(f.amount)} via {f.method.replace("_", " ").toLowerCase()}<span className="block text-xs text-muted-foreground">{dhakaDateTime(f.createdAt)} · {f.reason}</span></span>
              <Pill tone={REFUND_TONE[f.status] ?? "gray"}>{f.status.toLowerCase()}</Pill>
            </li>
          ))}
        </ul>
      )}
      {r.isRto ? <p className="text-sm text-muted-foreground">RTO parcels were never paid for — nothing to refund.</p> : refundable <= 0 ? (
        <p className="text-sm text-muted-foreground">Nothing left to refund (paid {bdt(r.order.paidAmount)}, already refunded or requested {bdt(Number(r.order.refundedAmount) + committed)}).</p>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">Up to {bdt(refundable)} can be refunded. The request goes to Finance for approval and payment.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Amount (৳)" htmlFor="rf-amt" error={errs.amount ?? (over ? `Max ${bdt(refundable)}` : undefined)}><Input id="rf-amt" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
            <Field label="Method" htmlFor="rf-m" error={errs.method}>
              <NativeSelect id="rf-m" value={method} onChange={(e) => setMethod(e.target.value)}>{REFUND_METHODS.map((m) => <option key={m} value={m}>{m.replace("_", " ").toLowerCase()}</option>)}</NativeSelect>
            </Field>
          </div>
          <Field label="Reason (optional)" htmlFor="rf-r" error={errs.reason}><Input id="rf-r" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={`Return ${r.returnNumber}`} /></Field>
          <Button disabled={!money(amount) || Number(amount) <= 0 || over} onClick={() => setConfirm(true)}>Request refund</Button>
        </div>
      )}
      <ConfirmDialog open={confirm} onOpenChange={setConfirm} title={`Request a refund of ${bdt(amount)}?`} description={`Via ${method.replace("_", " ").toLowerCase()}. Finance must approve and pay it before the return can be closed.`} confirmLabel="Request refund"
        onConfirm={async () => {
          try {
            await api(`/returns/${r.id}/refund`, { method: "POST", body: { amount: amount.trim(), method, ...(reason.trim().length >= 3 ? { reason: reason.trim() } : {}) } });
            setErrs({});
            toast.success("Refund requested");
            qc.invalidateQueries({ queryKey: ["return", r.id] });
          } catch (e) {
            setErrs(fieldErrorsOf(e));
            throw e;
          }
        }} />
    </Section>
  );
}

function ExchangePanel({ r }: { r: ReturnDetail }) {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [term, setTerm] = useState("");
  const [lines, setLines] = useState<{ v: VariantHit; quantity: number }[]>([]);
  const [delivery, setDelivery] = useState("");
  const [note, setNote] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [result, setResult] = useState<{ credit: string; newItemsValue: string; customerOwes: string; refundDue: string } | null>(null);
  const hits = useQuery({ queryKey: ["variants", "search", term], queryFn: () => api<VariantHit[]>("/products/variants/search", { query: { q: term, limit: 10 } }), enabled: term.length >= 2 });
  if (r.exchangeOrder) {
    return (
      <Section title="Replacement order">
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <Link href={`/admin/orders/${r.exchangeOrder.id}`} className="font-medium text-blue-700 hover:underline">{r.exchangeOrder.orderNumber}</Link>
          <Pill tone={ORDER_STATUS[r.exchangeOrder.status]?.tone ?? "gray"}>{ORDER_STATUS[r.exchangeOrder.status]?.en ?? r.exchangeOrder.status}</Pill>
        </div>
        <dl className="mt-2 space-y-1 text-sm">
          <div className="flex justify-between"><dt className="text-muted-foreground">Replacement total (COD)</dt><dd>{bdt(r.exchangeOrder.total)}</dd></div>
          {Number(r.refundAmount) > 0 && <div className="flex justify-between"><dt className="text-muted-foreground">Credit left to refund</dt><dd>{bdt(r.refundAmount)}</dd></div>}
        </dl>
        {result && <p className="mt-2 text-xs text-muted-foreground">Credit {bdt(result.credit)} applied against new items worth {bdt(result.newItemsValue)}.</p>}
      </Section>
    );
  }
  const newValue = lines.reduce((s, l) => s + Number(l.v.price) * l.quantity, 0);
  return (
    <Section title="Replacement order">
      <p className="mb-3 text-xs text-muted-foreground">The value of the returned items is credited as a discount on the replacement; any difference is collected as COD or left as a refund.</p>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); setTerm(q.trim()); }}>
        <div className="relative flex-1"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-9" placeholder="Search product, SKU or barcode" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search replacement product" /></div>
        <Button type="submit" variant="outline" disabled={q.trim().length < 2}>Search</Button>
      </form>
      {hits.isFetching && <Loader2 className="mx-auto mt-2 size-4 animate-spin" />}
      {hits.data && term && (
        <ul className="mt-2 max-h-56 divide-y overflow-y-auto rounded-lg border">
          {hits.data.length === 0 && <li className="p-2 text-sm text-muted-foreground">No matches.</li>}
          {hits.data.map((v) => (
            <li key={v.id} className="flex items-center gap-2 p-2 text-sm">
              {v.imageUrl ? <img src={v.imageUrl} alt="" className="size-8 rounded object-cover" /> : <div className="size-8 rounded bg-muted" />}
              <div className="min-w-0 flex-1"><div className="truncate">{v.productName}{v.name ? ` · ${v.name}` : ""}</div><div className="text-xs text-muted-foreground">{v.sku} · {bdt(v.price)} · {v.available} in stock</div></div>
              <Button size="sm" variant="outline" onClick={() => setLines((ls) => ls.some((l) => l.v.id === v.id) ? ls : [...ls, { v, quantity: 1 }])}><Plus className="size-4" /> Add</Button>
            </li>
          ))}
        </ul>
      )}
      {lines.length > 0 && (
        <ul className="mt-3 space-y-2">
          {lines.map((l, i) => (
            <li key={l.v.id} className="flex items-center gap-2 text-sm">
              <span className="min-w-0 flex-1 truncate">{l.v.productName}{l.v.name ? ` · ${l.v.name}` : ""}</span>
              <Input type="number" min={1} max={99} className="h-8 w-16" value={l.quantity} aria-label={`Quantity of ${l.v.productName}`} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, quantity: Math.max(1, Math.min(99, Math.floor(Number(e.target.value) || 1))) } : x)))} />
              <span className="w-20 text-right tabular-nums">{bdt(Number(l.v.price) * l.quantity)}</span>
              <Button size="icon" variant="ghost" className="size-8" aria-label={`Remove ${l.v.productName}`} onClick={() => setLines(lines.filter((_, j) => j !== i))}><Trash2 className="size-4" /></Button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field label="Delivery charge (৳)" htmlFor="ex-del" hint="Empty = calculated from the zone"><Input id="ex-del" inputMode="decimal" value={delivery} onChange={(e) => setDelivery(e.target.value)} /></Field>
        <Field label="Note (optional)" htmlFor="ex-note"><Input id="ex-note" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </div>
      <div className="mt-3 flex items-center justify-between text-sm"><span className="text-muted-foreground">New items value</span><span className="font-medium">{bdt(newValue)}</span></div>
      <Button className="mt-3" disabled={!lines.length || (!!delivery && !money(delivery))} onClick={() => setConfirm(true)}>Create replacement order</Button>
      <ConfirmDialog open={confirm} onOpenChange={setConfirm} title="Create the replacement order?" description="A new COD order is created for the customer's address with the returned value credited. Stock is reserved for it." confirmLabel="Create order"
        onConfirm={async () => {
          const res = await api<{ exchangeOrder: { orderNumber: string }; credit: string; newItemsValue: string; customerOwes: string; refundDue: string }>(`/returns/${r.id}/exchange-order`, {
            method: "POST", body: { items: lines.map((l) => ({ variantId: l.v.id, quantity: l.quantity })), ...(delivery.trim() ? { deliveryCharge: delivery.trim() } : {}), note: note.trim() || null },
          });
          setResult(res);
          toast.success(`Replacement ${res.exchangeOrder.orderNumber} created · customer pays ${bdt(res.customerOwes)}`);
          qc.invalidateQueries({ queryKey: ["return", r.id] });
          qc.invalidateQueries({ queryKey: ["orders"] });
        }} />
    </Section>
  );
}

function Attachments({ r }: { r: ReturnDetail }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Section title="Evidence" actions={can("returns.manage") && (
      <>
        <input ref={ref} type="file" accept="image/*,application/pdf" className="hidden" onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          if (f.size > 5 * 1024 * 1024) { toast.error("File is larger than 5 MB"); return; }
          setBusy(true);
          try {
            const form = new FormData();
            form.append("file", f);
            await api(`/returns/${r.id}/attachments`, { method: "POST", body: form });
            toast.success("Attachment added");
            qc.invalidateQueries({ queryKey: ["return", r.id] });
          } catch (err) {
            toast.error(errorMessage(err));
          } finally {
            setBusy(false);
          }
        }} />
        <Button size="sm" variant="outline" disabled={busy} onClick={() => ref.current?.click()}>{busy ? <Loader2 className="size-4 animate-spin" /> : <Paperclip className="size-4" />} Upload</Button>
      </>
    )}>
      {r.attachments.length === 0 ? <p className="text-sm text-muted-foreground">No photos or documents yet. Add photos of the parcel and any damage (image or PDF, max 5 MB).</p> : (
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {r.attachments.map((a) => (
            <li key={a.id}>
              <a href={a.url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg border hover:ring-2 hover:ring-blue-300" title={a.filename}>
                {a.mimeType.startsWith("image/") ? <img src={a.url} alt={a.filename} className="aspect-square w-full object-cover" /> : (
                  <div className="flex aspect-square flex-col items-center justify-center gap-1 bg-slate-50 p-2 text-center text-xs text-muted-foreground"><FileText className="size-6" /><span className="line-clamp-2 break-all">{a.filename}</span></div>
                )}
              </a>
              <div className="mt-0.5 text-[11px] text-muted-foreground">{dhakaDateTime(a.createdAt)}</div>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

export default function ReturnDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { can } = useAuth();
  const q = useQuery({ queryKey: ["return", id], queryFn: () => api<ReturnDetail>(`/returns/${id}`) });
  const staff = useStaffOptions(can("orders.view"));
  if (q.isLoading) return <LoadingRows rows={8} />;
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const r = q.data;
  const value = r.items.reduce((s, i) => s + (Number(i.orderItem.lineTotal) * i.quantity) / i.orderItem.quantity, 0);
  const who = (uid: string | null) => (uid ? staff.data?.find((u) => u.id === uid)?.name ?? "Staff" : "System");
  const afterApproval = !["REQUESTED", "REJECTED", "CANCELLED"].includes(r.status);
  const showRefund = r.type === "RETURN" && (afterApproval || r.refunds.length > 0) && can("returns.manage");
  const showExchange = r.type === "EXCHANGE" && (afterApproval || r.exchangeOrder) && can("returns.manage", "orders.create");

  return (
    <div className="space-y-4">
      <Link href="/admin/returns" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> Returns</Link>
      <PageHeader title={`${r.type === "EXCHANGE" ? "Exchange" : "Return"} ${r.returnNumber}`} description={<>Order <Link href={`/admin/orders/${r.order.id}`} className="text-blue-700 hover:underline">{r.order.orderNumber}</Link> · {r.order.shippingName} · {r.order.shippingPhone} · opened {dhakaDateTime(r.createdAt)}</>}>
        <div className="mt-2 flex flex-wrap gap-2">
          <Pill tone={RETURN_STATUS[r.status]?.tone ?? "gray"}>{RETURN_STATUS[r.status]?.label ?? r.status}</Pill>
          {r.isRto && <Pill tone="rose">RTO · undelivered parcel</Pill>}
          <Pill tone={ORDER_STATUS[r.order.status]?.tone ?? "gray"}>Order: {ORDER_STATUS[r.order.status]?.en ?? r.order.status}</Pill>
        </div>
      </PageHeader>
      <Stepper r={r} />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-4">
          <NextStep key={r.status} r={r} />
          <Section title="Items">
            <div className="divide-y">
              {r.items.map((i) => (
                <div key={i.id} className="flex flex-wrap items-center gap-3 py-2">
                  {i.orderItem.imageUrl ? <img src={i.orderItem.imageUrl} alt="" className="size-12 rounded object-cover" /> : <div className="size-12 rounded bg-muted" />}
                  <div className="min-w-40 flex-1">
                    <div className="font-medium">{i.orderItem.productName}</div>
                    <div className="text-xs text-muted-foreground">{[i.orderItem.variantName, i.orderItem.sku].filter(Boolean).join(" · ")}</div>
                    {i.notes && <div className="text-xs">“{i.notes}”</div>}
                  </div>
                  <div className="text-right text-sm">
                    <div>{i.quantity} of {i.orderItem.quantity} × {bdt(i.orderItem.unitPrice)}</div>
                    {i.inspectedAt ? (
                      <div className="mt-0.5 flex justify-end gap-1">
                        <Pill tone={i.condition === "GOOD" ? "green" : i.condition === "MISSING" ? "red" : "orange"}>{i.condition.toLowerCase()}</Pill>
                        <Pill tone={i.disposition === "RESTOCK" ? "emerald" : "gray"}>{i.disposition.toLowerCase()}</Pill>
                      </div>
                    ) : <div className="text-xs text-muted-foreground">not inspected</div>}
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-2 grid gap-2 border-t pt-3 text-sm sm:grid-cols-2">
              <div><span className="text-muted-foreground">Reason: </span>{r.reason}</div>
              {r.customerNote && <div><span className="text-muted-foreground">Customer note: </span>{r.customerNote}</div>}
            </div>
          </Section>
          {showRefund && <RefundPanel key={`${r.refunds.length}`} r={r} value={value} />}
          {showExchange && <ExchangePanel r={r} />}
          <Attachments r={r} />
        </div>

        <div className="space-y-4">
          {r.financial && (
            <Section title="Financial summary">
              <dl className="space-y-1.5 text-sm">
                <div className="flex justify-between"><dt className="text-muted-foreground">Original order value</dt><dd className="tabular-nums">{bdt(r.financial.originalOrderValue)}</dd></div>
                <div className="flex justify-between"><dt className="text-muted-foreground">Returned items value</dt><dd className="tabular-nums">{bdt(r.financial.returnedItemsValue)}</dd></div>
                <div className="flex justify-between"><dt className="text-muted-foreground">Paid by customer</dt><dd className="tabular-nums">{bdt(r.order.paidAmount)}</dd></div>
                <div className="flex justify-between"><dt className="text-muted-foreground">Refunded (paid out)</dt><dd className="tabular-nums">{bdt(r.financial.refunded)}</dd></div>
                <div className="flex justify-between"><dt className="text-muted-foreground">Return shipping cost</dt><dd className="tabular-nums text-red-700">−{bdt(r.financial.returnShippingCost)}</dd></div>
                <div className="flex justify-between"><dt className="text-muted-foreground">Inventory cost recovered</dt><dd className="tabular-nums text-emerald-700">{bdt(r.financial.recoveredInventoryCost)}</dd></div>
                <div className="flex justify-between"><dt className="text-muted-foreground">Inventory cost lost</dt><dd className="tabular-nums text-red-700">−{bdt(r.financial.lostInventoryCost)}</dd></div>
                {r.type === "EXCHANGE" && <div className="flex justify-between"><dt className="text-muted-foreground">To collect on replacement</dt><dd className="tabular-nums">{bdt(r.additionalCollection)}</dd></div>}
              </dl>
            </Section>
          )}
          <Section title="History">
            <ol className="relative space-y-4 border-l pl-5">
              {r.history.map((h) => (
                <li key={h.id} className="relative">
                  <span className="absolute -left-[26px] top-1 size-2.5 rounded-full bg-primary" />
                  <div className="flex flex-wrap items-center gap-2">
                    <Pill tone={RETURN_STATUS[h.toStatus]?.tone ?? "gray"}>{RETURN_STATUS[h.toStatus]?.label ?? h.toStatus}</Pill>
                    <span className="text-xs text-muted-foreground">{dhakaDateTime(h.createdAt)}</span>
                  </div>
                  <p className="mt-0.5 text-sm text-muted-foreground">{who(h.userId)}{h.note ? ` — ${h.note}` : ""}</p>
                </li>
              ))}
            </ol>
          </Section>
        </div>
      </div>
    </div>
  );
}
