"use client";

import Link from "next/link";
import { Suspense, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Loader2, Search } from "lucide-react";
import { api, errorMessage, request } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { bdt, dhakaDateTime } from "@/lib/format";
import { ORDER_STATUS } from "@/lib/status";
import type { OrderDetail, OrderListItem } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { EmptyState, ErrorState, Field, LoadingRows, PageHeader, Pill, Section } from "@/components/admin/ui";
import { fieldErrorsOf, Forbidden } from "@/components/admin/ops/common";

interface ReturnLite { id: string; status: string; order: { id: string }; items: { orderItemId: string; quantity: number }[] }

function OrderPicker() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [term, setTerm] = useState("");
  const res = useQuery({ queryKey: ["orders", "return-pick", term], queryFn: () => request<OrderListItem[]>("/orders", { query: { q: term, pageSize: 10 } }), enabled: term.length >= 3 });
  return (
    <Section title="Find the delivered order">
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); setTerm(q.trim()); }}>
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Order number or customer phone" aria-label="Order number or phone" />
        </div>
        <Button type="submit" disabled={q.trim().length < 3}>Search</Button>
      </form>
      {res.isFetching && <Loader2 className="mx-auto mt-3 size-5 animate-spin" />}
      {res.data && (
        res.data.data.length === 0 ? <p className="mt-3 text-sm text-muted-foreground">No orders found.</p> : (
          <ul className="mt-3 divide-y rounded-lg border">
            {res.data.data.map((o) => {
              const ok = o.status === "DELIVERED";
              return (
                <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                  <div>
                    <span className="font-medium">{o.orderNumber}</span> · {o.customer.name} · {o.customer.phone}
                    <div className="text-xs text-muted-foreground">{dhakaDateTime(o.createdAt)} · {bdt(o.amounts.total)}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Pill tone={ORDER_STATUS[o.status].tone}>{ORDER_STATUS[o.status].en}</Pill>
                    <Button size="sm" disabled={!ok} title={ok ? undefined : "Only delivered orders can be returned"} onClick={() => router.replace(`/admin/returns/new?orderId=${o.id}`)}>Select</Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )
      )}
    </Section>
  );
}

function ReturnForm({ order }: { order: OrderDetail }) {
  const router = useRouter();
  const qc = useQueryClient();
  const existing = useQuery({ queryKey: ["returns", "for-order", order.orderNumber], queryFn: () => request<ReturnLite[]>("/returns", { query: { q: order.orderNumber, pageSize: 100 } }) });
  const already = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of existing.data?.data ?? []) {
      if (r.order.id !== order.id || ["REJECTED", "CANCELLED"].includes(r.status)) continue;
      for (const i of r.items) m[i.orderItemId] = (m[i.orderItemId] ?? 0) + i.quantity;
    }
    return m;
  }, [existing.data, order.id]);
  const [type, setType] = useState<"RETURN" | "EXCHANGE">("RETURN");
  const [qty, setQty] = useState<Record<string, number>>({});
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [errs, setErrs] = useState<Record<string, string>>({});
  const items = Object.entries(qty).filter(([, n]) => n > 0).map(([orderItemId, quantity]) => ({ orderItemId, quantity }));
  const m = useMutation({
    mutationFn: () => api<{ id: string; returnNumber: string }>("/returns", { method: "POST", body: { orderId: order.id, type, reason: reason.trim(), customerNote: note.trim() || null, items } }),
    onSuccess: (r) => {
      toast.success(`${type === "RETURN" ? "Return" : "Exchange"} ${r.returnNumber} opened`);
      qc.invalidateQueries({ queryKey: ["returns"] });
      qc.invalidateQueries({ queryKey: ["order", order.id] });
      router.push(`/admin/returns/${r.id}`);
    },
    onError: (e) => { setErrs(fieldErrorsOf(e)); toast.error(errorMessage(e)); },
  });

  if (order.status !== "DELIVERED") {
    return <EmptyState title={`${order.orderNumber} is ${ORDER_STATUS[order.status].en.toLowerCase()}`} description="Only delivered orders can be returned or exchanged. Undelivered parcels come back as RTO automatically." action={<Button variant="outline" asChild><Link href={`/admin/orders/${order.id}`}>Open order</Link></Button>} />;
  }
  const selectedValue = items.reduce((s, it) => {
    const line = order.items.find((i) => i.id === it.orderItemId)!;
    return s + (Number(line.lineTotal) * it.quantity) / line.quantity;
  }, 0);

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="space-y-4">
        <Section title="Type">
          <RadioGroup value={type} onValueChange={(v) => setType(v as "RETURN" | "EXCHANGE")} className="grid gap-2 sm:grid-cols-2">
            {([["RETURN", "Return", "Goods come back; refund what the customer paid (needs approval)."], ["EXCHANGE", "Exchange", "Goods come back and a replacement order is sent; returned value is credited."]] as const).map(([v, label, desc]) => (
              <label key={v} className={cn("flex cursor-pointer gap-3 rounded-lg border p-3", type === v && "border-blue-600 bg-blue-50")}>
                <RadioGroupItem value={v} className="mt-0.5" />
                <span><span className="font-medium">{label}</span><span className="block text-xs text-muted-foreground">{desc}</span></span>
              </label>
            ))}
          </RadioGroup>
        </Section>
        <Section title="Items coming back">
          {existing.isLoading ? <LoadingRows rows={2} /> : (
            <div className="divide-y">
              {order.items.map((i) => {
                const remaining = i.quantity - (already[i.id] ?? 0);
                const v = qty[i.id] ?? 0;
                return (
                  <div key={i.id} className="flex flex-wrap items-center gap-3 py-2">
                    {i.imageUrl ? <img src={i.imageUrl} alt="" className="size-12 rounded object-cover" /> : <div className="size-12 rounded bg-muted" />}
                    <div className="min-w-40 flex-1">
                      <div className="font-medium">{i.productName}</div>
                      <div className="text-xs text-muted-foreground">{[i.variantName, i.sku].filter(Boolean).join(" · ")} · {i.quantity} × {bdt(i.unitPrice)}</div>
                      {already[i.id] ? <div className="text-xs text-amber-700">{already[i.id]} already in another return</div> : null}
                    </div>
                    {remaining <= 0 ? <span className="text-xs text-muted-foreground">nothing left to return</span> : (
                      <label className="flex items-center gap-2 text-sm">
                        Qty
                        <Input type="number" min={0} max={remaining} className="h-9 w-20" value={v} aria-label={`Quantity of ${i.productName}`}
                          onChange={(e) => setQty({ ...qty, [i.id]: Math.max(0, Math.min(remaining, Math.floor(Number(e.target.value) || 0))) })} />
                        <span className="text-xs text-muted-foreground">of {remaining}</span>
                      </label>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {errs.items && <p className="text-xs text-red-600">{errs.items}</p>}
        </Section>
        <Section title="Details">
          <div className="space-y-3">
            <Field label="Reason (required)" htmlFor="reason" error={errs.reason} hint="e.g. Wrong colour received, size too small, embroidery defect">
              <Textarea id="reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
            </Field>
            <Field label="Customer note (optional)" htmlFor="note" error={errs.customerNote}>
              <Textarea id="note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} />
            </Field>
          </div>
        </Section>
      </div>
      <div className="space-y-3 xl:sticky xl:top-20 xl:self-start">
        <Section title="Summary">
          <dl className="space-y-1 text-sm">
            <div className="flex justify-between"><dt className="text-muted-foreground">Order</dt><dd>{order.orderNumber}</dd></div>
            <div className="flex justify-between"><dt className="text-muted-foreground">Customer</dt><dd>{order.customer.name}</dd></div>
            <div className="flex justify-between"><dt className="text-muted-foreground">Paid</dt><dd>{bdt(order.amounts.paid)}</dd></div>
            <div className="flex justify-between"><dt className="text-muted-foreground">Units selected</dt><dd>{items.reduce((n, i) => n + i.quantity, 0)}</dd></div>
            <div className="flex justify-between font-medium"><dt>Value of selected items</dt><dd>{bdt(selectedValue.toFixed(2))}</dd></div>
          </dl>
          <Button className="mt-4 w-full" disabled={!items.length || reason.trim().length < 3 || m.isPending} onClick={() => m.mutate()}>
            {m.isPending && <Loader2 className="size-4 animate-spin" />} Open {type === "RETURN" ? "return" : "exchange"}
          </Button>
          <p className="mt-2 text-xs text-muted-foreground">The order moves to “{type === "RETURN" ? "Return requested" : "Exchange requested"}”. Nothing is refunded until the return is approved and received.</p>
        </Section>
      </div>
    </div>
  );
}

function NewReturn() {
  const { can } = useAuth();
  const params = useSearchParams();
  const orderId = params.get("orderId");
  const order = useQuery({ queryKey: ["order", orderId], queryFn: () => api<OrderDetail>(`/orders/${orderId}`), enabled: !!orderId });
  if (!can("returns.manage")) return <Forbidden what="opening returns" />;
  return (
    <div className="space-y-4">
      <Link href={orderId ? `/admin/orders/${orderId}` : "/admin/returns"} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> {orderId ? "Back to order" : "Returns"}
      </Link>
      <PageHeader title="Open a return or exchange" description={order.data ? `For order ${order.data.orderNumber} · delivered ${dhakaDateTime(order.data.timestamps.deliveredAt)}` : "For a delivered order"} />
      {!orderId ? <OrderPicker /> : order.isLoading ? <LoadingRows rows={5} /> : order.isError || !order.data ? <ErrorState error={order.error} onRetry={() => order.refetch()} /> : <ReturnForm order={order.data} />}
    </div>
  );
}

export default function NewReturnPage() {
  return <Suspense><NewReturn /></Suspense>;
}
