"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm, useFieldArray, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Loader2, Minus, Plus, Search, Trash2 } from "lucide-react";
import { api, ApiError, errorMessage, newIdempotencyKey } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { bdt } from "@/lib/format";
import { CHANNELS, PAYMENT_METHODS } from "@/lib/status";
import type { OrderDetail } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, NativeSelect, Section } from "@/components/admin/ui";

interface Variant { id: string; sku: string; name: string; color: string | null; size: string | null; productName: string; imageUrl: string | null; price: string; available: number }
interface Division { id: string; name: string; districts: { id: string; name: string; nameBn: string | null; areas: { id: string; name: string }[] }[] }

const phoneRe = /^(?:\+?88)?01[3-9]\d{8}$/;
const moneyRe = /^\d+(\.\d{1,2})?$/;

const schema = z.object({
  phone: z.string().trim().transform((v) => v.replace(/[\s-]/g, "")).refine((v) => phoneRe.test(v), "Enter a valid Bangladeshi mobile number"),
  name: z.string().trim().min(2, "Name is required"),
  email: z.string().trim().email().optional().or(z.literal("")),
  addressLine: z.string().trim().min(5, "Full address is required"),
  districtId: z.string().min(1, "Choose a district"),
  areaId: z.string().optional(),
  note: z.string().max(500).optional(),
  items: z.array(z.object({
    variantId: z.string(),
    label: z.string(),
    imageUrl: z.string().nullable(),
    listPrice: z.string(),
    available: z.number(),
    quantity: z.number().int().min(1).max(999),
    unitPrice: z.string().regex(moneyRe, "Invalid price"),
  })).min(1, "Add at least one product"),
  discount: z.string().regex(moneyRe, "Invalid amount").optional().or(z.literal("")),
  deliveryOverride: z.string().regex(moneyRe, "Invalid amount").optional().or(z.literal("")),
  paymentMethod: z.enum(PAYMENT_METHODS),
  channel: z.enum(CHANNELS),
  internalNote: z.string().max(2000).optional(),
  assignedToId: z.string().optional(),
});
type FormValues = z.infer<typeof schema>;

function VariantPicker({ onPick }: { onPick: (v: Variant) => void }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 200);
    return () => clearTimeout(t);
  }, [q]);
  const res = useQuery({ queryKey: ["variants", debounced], queryFn: () => api<Variant[]>("/products/variants/search", { query: { q: debounced } }), enabled: open });
  return (
    <div className="relative">
      <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input value={q} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)} onChange={(e) => setQ(e.target.value)} placeholder="Search product name, SKU or barcode…" className="pl-9" aria-label="Add product" />
      {open && (
        <div className="absolute inset-x-0 top-11 z-20 max-h-80 overflow-y-auto rounded-lg border bg-popover p-1 shadow-lg">
          {res.isLoading && <Loader2 className="m-3 size-4 animate-spin" />}
          {res.data?.length === 0 && <p className="p-3 text-sm text-muted-foreground">No products found</p>}
          {res.data?.map((v) => (
            <button
              key={v.id}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onPick(v);
                setQ("");
              }}
              className="flex w-full items-center gap-3 rounded-md p-2 text-left hover:bg-accent"
            >
              {v.imageUrl ? <img src={v.imageUrl} alt="" className="size-10 rounded object-cover" /> : <div className="size-10 rounded bg-muted" />}
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{v.productName}</div>
                <div className="text-xs text-muted-foreground">{v.name} · {v.sku}</div>
              </div>
              <div className="text-right text-sm">
                <div className="font-medium">{bdt(v.price)}</div>
                <div className={v.available > 0 ? "text-xs text-emerald-700" : "text-xs text-red-600"}>{v.available > 0 ? `${v.available} in stock` : "Out of stock"}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function OrderForm({ existing }: { existing?: OrderDetail }) {
  const router = useRouter();
  const { can } = useAuth();
  // one key per form instance: retries / double submits replay the same order
  const [idemKey] = useState(() => newIdempotencyKey());
  const [submitting, setSubmitting] = useState(false);
  const locations = useQuery({ queryKey: ["locations"], queryFn: () => api<Division[]>("/shipping/locations"), staleTime: Infinity });
  const staff = useQuery({ queryKey: ["users", "options"], queryFn: () => api<{ id: string; name: string }[]>("/users/options"), enabled: can("orders.assign") });

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: existing
      ? {
          phone: existing.shipping.phone, name: existing.shipping.name, email: "", addressLine: existing.shipping.address, districtId: "", areaId: "",
          note: existing.shipping.note ?? "",
          items: existing.items.filter((i) => i.variantId).map((i) => ({ variantId: i.variantId!, label: `${i.productName}${i.variantName ? ` – ${i.variantName}` : ""}`, imageUrl: i.imageUrl, listPrice: i.unitPrice, available: 0, quantity: i.quantity, unitPrice: Number(i.unitPrice).toFixed(2) })),
          discount: Number(existing.amounts.discount) ? existing.amounts.discount : "", deliveryOverride: "",
          paymentMethod: existing.paymentMethod as FormValues["paymentMethod"], channel: existing.channel as FormValues["channel"], internalNote: "", assignedToId: existing.assignedTo?.id ?? "",
        }
      : { phone: "", name: "", email: "", addressLine: "", districtId: "", areaId: "", note: "", items: [], discount: "", deliveryOverride: "", paymentMethod: "COD", channel: "FACEBOOK", internalNote: "", assignedToId: "" },
  });
  const { register, control, handleSubmit, setValue, formState: { errors } } = form;
  const items = useFieldArray({ control, name: "items" });
  const w = useWatch({ control });

  // existing orders: resolve district/area ids from names once locations load
  useEffect(() => {
    if (!existing || !locations.data || form.getValues("districtId")) return;
    for (const div of locations.data)
      for (const d of div.districts)
        if (d.name === existing.shipping.district) {
          setValue("districtId", d.id);
          const a = d.areas.find((x) => x.name === existing.shipping.area);
          if (a) setValue("areaId", a.id);
        }
  }, [existing, locations.data, form, setValue]);

  const districts = useMemo(() => (locations.data ?? []).flatMap((d) => d.districts.map((x) => ({ ...x, division: d.name }))).sort((a, b) => a.name.localeCompare(b.name)), [locations.data]);
  const district = districts.find((d) => d.id === w.districtId);

  const subtotal = (w.items ?? []).reduce((s, i) => s + Number(i?.unitPrice || 0) * Number(i?.quantity || 0), 0);
  const discount = Number(w.discount || 0);
  const quote = useQuery({
    queryKey: ["quote", w.districtId, w.areaId, (w.items ?? []).length, subtotal - discount],
    queryFn: () => api<{ deliveryCharge: string; zone: string }>("/shipping/quote", { method: "POST", body: { districtId: w.districtId, areaId: w.areaId || null, weightGrams: Math.max(250, (w.items ?? []).reduce((s, i) => s + 300 * Number(i?.quantity || 0), 0)), merchandiseTotal: String(Math.max(0, subtotal - discount)) } }),
    enabled: !!w.districtId,
  });
  const delivery = w.deliveryOverride ? Number(w.deliveryOverride) : Number(quote.data?.deliveryCharge ?? 0);
  const total = Math.max(0, subtotal - discount) + delivery;

  // phone lookup → customer history + risk preview (new orders only)
  const normalizedPhone = (w.phone ?? "").replace(/[\s-]/g, "");
  const risk = useQuery({
    queryKey: ["risk", normalizedPhone, w.addressLine, total, w.paymentMethod],
    queryFn: () => api<{ score: number; flags: { code: string; message: string; messageBn: string }[]; customer: { id: string; name: string; totalOrders: number; deliveredOrders: number; returnedOrders: number; cancelledOrders: number } | null }>("/orders/risk-check", { method: "POST", body: { phone: normalizedPhone, addressLine: w.addressLine ?? "", total: total.toFixed(2), paymentMethod: w.paymentMethod } }),
    enabled: !existing && phoneRe.test(normalizedPhone),
  });
  const lookedUp = useRef<string | null>(null);
  useEffect(() => {
    if (existing || !phoneRe.test(normalizedPhone) || lookedUp.current === normalizedPhone) return;
    lookedUp.current = normalizedPhone;
    api<{ name: string; email: string | null; addresses: { addressLine: string; districtId: string | null; areaId: string | null }[] } | null>(`/customers/by-phone/${encodeURIComponent(normalizedPhone)}`)
      .then((c) => {
        if (!c) return;
        if (!form.getValues("name")) setValue("name", c.name);
        const addr = c.addresses[0];
        if (addr && !form.getValues("addressLine")) {
          setValue("addressLine", addr.addressLine);
          if (addr.districtId) setValue("districtId", addr.districtId);
          if (addr.areaId) setValue("areaId", addr.areaId);
        }
        toast.info(`Returning customer: ${c.name}`);
      })
      .catch(() => {});
  }, [normalizedPhone, existing, form, setValue]);

  const addVariant = (v: Variant) => {
    const idx = (w.items ?? []).findIndex((i) => i?.variantId === v.id);
    if (idx >= 0) setValue(`items.${idx}.quantity`, Number(w.items![idx]!.quantity) + 1);
    else items.append({ variantId: v.id, label: `${v.productName} – ${v.name}`, imageUrl: v.imageUrl, listPrice: v.price, available: v.available, quantity: 1, unitPrice: Number(v.price).toFixed(2) });
  };

  const onSubmit = async (values: FormValues) => {
    setSubmitting(true);
    const area = district?.areas.find((a) => a.id === values.areaId);
    const payloadItems = values.items.map((i) => ({ variantId: i.variantId, quantity: i.quantity, ...(Number(i.unitPrice).toFixed(2) !== Number(i.listPrice).toFixed(2) ? { unitPrice: i.unitPrice } : {}) }));
    try {
      if (existing) {
        await api(`/orders/${existing.id}`, {
          method: "PATCH",
          body: {
            shipping: { name: values.name, phone: values.phone, addressLine: values.addressLine, districtId: values.districtId, areaId: values.areaId || null, note: values.note || null },
            items: payloadItems,
            discount: values.discount || "0",
            ...(values.deliveryOverride ? { deliveryCharge: values.deliveryOverride } : {}),
            paymentMethod: values.paymentMethod,
            channel: values.channel,
            reason: values.internalNote || undefined,
          },
        });
        toast.success("Order updated");
        router.push(`/admin/orders/${existing.id}`);
      } else {
        const r = await api<{ id: string; orderNumber: string; status: string }>("/orders", {
          method: "POST",
          idempotencyKey: idemKey,
          body: {
            customer: { name: values.name, phone: values.phone, email: values.email || null },
            shipping: { addressLine: values.addressLine, districtId: values.districtId, areaId: values.areaId || null, districtName: district?.name, areaName: area?.name, note: values.note || null },
            items: payloadItems,
            ...(values.discount ? { discount: values.discount } : {}),
            ...(values.deliveryOverride ? { deliveryCharge: values.deliveryOverride } : {}),
            paymentMethod: values.paymentMethod,
            channel: values.channel,
            note: values.internalNote || null,
            assignedToId: values.assignedToId || null,
          },
        });
        toast.success(`Order ${r.orderNumber} created${r.status === "CONFIRMATION_REQUIRED" ? " – needs a confirmation call" : ""}`);
        router.push(`/admin/orders/${r.id}`);
      }
    } catch (e) {
      if (e instanceof ApiError && e.code === "INSUFFICIENT_STOCK") toast.error("Not enough stock for one of the items");
      else toast.error(errorMessage(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="space-y-4">
        <Section title="Customer">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Mobile number" error={errors.phone?.message} htmlFor="phone">
              <Input id="phone" inputMode="tel" placeholder="01XXXXXXXXX" {...register("phone")} />
            </Field>
            <Field label="Customer name" error={errors.name?.message} htmlFor="name">
              <Input id="name" {...register("name")} />
            </Field>
            {!existing && (
              <Field label="Email (optional)" error={errors.email?.message} htmlFor="email">
                <Input id="email" type="email" {...register("email")} />
              </Field>
            )}
          </div>
          {risk.data?.customer && (
            <p className="mt-3 rounded-md bg-muted px-3 py-2 text-sm">
              Existing customer · {risk.data.customer.totalOrders} orders · {risk.data.customer.deliveredOrders} delivered · {risk.data.customer.returnedOrders} returned · {risk.data.customer.cancelledOrders} cancelled
            </p>
          )}
          {!!risk.data?.flags.length && (
            <div className="mt-3 flex gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <ul>
                {risk.data.flags.map((f) => (
                  <li key={f.code}>{f.messageBn} — {f.message}</li>
                ))}
              </ul>
            </div>
          )}
        </Section>

        <Section title="Delivery address">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Field label="Address (house, road, area)" error={errors.addressLine?.message} htmlFor="addr">
                <Textarea id="addr" rows={2} {...register("addressLine")} />
              </Field>
            </div>
            <Field label="District" error={errors.districtId?.message} htmlFor="district">
              <NativeSelect id="district" {...register("districtId", { onChange: () => setValue("areaId", "") })}>
                <option value="">{locations.isLoading ? "Loading…" : "Choose district"}</option>
                {districts.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}{d.nameBn ? ` (${d.nameBn})` : ""}</option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Area / thana" htmlFor="area" hint={district && !district.areas.length ? "No areas listed for this district" : undefined}>
              <NativeSelect id="area" disabled={!district?.areas.length} {...register("areaId")}>
                <option value="">—</option>
                {district?.areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </NativeSelect>
            </Field>
            <div className="sm:col-span-2">
              <Field label="Delivery note for courier" htmlFor="note">
                <Input id="note" placeholder="e.g. call before delivery" {...register("note")} />
              </Field>
            </div>
          </div>
        </Section>

        <Section title="Products">
          <VariantPicker onPick={addVariant} />
          {errors.items?.message && <p className="mt-2 text-sm text-red-600">{errors.items.message}</p>}
          <div className="mt-3 divide-y rounded-lg border">
            {items.fields.length === 0 && <p className="p-4 text-center text-sm text-muted-foreground">No products added yet</p>}
            {items.fields.map((f, idx) => {
              const qty = Number(w.items?.[idx]?.quantity ?? 1);
              return (
                <div key={f.id} className="flex flex-wrap items-center gap-3 p-3">
                  {f.imageUrl ? <img src={f.imageUrl} alt="" className="size-12 rounded object-cover" /> : <div className="size-12 rounded bg-muted" />}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{f.label}</div>
                    <div className="text-xs text-muted-foreground">List price {bdt(f.listPrice)}{f.available ? ` · ${f.available} available` : ""}</div>
                  </div>
                  <div className="flex items-center rounded-md border">
                    <Button type="button" variant="ghost" size="icon" className="size-8" onClick={() => setValue(`items.${idx}.quantity`, Math.max(1, qty - 1))} aria-label="Decrease">
                      <Minus className="size-3.5" />
                    </Button>
                    <span className="w-8 text-center text-sm tabular-nums">{qty}</span>
                    <Button type="button" variant="ghost" size="icon" className="size-8" onClick={() => setValue(`items.${idx}.quantity`, qty + 1)} aria-label="Increase">
                      <Plus className="size-3.5" />
                    </Button>
                  </div>
                  <Input className="w-28" aria-label="Unit price" disabled={!can("orders.edit")} {...register(`items.${idx}.unitPrice`)} title={can("orders.edit") ? "Unit price" : "Changing prices requires the orders.edit permission"} />
                  <Button type="button" variant="ghost" size="icon" onClick={() => items.remove(idx)} aria-label="Remove item">
                    <Trash2 className="size-4 text-red-600" />
                  </Button>
                </div>
              );
            })}
          </div>
        </Section>
      </div>

      <div className="space-y-4">
        <Section title="Payment & summary" className="lg:sticky lg:top-20">
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Payment" htmlFor="pm">
                <NativeSelect id="pm" {...register("paymentMethod")}>
                  {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m === "COD" ? "Cash on delivery" : m.replace("_", " ")}</option>)}
                </NativeSelect>
              </Field>
              <Field label="Sales channel" htmlFor="ch">
                <NativeSelect id="ch" {...register("channel")}>
                  {CHANNELS.map((c) => <option key={c} value={c}>{c.toLowerCase()}</option>)}
                </NativeSelect>
              </Field>
              <Field label="Discount (৳)" error={errors.discount?.message} htmlFor="disc">
                <Input id="disc" inputMode="decimal" placeholder="0" {...register("discount")} />
              </Field>
              <Field label="Delivery (৳)" error={errors.deliveryOverride?.message} htmlFor="del" hint={quote.data ? `Auto: ${bdt(quote.data.deliveryCharge)} (${quote.data.zone?.replaceAll("_", " ").toLowerCase()})` : "Choose a district"}>
                <Input id="del" inputMode="decimal" placeholder={quote.data?.deliveryCharge ?? "auto"} disabled={!can("orders.override_delivery")} {...register("deliveryOverride")} />
              </Field>
            </div>
            {!existing && can("orders.assign") && (
              <Field label="Assign to" htmlFor="assign">
                <NativeSelect id="assign" {...register("assignedToId")}>
                  <option value="">Unassigned</option>
                  {staff.data?.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </NativeSelect>
              </Field>
            )}
            <Field label={existing ? "Reason for this change" : "Internal note"} htmlFor="inote">
              <Textarea id="inote" rows={2} {...register("internalNote")} />
            </Field>
            <dl className="space-y-1 border-t pt-3 text-sm">
              <div className="flex justify-between"><dt>Subtotal</dt><dd>{bdt(subtotal)}</dd></div>
              <div className="flex justify-between"><dt>Discount</dt><dd>−{bdt(discount)}</dd></div>
              <div className="flex justify-between"><dt>Delivery</dt><dd>{bdt(delivery)}</dd></div>
              <div className="flex justify-between border-t pt-2 text-base font-semibold"><dt>Total</dt><dd>{bdt(total)}</dd></div>
              <p className="text-xs text-muted-foreground">Final amounts are calculated on the server.</p>
            </dl>
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting && <Loader2 className="size-4 animate-spin" />}
              {existing ? "Save changes" : "Create order"}
            </Button>
          </div>
        </Section>
      </div>
    </form>
  );
}
