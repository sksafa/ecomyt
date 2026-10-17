"use client";

import Link from "next/link";
import { use, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Ban, Info, Loader2, PackageCheck, Pencil, Send } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { bdt, dhakaDateTime, dhakaDay, titleCase } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmDialog, ErrorState, Field, LoadingRows, PageHeader, Pill, Section } from "@/components/admin/ui";
import { PO_STATUS, TableShell, td, th, RequirePermission } from "@/components/admin/catalog/shared";
import { SupplierPaymentForm } from "@/components/admin/catalog/supplier-payment";
import type { PurchaseOrder } from "@/components/admin/catalog/po-form";

function PurchaseOrderDetailPageInner({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { can } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["purchase-order", id], queryFn: () => api<PurchaseOrder>(`/purchase-orders/${id}`) });
  const [confirm, setConfirm] = useState<"order" | "cancel" | null>(null);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["purchase-order", id] });
    qc.invalidateQueries({ queryKey: ["purchase-orders"] });
    qc.invalidateQueries({ queryKey: ["suppliers"] });
  };

  if (q.isLoading) return <LoadingRows rows={8} />;
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const po = q.data;
  const manage = can("purchasing.manage");
  const finance = can("finance.view");
  const receivable = ["ORDERED", "PARTIALLY_RECEIVED"].includes(po.status);
  const cancellable = ["DRAFT", "ORDERED"].includes(po.status) && po.items.every((i) => Number(i.receivedQuantity) === 0);
  const payable = ["ORDERED", "PARTIALLY_RECEIVED", "RECEIVED"].includes(po.status);

  return (
    <div className="space-y-4">
      <Link href="/admin/purchasing" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> Purchase orders</Link>
      <PageHeader
        title={po.number}
        description={<>Supplier: <Link className="text-blue-700 hover:underline" href={`/admin/purchasing/suppliers/${po.supplier.id}`}>{po.supplier.name}</Link>{po.supplier.phone ? ` · ${po.supplier.phone}` : ""}</>}
        actions={
          manage && (
            <>
              {po.status === "DRAFT" && <Button variant="outline" size="sm" asChild><Link href={`/admin/purchasing/${po.id}/edit`}><Pencil className="size-4" /> Edit</Link></Button>}
              {po.status === "DRAFT" && <Button size="sm" onClick={() => setConfirm("order")}><Send className="size-4" /> Mark as ordered</Button>}
              {cancellable && <Button variant="outline" size="sm" className="text-red-700 hover:bg-red-50" onClick={() => setConfirm("cancel")}><Ban className="size-4" /> Cancel</Button>}
            </>
          )
        }
      >
        <div className="mt-2"><Pill tone={PO_STATUS[po.status]?.tone ?? "gray"}>{PO_STATUS[po.status]?.label ?? po.status}</Pill></div>
      </PageHeader>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Info2 label="Created" value={dhakaDateTime(po.createdAt)} />
        <Info2 label="Ordered" value={dhakaDateTime(po.orderedAt)} />
        <Info2 label="Expected" value={dhakaDay(po.expectedAt)} />
        <Info2 label="Fully received" value={dhakaDateTime(po.receivedAt)} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {receivable && manage ? (
            <ReceiveForm po={po} onDone={refresh} />
          ) : (
            <Section title="Items">
              <ItemsTable po={po} />
            </Section>
          )}
          {po.notes && <Section title="Notes"><p className="whitespace-pre-wrap text-sm">{po.notes}</p></Section>}
        </div>
        <div className="space-y-4">
          <Section title="Totals">
            <dl className="space-y-1.5 text-sm">
              <Row label="Items subtotal" value={bdt(po.subtotal)} />
              <Row label="Shipping" value={bdt(po.shippingCost)} />
              <Row label="Other costs" value={bdt(po.otherCost)} />
              <div className="flex justify-between border-t pt-2 text-base font-semibold"><dt>Total</dt><dd className="tabular-nums">{bdt(po.total)}</dd></div>
              {finance && (
                <>
                  <Row label="Paid" value={bdt(po.paidAmount)} />
                  <Row label="Open balance" value={bdt(po.openBalance)} strong={Number(po.openBalance) > 0} />
                </>
              )}
            </dl>
          </Section>
          {finance && (
            <Section title="Supplier payments">
              {po.payments?.length ? (
                <ul className="mb-3 divide-y text-sm">
                  {po.payments.map((p) => (
                    <li key={p.id} className="py-2">
                      <div className="flex justify-between"><span className="font-medium tabular-nums">{bdt(p.amount)}</span><span className="text-muted-foreground">{dhakaDay(p.paidAt)}</span></div>
                      <p className="text-xs text-muted-foreground">{titleCase(p.method)}{p.account ? ` · from ${p.account.name}` : ""}{p.reference ? ` · ref ${p.reference}` : ""}</p>
                      {p.note && <p className="text-xs">{p.note}</p>}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mb-3 text-sm text-muted-foreground">No payments recorded against this purchase order.</p>
              )}
              {manage && payable && Number(po.openBalance) > 0 && <SupplierPaymentForm supplierId={po.supplierId} purchaseOrderId={po.id} maxAmount={po.openBalance} onDone={refresh} />}
              {!payable && <p className="text-xs text-muted-foreground">Payments can be recorded once the purchase order is ordered.</p>}
            </Section>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirm === "order"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={`Mark ${po.number} as ordered?`}
        description={`This commits ${bdt(po.total)} to ${po.supplier.name}: it counts toward the supplier balance and the PO can no longer be edited.`}
        confirmLabel="Mark as ordered"
        onConfirm={async () => {
          await api(`/purchase-orders/${po.id}/order`, { method: "POST" });
          toast.success("Marked as ordered");
          refresh();
        }}
      />
      <ConfirmDialog
        open={confirm === "cancel"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={`Cancel ${po.number}?`}
        description="The purchase order becomes void and no longer counts toward the supplier balance. This cannot be undone."
        confirmLabel="Cancel purchase order"
        destructive
        requireReason
        reasonLabel="Reason"
        onConfirm={async (reason) => {
          await api(`/purchase-orders/${po.id}/cancel`, { method: "POST", body: { reason } });
          toast.success("Purchase order cancelled");
          refresh();
        }}
      />
    </div>
  );
}

const Info2 = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-xl border bg-white p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="text-sm font-medium">{value}</p></div>
);
const Row = ({ label, value, strong }: { label: string; value: string; strong?: boolean }) => (
  <div className="flex justify-between"><dt className="text-muted-foreground">{label}</dt><dd className={cn("tabular-nums", strong && "font-semibold text-amber-700")}>{value}</dd></div>
);

function itemLink(i: PurchaseOrder["items"][number]) {
  return i.variant ? <Link className="font-medium text-blue-700 hover:underline" href={`/admin/products/${i.variant.product.id}`}>{i.description}</Link> : <span className="font-medium">{i.description}</span>;
}

function ItemsTable({ po }: { po: PurchaseOrder }) {
  return (
    <TableShell className="border-0">
      <thead><tr><th className={th}>Item</th><th className={cn(th, "text-right")}>Ordered</th><th className={cn(th, "text-right")}>Received</th><th className={cn(th, "text-right")}>Unit cost</th><th className={cn(th, "text-right")}>Total</th></tr></thead>
      <tbody>
        {po.items.map((i) => (
          <tr key={i.id}>
            <td className={td}>{itemLink(i)}<p className="text-xs text-muted-foreground">{i.variant ? `Product · ${i.variant.sku}` : `Material${i.material ? ` · per ${i.material.unit}` : ""}`}</p></td>
            <td className={cn(td, "text-right tabular-nums")}>{Number(i.quantity)}</td>
            <td className={cn(td, "text-right tabular-nums")}>{Number(i.receivedQuantity)}</td>
            <td className={cn(td, "text-right tabular-nums")}>{bdt(i.unitCost)}</td>
            <td className={cn(td, "text-right tabular-nums")}>{bdt(i.total)}</td>
          </tr>
        ))}
      </tbody>
    </TableShell>
  );
}

function ReceiveForm({ po, onDone }: { po: PurchaseOrder; onDone: () => void }) {
  const [qty, setQty] = useState<Record<string, string>>({});
  const [updateCost, setUpdateCost] = useState(false);
  const [note, setNote] = useState("");
  const [confirming, setConfirming] = useState(false);
  const errs: Record<string, string> = {};
  const lines = po.items.flatMap((i) => {
    const v = (qty[i.id] ?? "").trim();
    if (!v) return [];
    const rem = Number(i.remainingQuantity);
    if (!/^\d+(\.\d{1,3})?$/.test(v) || Number(v) <= 0) errs[i.id] = "Enter a positive number";
    else if (i.variantId && !/^\d+$/.test(v)) errs[i.id] = "Whole units only";
    else if (Number(v) > rem) errs[i.id] = `Max ${rem}`;
    return [{ itemId: i.id, quantity: v }];
  });
  const valid = lines.length > 0 && !Object.keys(errs).length;
  const receive = useMutation({
    mutationFn: () => api(`/purchase-orders/${po.id}/receive`, { method: "POST", body: { items: lines, updateCost, note: note.trim() || null } }),
    onSuccess: () => {
      toast.success("Goods received");
      setQty({});
      setNote("");
      setConfirming(false);
      onDone();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Section title={<span className="flex items-center gap-2"><PackageCheck className="size-4" /> Receive goods</span>}>
      <TableShell className="border-0">
        <thead><tr><th className={th}>Item</th><th className={cn(th, "text-right")}>Ordered</th><th className={cn(th, "text-right")}>Received</th><th className={cn(th, "text-right")}>Unit cost</th><th className={cn(th, "w-36")}>Receive now</th></tr></thead>
        <tbody>
          {po.items.map((i) => {
            const rem = Number(i.remainingQuantity);
            return (
              <tr key={i.id}>
                <td className={td}>{itemLink(i)}<p className="text-xs text-muted-foreground">{i.variant ? `Product · ${i.variant.sku}` : `Material${i.material ? ` · per ${i.material.unit}` : ""}`}</p></td>
                <td className={cn(td, "text-right tabular-nums")}>{Number(i.quantity)}</td>
                <td className={cn(td, "text-right tabular-nums")}>{Number(i.receivedQuantity)}</td>
                <td className={cn(td, "text-right tabular-nums")}>{bdt(i.unitCost)}</td>
                <td className={td}>
                  {rem > 0 ? (
                    <div>
                      <div className="flex gap-1">
                        <Input className="h-8" inputMode="decimal" value={qty[i.id] ?? ""} placeholder={`≤ ${rem}`} onChange={(e) => setQty({ ...qty, [i.id]: e.target.value })} aria-label={`Receive quantity for ${i.description}`} aria-invalid={!!errs[i.id]} />
                        <Button type="button" variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={() => setQty({ ...qty, [i.id]: String(rem) })}>All</Button>
                      </div>
                      {errs[i.id] && <p className="mt-0.5 text-xs text-red-600">{errs[i.id]}</p>}
                    </div>
                  ) : (
                    <Pill tone="green">Complete</Pill>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </TableShell>
      <div className="mt-3 space-y-3">
        <label className="flex items-start gap-2 rounded-md border bg-muted/30 p-3 text-sm">
          <input type="checkbox" className="mt-0.5 size-4" checked={updateCost} onChange={(e) => setUpdateCost(e.target.checked)} />
          <span>
            <span className="font-medium">Update cost with weighted average</span>
            <span className="mt-0.5 flex gap-1 text-xs text-muted-foreground">
              <Info className="mt-0.5 size-3.5 shrink-0" />
              <span>
                For products, the new cost = (units on hand × current cost + received units × landed cost) ÷ total units. Landed cost spreads this PO&apos;s shipping and other costs over items by value
                {Number(po.subtotal) > 0 && <> (×{(Number(po.total) / Number(po.subtotal)).toFixed(3)} here)</>}. For materials, the unit cost becomes this purchase price. Leave unticked to keep current costs.
              </span>
            </span>
          </span>
        </label>
        <Field label="Receiving note (optional)" htmlFor="rcv-note"><Input id="rcv-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Batch 1 of 2, 3 pcs slightly creased" /></Field>
        {confirming ? (
          <div className="flex flex-wrap items-center justify-end gap-2 rounded-md border border-blue-200 bg-blue-50 p-3 text-sm">
            <span className="mr-auto">Receive {lines.length} line{lines.length === 1 ? "" : "s"} into stock{updateCost ? " and update costs" : ""}?</span>
            <Button variant="outline" size="sm" onClick={() => setConfirming(false)}>Back</Button>
            <Button size="sm" disabled={receive.isPending} onClick={() => receive.mutate()}>{receive.isPending && <Loader2 className="size-4 animate-spin" />} Confirm receipt</Button>
          </div>
        ) : (
          <div className="flex justify-end"><Button disabled={!valid} onClick={() => setConfirming(true)}><PackageCheck className="size-4" /> Receive</Button></div>
        )}
      </div>
    </Section>
  );
}

export default function PurchaseOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <RequirePermission permission="purchasing.view">
      <PurchaseOrderDetailPageInner params={params} />
    </RequirePermission>
  );
}
