"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Package, Scissors, Trash2 } from "lucide-react";
import { api, ApiError, errorMessage, newIdempotencyKey } from "@/lib/api";
import { bdt } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, NativeSelect, Section } from "@/components/admin/ui";
import { useMaterials, useSupplierOptions } from "./shared";
import { VariantPicker } from "./inventory-parts";

export interface PurchaseOrder {
  id: string; number: string; status: string; supplierId: string; orderedAt: string | null; expectedAt: string | null; receivedAt: string | null;
  subtotal: string; shippingCost: string; otherCost: string; total: string; paidAmount: string; openBalance: string; notes: string | null; createdAt: string; updatedAt: string;
  supplier: { id: string; name: string; phone: string | null };
  items: {
    id: string; variantId: string | null; materialId: string | null; description: string; quantity: string; receivedQuantity: string; remainingQuantity: string; unitCost: string; total: string;
    variant: { id: string; sku: string; name: string; product: { id: string; name: string } } | null;
    material: { id: string; name: string; unit: string } | null;
  }[];
  payments?: { id: string; amount: string; method: string; reference: string | null; paidAt: string; note: string | null; account: { id: string; name: string } | null }[];
}

interface Line { key: string; variantId: string | null; materialId: string | null; label: string; unit: string; description: string; quantity: string; unitCost: string }

const qtyRe = /^\d+(\.\d{1,3})?$/;
const moneyRe = /^\d+(\.\d{1,2})?$/;
const k = () => Math.random().toString(36).slice(2);

export function PurchaseOrderForm({ po }: { po?: PurchaseOrder }) {
  const router = useRouter();
  const qc = useQueryClient();
  const suppliers = useSupplierOptions();
  const materials = useMaterials();
  const [idemKey] = useState(newIdempotencyKey);
  const [supplierId, setSupplierId] = useState(po?.supplierId ?? "");
  const [expectedAt, setExpectedAt] = useState(po?.expectedAt ? po.expectedAt.slice(0, 10) : "");
  const [shippingCost, setShipping] = useState(po ? String(Number(po.shippingCost)) : "0");
  const [otherCost, setOther] = useState(po ? String(Number(po.otherCost)) : "0");
  const [notes, setNotes] = useState(po?.notes ?? "");
  const [lines, setLines] = useState<Line[]>(
    po?.items.map((i) => ({
      key: i.id, variantId: i.variantId, materialId: i.materialId,
      label: i.variant ? `${i.variant.product.name} – ${i.variant.name} (${i.variant.sku})` : i.material ? i.material.name : i.description,
      unit: i.material?.unit ?? "pcs", description: i.description, quantity: String(Number(i.quantity)), unitCost: String(Number(i.unitCost)),
    })) ?? [],
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const upd = (key: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const subtotal = lines.reduce((s, l) => s + (qtyRe.test(l.quantity) && moneyRe.test(l.unitCost) ? Number(l.quantity) * Number(l.unitCost) : 0), 0);
  const total = subtotal + (Number(shippingCost) || 0) + (Number(otherCost) || 0);

  function validate() {
    const e: Record<string, string> = {};
    if (!supplierId) e.supplierId = "Choose a supplier";
    if (!lines.length) e.items = "Add at least one item";
    lines.forEach((l, i) => {
      if (!qtyRe.test(l.quantity) || Number(l.quantity) <= 0) e[`items.${i}.quantity`] = "Positive quantity";
      else if (l.variantId && !/^\d+$/.test(l.quantity)) e[`items.${i}.quantity`] = "Whole units for products";
      if (!moneyRe.test(l.unitCost)) e[`items.${i}.unitCost`] = "Amount like 120.50";
    });
    if (!moneyRe.test(shippingCost || "0")) e.shippingCost = "Invalid amount";
    if (!moneyRe.test(otherCost || "0")) e.otherCost = "Invalid amount";
    setErrors(e);
    return !Object.keys(e).length;
  }

  async function submit() {
    if (!validate()) return toast.error("Please fix the highlighted fields");
    setSaving(true);
    const body = {
      supplierId, expectedAt: expectedAt || null, shippingCost: shippingCost || "0", otherCost: otherCost || "0", notes: notes.trim() || null,
      items: lines.map((l) => ({ variantId: l.variantId, materialId: l.materialId, description: l.description.trim() || null, quantity: l.quantity, unitCost: l.unitCost })),
    };
    try {
      const saved = po
        ? await api<PurchaseOrder>(`/purchase-orders/${po.id}`, { method: "PUT", body })
        : await api<PurchaseOrder>("/purchase-orders", { method: "POST", body, idempotencyKey: idemKey });
      qc.invalidateQueries({ queryKey: ["purchase-orders"] });
      qc.invalidateQueries({ queryKey: ["purchase-order", saved.id] });
      toast.success(po ? "Purchase order updated" : `Draft ${saved.number} created`);
      router.push(`/admin/purchasing/${saved.id}`);
    } catch (e) {
      if (e instanceof ApiError) setErrors(e.fieldErrors);
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); submit(); }} noValidate>
      <Section title="Supplier">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Supplier" htmlFor="po-sup" error={errors.supplierId} hint={suppliers.data?.length === 0 ? <>No active suppliers. <Link className="text-blue-700 underline" href="/admin/purchasing/suppliers">Add one</Link>.</> : undefined}>
            <NativeSelect id="po-sup" value={supplierId} onChange={(e) => setSupplierId(e.target.value)} aria-invalid={!!errors.supplierId}>
              <option value="">Choose supplier…</option>
              {suppliers.data?.map((s) => <option key={s.id} value={s.id}>{s.name}{s.phone ? ` · ${s.phone}` : ""}</option>)}
              {po && !suppliers.data?.some((s) => s.id === po.supplierId) && <option value={po.supplierId}>{po.supplier.name}</option>}
            </NativeSelect>
          </Field>
          <Field label="Expected delivery" htmlFor="po-exp" error={errors.expectedAt}>
            <Input id="po-exp" type="date" value={expectedAt} onChange={(e) => setExpectedAt(e.target.value)} />
          </Field>
        </div>
      </Section>

      <Section title="Items">
        <div className="mb-3 grid gap-2 md:grid-cols-2">
          <div>
            <p className="mb-1 flex items-center gap-1 text-xs font-medium text-muted-foreground"><Package className="size-3.5" /> Finished product (enters stock)</p>
            <VariantPicker
              placeholder="Add product variant…"
              onPick={(v) => setLines((ls) => [...ls, { key: k(), variantId: v.id, materialId: null, label: `${v.productName} – ${v.name} (${v.sku})`, unit: "pcs", description: "", quantity: "1", unitCost: v.unitCost ? String(Number(v.unitCost)) : "" }])}
            />
          </div>
          <div>
            <p className="mb-1 flex items-center gap-1 text-xs font-medium text-muted-foreground"><Scissors className="size-3.5" /> Raw material</p>
            <NativeSelect
              value=""
              aria-label="Add material"
              onChange={(e) => {
                const m = materials.data?.find((x) => x.id === e.target.value);
                if (m) setLines((ls) => [...ls, { key: k(), variantId: null, materialId: m.id, label: m.name, unit: m.unit, description: "", quantity: "1", unitCost: String(Number(m.unitCost)) }]);
              }}
            >
              <option value="">{materials.data?.length === 0 ? "No materials yet" : "Add material…"}</option>
              {materials.data?.map((m) => <option key={m.id} value={m.id}>{m.name} — {bdt(m.unitCost)}/{m.unit}</option>)}
            </NativeSelect>
          </div>
        </div>
        {errors.items && <p className="mb-2 text-sm text-red-600">{errors.items}</p>}
        {lines.length === 0 ? (
          <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">No items yet. Add product variants or materials above.</p>
        ) : (
          <div className="space-y-2">
            <div className="hidden grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_100px_120px_110px_36px] gap-2 px-1 text-xs font-medium text-muted-foreground md:grid">
              <span>Item</span><span>Note (optional)</span><span>Qty</span><span>Unit cost ৳</span><span className="text-right">Line total</span><span />
            </div>
            {lines.map((l, i) => (
              <div key={l.key} className="grid grid-cols-2 gap-2 rounded-lg border p-2 md:grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_100px_120px_110px_36px] md:items-start">
                <div className="col-span-2 md:col-span-1">
                  <p className="text-sm font-medium">{l.label}</p>
                  <p className="text-xs text-muted-foreground">{l.variantId ? "Product → stock" : `Material (per ${l.unit})`}</p>
                </div>
                <Input className="col-span-2 h-8 md:col-span-1" value={l.description} onChange={(e) => upd(l.key, { description: e.target.value })} placeholder="Description override" aria-label="Item description" />
                <div>
                  <Input className="h-8" inputMode="decimal" value={l.quantity} onChange={(e) => upd(l.key, { quantity: e.target.value })} aria-label="Quantity" aria-invalid={!!errors[`items.${i}.quantity`]} />
                  {errors[`items.${i}.quantity`] && <p className="mt-0.5 text-xs text-red-600">{errors[`items.${i}.quantity`]}</p>}
                </div>
                <div>
                  <Input className="h-8" inputMode="decimal" value={l.unitCost} onChange={(e) => upd(l.key, { unitCost: e.target.value })} aria-label="Unit cost" aria-invalid={!!errors[`items.${i}.unitCost`]} />
                  {errors[`items.${i}.unitCost`] && <p className="mt-0.5 text-xs text-red-600">{errors[`items.${i}.unitCost`]}</p>}
                </div>
                <span className="self-center text-right text-sm tabular-nums">{bdt(qtyRe.test(l.quantity) && moneyRe.test(l.unitCost) ? Number(l.quantity) * Number(l.unitCost) : 0)}</span>
                <Button type="button" variant="ghost" size="icon" className="size-8 justify-self-end text-red-600" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} aria-label="Remove item">
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </Section>

      <div className="grid gap-4 md:grid-cols-2">
        <Section title="Notes">
          <Textarea rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Delivery terms, colours, quality notes…" aria-label="Notes" />
        </Section>
        <Section title="Totals">
          <div className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Items subtotal</span><span className="tabular-nums">{bdt(subtotal)}</span></div>
            <div className="flex items-center justify-between gap-2">
              <label htmlFor="po-ship" className="text-muted-foreground">Shipping cost</label>
              <Input id="po-ship" className={cn("h-8 w-32 text-right", errors.shippingCost && "border-red-500")} inputMode="decimal" value={shippingCost} onChange={(e) => setShipping(e.target.value)} />
            </div>
            <div className="flex items-center justify-between gap-2">
              <label htmlFor="po-other" className="text-muted-foreground">Other cost</label>
              <Input id="po-other" className={cn("h-8 w-32 text-right", errors.otherCost && "border-red-500")} inputMode="decimal" value={otherCost} onChange={(e) => setOther(e.target.value)} />
            </div>
            <div className="flex justify-between border-t pt-2 text-base font-semibold"><span>Total</span><span className="tabular-nums">{bdt(total)}</span></div>
            <p className="text-xs text-muted-foreground">Shipping and other costs are spread over items by value when computing landed cost on receipt. Final totals are calculated by the server.</p>
          </div>
        </Section>
      </div>

      <div className="sticky bottom-0 z-20 -mx-4 flex justify-end gap-2 border-t bg-white/95 px-4 py-3 backdrop-blur md:-mx-6 md:px-6">
        <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
        <Button type="submit" disabled={saving}>{saving && <Loader2 className="size-4 animate-spin" />} {po ? "Save draft" : "Create draft"}</Button>
      </div>
    </form>
  );
}
