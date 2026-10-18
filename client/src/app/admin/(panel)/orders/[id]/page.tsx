"use client";

import Link from "next/link";
import { use, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, ArrowLeft, Copy, MessageCircle, Pencil, Phone, Printer, RefreshCw, Truck, XCircle } from "lucide-react";
import { api, errorMessage, newIdempotencyKey } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { bdt, dhakaDateTime, telHref, whatsappHref } from "@/lib/format";
import { ORDER_STATUS, PAYMENT_TONE, SHIPMENT_TONE } from "@/lib/status";
import type { OrderDetail, ProfitLine } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDialog, ErrorState, LoadingRows, NativeSelect, PageHeader, Pill, Section } from "@/components/admin/ui";
import { BookCourierDialog, StatusDialog } from "@/components/admin/orders/order-dialogs";

function ProfitRow({ label, line, negative }: { label: string; line?: ProfitLine; negative?: boolean }) {
  if (!line) return null;
  return (
    <div className="flex justify-between text-sm">
      <span className="text-muted-foreground">
        {label}
        {line.estimated && <span className="ml-1 text-xs text-amber-600">(est.)</span>}
      </span>
      <span className="tabular-nums">{negative && Number(line.amount) ? "−" : ""}{bdt(line.amount)}</span>
    </div>
  );
}

export default function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { can } = useAuth();
  const router = useRouter();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["order", id], queryFn: () => api<OrderDetail>(`/orders/${id}`) });
  const [statusOpen, setStatusOpen] = useState(false);
  const [bookOpen, setBookOpen] = useState(false);
  const [cancelShipment, setCancelShipment] = useState<string | null>(null);
  const [duplicateOpen, setDuplicateOpen] = useState(false);
  const [note, setNote] = useState("");
  const [comm, setComm] = useState({ channel: "CALL", summary: "", outcome: "" });
  const [pay, setPay] = useState({ method: "BKASH", amount: "", transactionId: "", senderNumber: "" });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["order", id] });
    qc.invalidateQueries({ queryKey: ["orders"] });
  };

  const addNote = useMutation({
    mutationFn: () => api(`/orders/${id}/notes`, { method: "POST", body: { body: note } }),
    onSuccess: () => { setNote(""); refresh(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const addComm = useMutation({
    mutationFn: () => api(`/orders/${id}/communications`, { method: "POST", body: { channel: comm.channel, summary: comm.summary, outcome: comm.outcome || undefined } }),
    onSuccess: () => { setComm({ channel: "CALL", summary: "", outcome: "" }); refresh(); toast.success("Logged"); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const recordPayment = useMutation({
    mutationFn: () => api("/payments", { method: "POST", idempotencyKey: newIdempotencyKey(), body: { orderId: id, method: pay.method, amount: pay.amount, transactionId: pay.transactionId || null, senderNumber: pay.senderNumber || null } }),
    onSuccess: () => { setPay({ method: "BKASH", amount: "", transactionId: "", senderNumber: "" }); refresh(); toast.success("Payment recorded – awaiting verification"); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const verifyPayment = useMutation({
    mutationFn: (paymentId: string) => api(`/payments/${paymentId}/verify`, { method: "POST", body: {} }),
    onSuccess: () => { refresh(); toast.success("Payment verified"); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const retryMeta = useMutation({
    mutationFn: (logId: string) => api<{ status: string; reason?: string }>(`/marketing/meta/events/${logId}/retry`, { method: "POST" }),
    onSuccess: (r) => {
      refresh();
      if (r.status === "SENT") toast.success("Sent to Meta");
      else toast.error(r.reason ?? `Status: ${r.status}`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const sync = useMutation({
    mutationFn: (shipmentId: string) => api<{ applied: boolean; status: string }>(`/couriers/shipments/${shipmentId}/sync`, { method: "POST" }),
    onSuccess: (r) => { refresh(); toast.success(`Courier status: ${r.status.toLowerCase()}`); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (q.isLoading) return <LoadingRows rows={8} />;
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const o = q.data;
  const status = ORDER_STATUS[o.status];
  const editable = ["PENDING", "CONFIRMATION_REQUIRED", "CONFIRMED", "PROCESSING", "READY_TO_SHIP", "ON_HOLD"].includes(o.status);
  const activeShipment = o.shipments.find((s) => !s.isReturn && !["CANCELLED", "FAILED"].includes(s.status));
  const address = [o.shipping.address, o.shipping.area, o.shipping.district].filter(Boolean).join(", ");

  return (
    <div className="space-y-4">
      <Link href="/admin/orders" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Orders
      </Link>
      <PageHeader
        title={`Order ${o.orderNumber}`}
        description={`Placed ${dhakaDateTime(o.createdAt)} via ${o.channel.toLowerCase()}${o.createdBy ? ` by ${o.createdBy.name}` : ""}${o.sourceOrder ? ` · from ${o.sourceOrder.orderNumber}` : ""}`}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => setStatusOpen(true)}>Change status</Button>
            {can("orders.edit") && editable && (
              <Button variant="outline" size="sm" asChild><Link href={`/admin/orders/${o.id}/edit`}><Pencil className="size-4" /> Edit</Link></Button>
            )}
            {can("shipments.book") && !activeShipment && ["CONFIRMED", "PROCESSING", "READY_TO_SHIP"].includes(o.status) && (
              <Button size="sm" onClick={() => setBookOpen(true)}><Truck className="size-4" /> Book courier</Button>
            )}
            <Button variant="outline" size="sm" onClick={() => window.open(`/admin/orders/print?type=invoice&ids=${o.id}`, "_blank")}><Printer className="size-4" /> Invoice</Button>
            <Button variant="outline" size="sm" onClick={() => window.open(`/admin/orders/print?type=label&ids=${o.id}`, "_blank")}><Printer className="size-4" /> Label</Button>
            {can("orders.create") && <Button variant="ghost" size="sm" onClick={() => setDuplicateOpen(true)}><Copy className="size-4" /> Duplicate</Button>}
            {can("returns.manage") && o.status === "DELIVERED" && (
              <Button variant="outline" size="sm" asChild><Link href={`/admin/returns/new?orderId=${o.id}`}>Return / exchange</Link></Button>
            )}
          </>
        }
      >
        <div className="mt-2 flex flex-wrap gap-2">
          <Pill tone={status.tone}>{status.en} · {status.bn}</Pill>
          <Pill tone={PAYMENT_TONE[o.paymentStatus] ?? "gray"}>{o.paymentStatus.replace("_", " ").toLowerCase()}</Pill>
          {o.isPreorder && <Pill tone="violet">Pre-order</Pill>}
          {o.profit && <Pill tone={o.profit.status === "RECONCILED" ? "green" : "amber"}>{o.profit.status === "RECONCILED" ? "Finance reconciled" : "Finance estimated"}</Pill>}
        </div>
      </PageHeader>

      {o.risk.flags.length > 0 && (
        <div className="flex gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <AlertTriangle className="size-5 shrink-0" />
          <div>
            <p className="font-semibold">Risk indicators (score {o.risk.score}) — please call to confirm. এই অর্ডারটি নিশ্চিত করতে গ্রাহককে ফোন করুন।</p>
            <ul className="list-disc pl-5">{o.risk.flags.map((f) => <li key={f.code}>{f.en} — {f.bn}</li>)}</ul>
          </div>
        </div>
      )}
      {o.cancelReason && <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">Cancelled: {o.cancelReason}</p>}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-4">
          <Section title="Items">
            <div className="divide-y">
              {o.items.map((i) => (
                <div key={i.id} className="flex items-center gap-3 py-2">
                  {i.imageUrl ? <img src={i.imageUrl} alt="" className="size-14 rounded object-cover" /> : <div className="size-14 rounded bg-muted" />}
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{i.productName}</div>
                    <div className="text-xs text-muted-foreground">{[i.variantName, i.sku].filter(Boolean).join(" · ")}</div>
                  </div>
                  <div className="text-right text-sm">
                    <div>{i.quantity} × {bdt(i.unitPrice)}</div>
                    {Number(i.discount) > 0 && <div className="text-xs text-muted-foreground">−{bdt(i.discount)}</div>}
                    <div className="font-semibold">{bdt(i.lineTotal)}</div>
                    {i.unitCost && <div className="text-xs text-muted-foreground">cost {bdt(i.unitCost)}/pc</div>}
                  </div>
                </div>
              ))}
            </div>
            <dl className="mt-3 grid gap-1 border-t pt-3 text-sm sm:ml-auto sm:w-72">
              <div className="flex justify-between"><dt>Subtotal</dt><dd>{bdt(o.amounts.subtotal)}</dd></div>
              <div className="flex justify-between"><dt>Discount</dt><dd>−{bdt(o.amounts.discount)}</dd></div>
              <div className="flex justify-between"><dt>Delivery charge{o.shipping.deliveryOption && <span className="text-muted-foreground"> ({o.shipping.deliveryOption === "INSIDE_DHAKA" ? "Inside Dhaka" : "Outside Dhaka"})</span>}</dt><dd>{bdt(o.amounts.deliveryCharge)}</dd></div>
              <div className="flex justify-between font-semibold"><dt>Total</dt><dd>{bdt(o.amounts.total)}</dd></div>
              <div className="flex justify-between text-blue-700"><dt>Paid</dt><dd>{bdt(o.amounts.paid)}</dd></div>
              <div className="flex justify-between font-semibold text-red-600"><dt>Due (COD)</dt><dd>{bdt(o.amounts.due)}</dd></div>
              {Number(o.amounts.refunded) > 0 && <div className="flex justify-between text-rose-700"><dt>Refunded</dt><dd>{bdt(o.amounts.refunded)}</dd></div>}
            </dl>
          </Section>

          <Section title="Shipping">
            {o.shipments.length === 0 && <p className="text-sm text-muted-foreground">No courier booked yet.</p>}
            <div className="space-y-2">
              {o.shipments.map((s) => (
                <div key={s.id} className="flex flex-wrap items-center gap-3 rounded-lg border p-3 text-sm">
                  <Pill tone={SHIPMENT_TONE[s.status] ?? "gray"}>{s.status.replace("_", " ").toLowerCase()}</Pill>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{s.provider.name}{s.isReturn ? " (return)" : ""} · {s.trackingCode ?? s.consignmentId ?? "awaiting consignment"}</div>
                    <div className="text-xs text-muted-foreground">
                      COD {bdt(s.codAmount)}{s.deliveryFee ? ` · fee ${bdt(s.deliveryFee)}` : ""}{s.rawStatus ? ` · courier: ${s.rawStatus}` : ""} · attempts {s.attempts}
                    </div>
                    {s.lastError && <div className="text-xs text-red-600">{s.lastError}{s.nextRetryAt ? ` — retrying ${dhakaDateTime(s.nextRetryAt)}` : ""}</div>}
                  </div>
                  {["BOOKED", "PICKED_UP", "IN_TRANSIT", "RETURNING"].includes(s.status) && (
                    <Button size="sm" variant="outline" onClick={() => sync.mutate(s.id)} disabled={sync.isPending}><RefreshCw className="size-4" /> Sync</Button>
                  )}
                  {can("shipments.cancel") && ["PENDING", "BOOKED"].includes(s.status) && (
                    <Button size="sm" variant="ghost" className="text-red-600" onClick={() => setCancelShipment(s.id)}><XCircle className="size-4" /> Cancel</Button>
                  )}
                </div>
              ))}
            </div>
            {o.zone && <p className="mt-2 text-xs text-muted-foreground">Delivery zone: {o.zone.name}</p>}
          </Section>

          <Section title="Payments & refunds">
            <div className="space-y-2 text-sm">
              {o.payments.length === 0 && <p className="text-muted-foreground">No payments yet.</p>}
              {o.payments.map((p) => (
                <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2">
                  <span>{p.method} · {p.kind.replace("_", " ").toLowerCase()} {p.transactionId && <span className="text-muted-foreground">· {p.transactionId}</span>}</span>
                  <span className="flex items-center gap-2">
                    <strong>{bdt(p.amount)}</strong>
                    <Pill tone={p.status === "COMPLETED" ? "green" : p.status === "PENDING" ? "amber" : "red"}>{p.status.toLowerCase()}</Pill>
                    {p.status === "PENDING" && can("payments.record") && <Button size="sm" variant="outline" onClick={() => verifyPayment.mutate(p.id)}>Verify</Button>}
                  </span>
                </div>
              ))}
              {o.refunds.map((r) => (
                <div key={r.id} className="flex justify-between rounded-md border border-rose-200 bg-rose-50 p-2">
                  <span>Refund · {r.method} · {r.reason}</span>
                  <span><strong>{bdt(r.amount)}</strong> <Pill tone={r.status === "PAID" ? "green" : "amber"}>{r.status.toLowerCase()}</Pill></span>
                </div>
              ))}
            </div>
            {can("payments.record") && Number(o.amounts.due) > 0 && editable && (
              <form className="mt-3 grid gap-2 border-t pt-3 sm:grid-cols-5" onSubmit={(e) => { e.preventDefault(); recordPayment.mutate(); }}>
                <NativeSelect aria-label="Method" value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value })}>
                  {["BKASH", "NAGAD", "ROCKET", "BANK_TRANSFER", "CASH"].map((m) => <option key={m}>{m}</option>)}
                </NativeSelect>
                <Input placeholder="Amount" inputMode="decimal" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} required />
                <Input placeholder="Transaction ID" value={pay.transactionId} onChange={(e) => setPay({ ...pay, transactionId: e.target.value })} required={pay.method !== "CASH"} />
                <Input placeholder="Sender number" value={pay.senderNumber} onChange={(e) => setPay({ ...pay, senderNumber: e.target.value })} />
                <Button type="submit" disabled={recordPayment.isPending}>Record advance</Button>
              </form>
            )}
          </Section>

          <Section title="Timeline">
            <ol className="space-y-3 border-l pl-5">
              {o.statusHistory.map((h) => (
                <li key={h.id} className="relative text-sm">
                  <span className="absolute -left-[26px] top-1.5 size-2.5 rounded-full bg-primary" />
                  <Pill tone={ORDER_STATUS[h.toStatus].tone}>{ORDER_STATUS[h.toStatus].en}</Pill>
                  <span className="ml-2 text-xs text-muted-foreground">{dhakaDateTime(h.createdAt)} · {h.source === "COURIER" ? "courier" : h.user?.name ?? h.source.toLowerCase()}</span>
                  {h.reason && <p className="mt-0.5 text-muted-foreground">{h.reason}</p>}
                </li>
              ))}
            </ol>
          </Section>
        </div>

        <div className="space-y-4">
          <Section title="Customer">
            <div className="space-y-1 text-sm">
              <Link href={`/admin/customers/${o.customer.id}`} className="font-semibold hover:underline">{o.shipping.name}</Link>
              <div className="flex items-center gap-2">
                <span className="text-base font-bold">{o.shipping.phone}</span>
                <a href={telHref(o.shipping.phone)} className="rounded-full border p-1.5" aria-label="Call"><Phone className="size-3.5" /></a>
                <a href={whatsappHref(o.shipping.phone)} target="_blank" rel="noreferrer" className="rounded-full border p-1.5" aria-label="WhatsApp"><MessageCircle className="size-3.5" /></a>
              </div>
              <p>{address}</p>
              {o.shipping.note && <p className="text-muted-foreground">Note: {o.shipping.note}</p>}
              <p className="pt-1 text-xs text-muted-foreground">
                {o.customer.totalOrders} orders · {o.customer.deliveredOrders} delivered · {o.customer.returnedOrders} returned · {o.customer.cancelledOrders} cancelled
              </p>
            </div>
          </Section>

          {o.profit && (
            <Section title={<span>Profit <span className="text-xs font-normal text-muted-foreground">({o.profit.basis.replaceAll("_", " ").toLowerCase()})</span></span>}>
              <div className="space-y-1">
                <ProfitRow label="Product revenue" line={o.profit.productRevenue} />
                <ProfitRow label="Delivery charge (customer)" line={o.profit.shippingRevenue} />
                <ProfitRow label="Product cost" line={o.profit.productCost} negative />
                <div className="flex justify-between border-y py-1 text-sm font-medium"><span>Gross margin</span><span>{bdt(o.profit.grossMargin.amount)}</span></div>
                <ProfitRow label="Packaging" line={o.profit.packagingCost} negative />
                <ProfitRow label="Courier fee" line={o.profit.courierFee} negative />
                <ProfitRow label="COD charge" line={o.profit.codFee} negative />
                <ProfitRow label="Return charge" line={o.profit.returnFee} negative />
                <ProfitRow label="Refunds" line={o.profit.refunds} negative />
                <div className="flex justify-between border-t pt-1 font-semibold"><span>Net profit (estimate)</span><span className={Number(o.profit.netProfit.amount) < 0 ? "text-red-600" : "text-emerald-700"}>{bdt(o.profit.netProfit.amount)}</span></div>
                <p className="pt-1 text-xs text-muted-foreground">Advertising is allocated in reports, not per order. Estimates are replaced by courier-reported fees and settlements.</p>
              </div>
            </Section>
          )}

          <Section title="Call & message log">
            <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); addComm.mutate(); }}>
              <div className="flex gap-2">
                <NativeSelect className="w-32" aria-label="Channel" value={comm.channel} onChange={(e) => setComm({ ...comm, channel: e.target.value })}>
                  {["CALL", "WHATSAPP", "SMS", "MESSENGER", "EMAIL"].map((c) => <option key={c}>{c}</option>)}
                </NativeSelect>
                <NativeSelect aria-label="Outcome" value={comm.outcome} onChange={(e) => setComm({ ...comm, outcome: e.target.value })}>
                  <option value="">Outcome…</option>
                  {["Confirmed", "No answer", "Busy", "Wrong number", "Asked to call later", "Cancelled by customer"].map((c) => <option key={c}>{c}</option>)}
                </NativeSelect>
              </div>
              <Textarea rows={2} placeholder="What was discussed?" value={comm.summary} onChange={(e) => setComm({ ...comm, summary: e.target.value })} />
              <Button size="sm" type="submit" disabled={!comm.summary.trim() || addComm.isPending}>Log</Button>
            </form>
            <ul className="mt-3 space-y-2 text-sm">
              {o.communications.map((c) => (
                <li key={c.id} className="rounded-md bg-muted/60 p-2">
                  <div className="text-xs text-muted-foreground">{c.channel} · {c.outcome ?? c.direction.toLowerCase()} · {c.user?.name} · {dhakaDateTime(c.createdAt)}</div>
                  {c.summary}
                </li>
              ))}
            </ul>
          </Section>

          <Section title="Internal notes">
            <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); addNote.mutate(); }}>
              <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Visible to staff only" />
              <Button size="sm" type="submit" disabled={!note.trim() || addNote.isPending}>Add note</Button>
            </form>
            <ul className="mt-3 space-y-2 text-sm">
              {o.notes.map((n) => (
                <li key={n.id} className="rounded-md bg-muted/60 p-2">
                  <div className="text-xs text-muted-foreground">{n.user?.name ?? "System"} · {dhakaDateTime(n.createdAt)}</div>
                  {n.body}
                </li>
              ))}
            </ul>
          </Section>

          {o.returns.length > 0 && (
            <Section title="Returns">
              {o.returns.map((r) => (
                <Link key={r.id} href={`/admin/returns/${r.id}`} className="flex justify-between rounded-md border p-2 text-sm hover:bg-muted">
                  <span>{r.returnNumber} · {r.isRto ? "RTO" : r.type.toLowerCase()}</span>
                  <span>{r.status.toLowerCase()}</span>
                </Link>
              ))}
            </Section>
          )}

          {o.metaTracking && (
            <Section title="Meta tracking">
              <dl className="space-y-1.5 text-sm">
                <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Event ID</dt><dd className="truncate font-mono text-xs" title={o.metaTracking.eventId}>{o.metaTracking.eventId}</dd></div>
                <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Browser Pixel</dt><dd>{o.metaTracking.browserClaimedAt ? `issued ${dhakaDateTime(o.metaTracking.browserClaimedAt)}` : "not issued"}</dd></div>
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-muted-foreground">Conversions API</dt>
                  <dd>
                    {o.metaTracking.server ? (
                      <Pill tone={o.metaTracking.server.status === "SENT" ? "green" : o.metaTracking.server.status === "FAILED" ? "red" : o.metaTracking.server.status === "PENDING" ? "amber" : "gray"}>
                        {o.metaTracking.server.status.toLowerCase()}{o.metaTracking.server.testEventCode ? " (test)" : ""}
                      </Pill>
                    ) : "not queued"}
                  </dd>
                </div>
                {o.metaTracking.server && (
                  <p className="text-xs text-muted-foreground">
                    {o.metaTracking.server.attempts} attempt{o.metaTracking.server.attempts === 1 ? "" : "s"}
                    {o.metaTracking.server.sentAt ? ` · delivered ${dhakaDateTime(o.metaTracking.server.sentAt)}` : ""}
                    {o.metaTracking.server.fbtraceId ? ` · trace ${o.metaTracking.server.fbtraceId}` : ""}
                  </p>
                )}
                {o.metaTracking.server?.error && <p className="text-xs text-red-600">{o.metaTracking.server.error}</p>}
                {o.metaTracking.server && ["FAILED", "SKIPPED"].includes(o.metaTracking.server.status) && can("marketing.manage") && (
                  <Button size="sm" variant="outline" onClick={() => retryMeta.mutate(o.metaTracking!.server!.id)} disabled={retryMeta.isPending}>
                    <RefreshCw className="size-4" /> Send again (same event ID)
                  </Button>
                )}
              </dl>
            </Section>
          )}

          {o.attribution && (
            <Section title="Attribution">
              <dl className="grid grid-cols-2 gap-1 text-xs">
                {Object.entries(o.attribution).filter(([k, v]) => v && !["id", "orderId", "createdAt", "clientIpAddress", "clientUserAgent"].includes(k)).map(([k, v]) => (
                  <div key={k} className="contents"><dt className="text-muted-foreground">{k}</dt><dd className="truncate">{String(v)}</dd></div>
                ))}
              </dl>
            </Section>
          )}
        </div>
      </div>

      <StatusDialog order={statusOpen ? o : null} onClose={() => { setStatusOpen(false); refresh(); }} />
      <BookCourierDialog orderIds={bookOpen ? [o.id] : null} onClose={() => { setBookOpen(false); refresh(); }} />
      <ConfirmDialog
        open={!!cancelShipment}
        onOpenChange={(v) => !v && setCancelShipment(null)}
        title="Cancel this shipment?"
        description="The order goes back to Ready to ship. If the courier does not support API cancellation you'll be told to cancel in their portal first."
        destructive
        requireReason
        confirmLabel="Cancel shipment"
        onConfirm={async (reason) => {
          await api(`/couriers/shipments/${cancelShipment}/cancel`, { method: "POST", body: { reason } });
          toast.success("Shipment cancelled");
          refresh();
        }}
      />
      <ConfirmDialog
        open={duplicateOpen}
        onOpenChange={setDuplicateOpen}
        title="Duplicate this order?"
        description="A new pending order is created at today's prices and stock is reserved again. Use this for re-orders, not to fix mistakes."
        requireReason
        reasonLabel="Why is this order being duplicated?"
        confirmLabel="Duplicate"
        onConfirm={async (reason) => {
          const r = await api<{ id: string; orderNumber: string }>(`/orders/${o.id}/duplicate`, { method: "POST", body: { reason } });
          toast.success(`Created ${r.orderNumber}`);
          router.push(`/admin/orders/${r.id}`);
        }}
      />
    </div>
  );
}
