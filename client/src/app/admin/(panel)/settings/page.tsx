"use client";

import Link from "next/link";
import { Suspense, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Info, Loader2 } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { ORDER_STATUS, ORDER_STATUSES, TONE_CLASS, type Tone } from "@/lib/status";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ErrorState, Field, LoadingRows, PageHeader, Section } from "@/components/admin/ui";
import { fieldErrorsOf, ImageField, ToggleRow, useUrlFilters } from "@/components/admin/ops/common";
import { OptOutsSection, OutboundLogSection, TemplatesSection } from "@/components/admin/ops/notifications-admin";

interface Settings {
  store: { name: string; tagline: string; phone: string; email: string; address: string; logoUrl: string; currency: string; timezone: string };
  inventory: { reserveOn: "ORDER_CREATED" | "CONFIRMED"; deductOn: "COURIER_BOOKED" | "SHIPPED"; allowBackorder: boolean };
  orders: { confirmationRiskThreshold: number; duplicateWindowHours: number; defaultPackagingCost: string };
  finance: { codChargePercent: string; estimatedCourierFee: Record<string, string>; estimatedReturnFeeRatio: string };
  meta: { pixelId: string; capiEnabled: boolean };
  statusLabels: Record<string, { en?: string; bn?: string; color?: string }>;
  notifications: { newOrderInApp: boolean; lowStockInApp: boolean; courierFailureInApp: boolean; customerSmsOnConfirm: boolean; customerSmsOnShip: boolean; dailySummaryEmail: string; customerSmsLanguage: "en" | "bn" };
}
type Group = keyof Settings;

/** Save a group; returns field errors keyed by field path. */
function useSaveGroup<G extends Group>(group: G) {
  const qc = useQueryClient();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const m = useMutation({
    mutationFn: (body: Partial<Settings[G]>) => api<Settings[G]>(`/settings/${group}`, { method: "PUT", body }),
    onSuccess: () => {
      setErrors({});
      toast.success("Settings saved");
      qc.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (e) => {
      setErrors(fieldErrorsOf(e));
      toast.error(errorMessage(e));
    },
  });
  return { save: m.mutate, saving: m.isPending, errors };
}

function SaveBar({ disabled, saving, onSave, canEdit }: { disabled?: boolean; saving: boolean; onSave: () => void; canEdit: boolean }) {
  if (!canEdit) return <p className="mt-4 text-xs text-muted-foreground">View only — changing settings needs the “Change system settings” permission.</p>;
  return (
    <div className="mt-4 flex justify-end border-t pt-4">
      <Button disabled={disabled || saving} onClick={onSave}>{saving && <Loader2 className="size-4 animate-spin" />} Save changes</Button>
    </div>
  );
}

function Explain({ children }: { children: ReactNode }) {
  return <p className="flex gap-1.5 rounded-md bg-slate-50 p-2 text-xs text-slate-700"><Info className="mt-0.5 size-3.5 shrink-0" /><span>{children}</span></p>;
}

function StoreForm({ v, canEdit }: { v: Settings["store"]; canEdit: boolean }) {
  const [f, setF] = useState(v);
  const { save, saving, errors } = useSaveGroup("store");
  const t = (k: "name" | "tagline" | "phone" | "email", label: string) => <Field label={label} htmlFor={`s-${k}`} error={errors[k]}><Input id={`s-${k}`} value={f[k]} disabled={!canEdit} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></Field>;
  return (
    <Section title="Store information">
      <div className="grid gap-3 sm:grid-cols-2">
        {t("name", "Store name")}{t("tagline", "Tagline")}{t("phone", "Phone")}{t("email", "Email")}
        <div className="sm:col-span-2"><Field label="Address" htmlFor="s-address" error={errors.address}><Textarea id="s-address" rows={2} value={f.address} disabled={!canEdit} onChange={(e) => setF({ ...f, address: e.target.value })} /></Field></div>
        <div className="sm:col-span-2"><Field label="Logo" htmlFor="s-logo" error={errors.logoUrl}><ImageField id="s-logo" value={f.logoUrl} disabled={!canEdit} onChange={(logoUrl) => setF({ ...f, logoUrl })} /></Field></div>
        <Field label="Currency" hint="Fixed"><Input value={f.currency} disabled /></Field>
        <Field label="Time zone" hint="All business dates use Dhaka time"><Input value={f.timezone} disabled /></Field>
      </div>
      <SaveBar canEdit={canEdit} saving={saving} onSave={() => save({ name: f.name, tagline: f.tagline, phone: f.phone, email: f.email, address: f.address, logoUrl: f.logoUrl })} />
    </Section>
  );
}

function Choice<T extends string>({ value, onChange, options, disabled, name }: { value: T; onChange: (v: T) => void; options: { value: T; label: string; desc: ReactNode }[]; disabled?: boolean; name: string }) {
  return (
    <RadioGroup value={value} onValueChange={(v) => onChange(v as T)} disabled={disabled} className="grid gap-2 md:grid-cols-2" aria-label={name}>
      {options.map((o) => (
        <label key={o.value} className={cn("flex cursor-pointer gap-3 rounded-lg border p-3", value === o.value && "border-blue-600 bg-blue-50", disabled && "cursor-default")}>
          <RadioGroupItem value={o.value} className="mt-0.5" />
          <span><span className="text-sm font-medium">{o.label}</span><span className="block text-xs text-muted-foreground">{o.desc}</span></span>
        </label>
      ))}
    </RadioGroup>
  );
}

function InventoryForm({ v, canEdit }: { v: Settings["inventory"]; canEdit: boolean }) {
  const [f, setF] = useState(v);
  const { save, saving } = useSaveGroup("inventory");
  return (
    <Section title="Inventory policy">
      <div className="space-y-5">
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">When is stock reserved?</h3>
          <Choice name="Reserve stock on" disabled={!canEdit} value={f.reserveOn} onChange={(reserveOn) => setF({ ...f, reserveOn })} options={[
            { value: "ORDER_CREATED", label: "As soon as the order is placed (recommended)", desc: "Prevents overselling. Unconfirmed or fake orders hold stock until they are cancelled." },
            { value: "CONFIRMED", label: "Only after the order is confirmed", desc: "Unconfirmed orders don't block stock, but two customers can order the last piece; the second is caught at confirmation." },
          ]} />
        </div>
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">When does stock leave the books?</h3>
          <Choice name="Deduct stock on" disabled={!canEdit} value={f.deductOn} onChange={(deductOn) => setF({ ...f, deductOn })} options={[
            { value: "SHIPPED", label: "When the parcel is handed over / shipped (recommended)", desc: "Matches the physical stock on your shelf; a cancelled booking needs no stock correction." },
            { value: "COURIER_BOOKED", label: "When the courier is booked", desc: "Stock counts drop earlier; cancelling a booking returns the units to stock." },
          ]} />
        </div>
        <ToggleRow id="backorder" label="Allow backorders (pre-orders)" disabled={!canEdit} checked={f.allowBackorder} onChange={(allowBackorder) => setF({ ...f, allowBackorder })}
          description="When on, orders can be placed even if available stock is 0 — they're marked as pre-orders and available stock can go negative. When off, the storefront and staff can't sell more than is available." />
        <Explain>Changes apply to new orders only. Orders already reserved or deducted are not re-processed.</Explain>
      </div>
      <SaveBar canEdit={canEdit} saving={saving} onSave={() => save(f)} />
    </Section>
  );
}

function OrdersForm({ v, canEdit }: { v: Settings["orders"]; canEdit: boolean }) {
  const [f, setF] = useState({ confirmationRiskThreshold: String(v.confirmationRiskThreshold), duplicateWindowHours: String(v.duplicateWindowHours), defaultPackagingCost: String(v.defaultPackagingCost) });
  const { save, saving, errors } = useSaveGroup("orders");
  const intOk = (s: string, min: number, max: number) => /^\d+$/.test(s) && Number(s) >= min && Number(s) <= max;
  const valid = intOk(f.confirmationRiskThreshold, 0, 100) && intOk(f.duplicateWindowHours, 1, 720) && /^\d+(\.\d{1,2})?$/.test(f.defaultPackagingCost);
  return (
    <Section title="Order rules">
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Risk threshold (0–100)" htmlFor="o-risk" error={errors.confirmationRiskThreshold ?? (!intOk(f.confirmationRiskThreshold, 0, 100) ? "0 to 100" : undefined)}
          hint="Orders scoring at or above this go to “Needs confirmation” for a phone call. Lower = more calls, fewer fake parcels.">
          <Input id="o-risk" inputMode="numeric" disabled={!canEdit} value={f.confirmationRiskThreshold} onChange={(e) => setF({ ...f, confirmationRiskThreshold: e.target.value })} />
        </Field>
        <Field label="Duplicate window (hours)" htmlFor="o-dup" error={errors.duplicateWindowHours ?? (!intOk(f.duplicateWindowHours, 1, 720) ? "1 to 720" : undefined)}
          hint="A second order from the same phone within this time is flagged as a possible duplicate.">
          <Input id="o-dup" inputMode="numeric" disabled={!canEdit} value={f.duplicateWindowHours} onChange={(e) => setF({ ...f, duplicateWindowHours: e.target.value })} />
        </Field>
        <Field label="Packaging cost per order (৳)" htmlFor="o-pack" error={errors.defaultPackagingCost} hint="Used in profit calculations for each shipped order.">
          <Input id="o-pack" inputMode="decimal" disabled={!canEdit} value={f.defaultPackagingCost} onChange={(e) => setF({ ...f, defaultPackagingCost: e.target.value })} />
        </Field>
      </div>
      <SaveBar canEdit={canEdit} saving={saving} disabled={!valid} onSave={() => save({ confirmationRiskThreshold: Number(f.confirmationRiskThreshold), duplicateWindowHours: Number(f.duplicateWindowHours), defaultPackagingCost: f.defaultPackagingCost })} />
    </Section>
  );
}

const FEE_ZONES = [["INSIDE_DHAKA", "Inside Dhaka"], ["SUB_DHAKA", "Sub-Dhaka"], ["OUTSIDE_DHAKA", "Outside Dhaka"]] as const;

function FinanceForm({ v, canEdit }: { v: Settings["finance"]; canEdit: boolean }) {
  const [f, setF] = useState({ codChargePercent: String(v.codChargePercent), estimatedReturnFeeRatio: String(v.estimatedReturnFeeRatio), fees: Object.fromEntries(FEE_ZONES.map(([z]) => [z, String(v.estimatedCourierFee?.[z] ?? "")])) as Record<string, string> });
  const { save, saving, errors } = useSaveGroup("finance");
  return (
    <Section title="Finance estimates">
      <Explain>Until a courier reports its actual charges (or you record a COD settlement), profit uses these estimates and is marked “estimated”.</Explain>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Field label="COD collection charge (%)" htmlFor="f-cod" error={errors.codChargePercent} hint="Share of the collected cash the courier keeps, e.g. 1.00">
          <Input id="f-cod" inputMode="decimal" disabled={!canEdit} value={f.codChargePercent} onChange={(e) => setF({ ...f, codChargePercent: e.target.value })} />
        </Field>
        <Field label="Return fee ratio" htmlFor="f-ret" error={errors.estimatedReturnFeeRatio} hint="RTO charge as a share of the delivery fee, e.g. 0.5 = half the delivery fee">
          <Input id="f-ret" inputMode="decimal" disabled={!canEdit} value={f.estimatedReturnFeeRatio} onChange={(e) => setF({ ...f, estimatedReturnFeeRatio: e.target.value })} />
        </Field>
      </div>
      <h3 className="mt-5 text-sm font-semibold">Estimated courier delivery fee by zone (৳)</h3>
      <div className="mt-2 grid gap-3 sm:grid-cols-3">
        {FEE_ZONES.map(([z, label]) => (
          <Field key={z} label={label} htmlFor={`f-${z}`} error={errors[`estimatedCourierFee.${z}`]}>
            <Input id={`f-${z}`} inputMode="decimal" disabled={!canEdit} value={f.fees[z]} onChange={(e) => setF({ ...f, fees: { ...f.fees, [z]: e.target.value } })} />
          </Field>
        ))}
      </div>
      <SaveBar canEdit={canEdit} saving={saving} onSave={() => save({ codChargePercent: f.codChargePercent.trim(), estimatedReturnFeeRatio: f.estimatedReturnFeeRatio.trim(), estimatedCourierFee: Object.fromEntries(Object.entries(f.fees).filter(([, x]) => x.trim()).map(([k, x]) => [k, x.trim()])) })} />
    </Section>
  );
}

function NotificationsForm({ v, canEdit }: { v: Settings["notifications"]; canEdit: boolean }) {
  const [f, setF] = useState(v);
  const { save, saving, errors } = useSaveGroup("notifications");
  const tog = (k: "newOrderInApp" | "lowStockInApp" | "courierFailureInApp" | "customerSmsOnConfirm" | "customerSmsOnShip", label: string, desc: string) => (
    <ToggleRow id={`n-${k}`} label={label} description={desc} disabled={!canEdit} checked={f[k]} onChange={(x) => setF({ ...f, [k]: x })} />
  );
  return (
    <Section title="Notification preferences">
      <div className="grid gap-6 md:grid-cols-2">
        <div className="divide-y">
          <h3 className="pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Staff (in-app bell)</h3>
          {tog("newOrderInApp", "New orders", "Notify staff who can view orders.")}
          {tog("lowStockInApp", "Low stock", "When a variant falls to its low-stock threshold.")}
          {tog("courierFailureInApp", "Courier booking failures", "When a booking fails or keeps retrying.")}
        </div>
        <div className="divide-y">
          <h3 className="pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Customers (transactional SMS only)</h3>
          {tog("customerSmsOnConfirm", "SMS when order is confirmed", "Uses the “order.confirmed” template.")}
          {tog("customerSmsOnShip", "SMS when order ships", "Includes courier and tracking code.")}
          <div className="py-2">
            <div className="mb-1 text-sm font-medium">Customer SMS language</div>
            <Choice name="SMS language" disabled={!canEdit} value={f.customerSmsLanguage} onChange={(customerSmsLanguage) => setF({ ...f, customerSmsLanguage })} options={[
              { value: "en", label: "English", desc: "Shorter; 160 characters per SMS part." },
              { value: "bn", label: "বাংলা (Bangla)", desc: "Unicode SMS — 70 characters per part, costs more." },
            ]} />
          </div>
        </div>
      </div>
      <div className="mt-4 max-w-md">
        <Field label="Daily summary email" htmlFor="n-daily" error={errors.dailySummaryEmail} hint="A summary of yesterday's orders is emailed here each morning (Dhaka time). Leave empty to turn off.">
          <Input id="n-daily" type="email" disabled={!canEdit} value={f.dailySummaryEmail} onChange={(e) => setF({ ...f, dailySummaryEmail: e.target.value })} placeholder="owner@example.com" />
        </Field>
      </div>
      <SaveBar canEdit={canEdit} saving={saving} onSave={() => save({ ...f, dailySummaryEmail: f.dailySummaryEmail.trim() })} />
    </Section>
  );
}

function MetaForm({ v, canEdit }: { v: Settings["meta"]; canEdit: boolean }) {
  const [f, setF] = useState(v);
  const { save, saving, errors } = useSaveGroup("meta");
  return (
    <Section title="Meta (Facebook) Pixel & Conversions API">
      <div className="max-w-md space-y-3">
        <Field label="Pixel ID" htmlFor="m-pixel" error={errors.pixelId} hint="Numbers only, from Events Manager.">
          <Input id="m-pixel" inputMode="numeric" disabled={!canEdit} value={f.pixelId} onChange={(e) => setF({ ...f, pixelId: e.target.value.trim() })} />
        </Field>
        <ToggleRow id="m-capi" label="Send server-side events (Conversions API)" disabled={!canEdit} checked={f.capiEnabled} onChange={(capiEnabled) => setF({ ...f, capiEnabled })}
          description="Purchase events are sent from the server and de-duplicated with the browser pixel." />
      </div>
      <div className="mt-3"><Explain>The Conversions API access token is a secret: it lives in the server&apos;s environment configuration (META_CAPI_ACCESS_TOKEN), never in the database or this screen. Ask your developer to set or rotate it.</Explain></div>
      <SaveBar canEdit={canEdit} saving={saving} onSave={() => save(f)} />
    </Section>
  );
}

const TONES = Object.keys(TONE_CLASS) as Tone[];

function StatusLabelsForm({ v, canEdit }: { v: Settings["statusLabels"]; canEdit: boolean }) {
  const [f, setF] = useState<Record<string, { en: string; bn: string; color: string }>>(() => Object.fromEntries(ORDER_STATUSES.map((s) => [s, { en: v[s]?.en ?? "", bn: v[s]?.bn ?? "", color: v[s]?.color ?? "" }])));
  const { save, saving, errors } = useSaveGroup("statusLabels");
  return (
    <Section title="Order status labels">
      <Explain>Override how statuses are named for your team and customers. Leave a field empty to use the default shown as the placeholder. The workflow itself does not change.</Explain>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-2">Status</th><th>English</th><th>বাংলা</th><th>Colour</th></tr></thead>
          <tbody>
            {ORDER_STATUSES.map((s) => {
              const row = f[s];
              const set = (patch: Partial<typeof row>) => setF({ ...f, [s]: { ...row, ...patch } });
              const tone = (row.color || ORDER_STATUS[s].tone) as Tone;
              return (
                <tr key={s} className="border-t">
                  <td className="py-1.5 pr-2"><span className={cn("inline-flex rounded-full border px-2 py-0.5 text-xs font-medium", TONE_CLASS[tone] ?? TONE_CLASS.gray)}>{row.en || ORDER_STATUS[s].en}</span><div className="font-mono text-[10px] text-muted-foreground">{s}</div></td>
                  <td className="pr-2"><Input className="h-8" disabled={!canEdit} placeholder={ORDER_STATUS[s].en} value={row.en} onChange={(e) => set({ en: e.target.value })} aria-label={`${s} English label`} />{errors[`${s}.en`] && <p className="text-xs text-red-600">{errors[`${s}.en`]}</p>}</td>
                  <td className="pr-2"><Input className="h-8" lang="bn" disabled={!canEdit} placeholder={ORDER_STATUS[s].bn} value={row.bn} onChange={(e) => set({ bn: e.target.value })} aria-label={`${s} Bangla label`} /></td>
                  <td><select className="h-8 rounded-md border bg-white px-2 text-sm" disabled={!canEdit} value={row.color} onChange={(e) => set({ color: e.target.value })} aria-label={`${s} colour`}><option value="">default ({ORDER_STATUS[s].tone})</option>{TONES.map((t) => <option key={t} value={t}>{t}</option>)}</select></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <SaveBar canEdit={canEdit} saving={saving} onSave={() => save(Object.fromEntries(Object.entries(f).map(([k, x]) => [k, { en: x.en.trim(), bn: x.bn.trim(), ...(x.color ? { color: x.color } : {}) }])))} />
    </Section>
  );
}

const TABS = [
  { key: "store", label: "Store info" },
  { key: "inventory", label: "Inventory" },
  { key: "orders", label: "Orders" },
  { key: "finance", label: "Finance" },
  { key: "notifications", label: "Notifications" },
  { key: "meta", label: "Meta pixel" },
  { key: "statusLabels", label: "Status labels" },
] as const;

function SettingsScreen() {
  const { can } = useAuth();
  const [filters, setFilters] = useUrlFilters(["tab"] as const);
  const canView = can("settings.view");
  const canEdit = can("settings.manage");
  const canNotify = can("notifications.manage");
  const q = useQuery({ queryKey: ["settings"], queryFn: () => api<Settings>("/settings"), enabled: canView });
  const tabs = TABS.filter((t) => canView || (t.key === "notifications" && canNotify));
  const tab = tabs.find((t) => t.key === filters.tab) ?? tabs[0];

  if (!tabs.length) {
    return (
      <div className="space-y-4">
        <PageHeader title="Settings" />
        <p className="rounded-xl border bg-white p-6 text-sm">
          Store settings need the “View settings” permission.
          {can("couriers.manage") && <> You can manage courier integrations under <Link className="text-blue-700 hover:underline" href="/admin/shipments/couriers">Shipping → Couriers</Link>.</>}
        </p>
      </div>
    );
  }
  const d = q.data;
  const k = q.dataUpdatedAt;
  return (
    <div className="space-y-4">
      <PageHeader title="Settings" description="Business rules for the whole store. Every change is recorded in the audit log." />
      <div className="flex gap-1 overflow-x-auto border-b" role="tablist">
        {tabs.map((t) => (
          <button key={t.key} role="tab" aria-selected={tab.key === t.key} onClick={() => setFilters({ tab: t.key === "store" ? undefined : t.key })}
            className={cn("shrink-0 border-b-2 px-3 py-2 text-sm font-medium", tab.key === t.key ? "border-blue-600 text-blue-700" : "border-transparent text-muted-foreground hover:text-foreground")}>
            {t.label}
          </button>
        ))}
      </div>
      {canView && q.isLoading ? <LoadingRows rows={5} /> : canView && (q.isError || !d) ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (
        <>
          {tab.key === "store" && d && <StoreForm key={k} v={d.store} canEdit={canEdit} />}
          {tab.key === "inventory" && d && <InventoryForm key={k} v={d.inventory} canEdit={canEdit} />}
          {tab.key === "orders" && d && <OrdersForm key={k} v={d.orders} canEdit={canEdit} />}
          {tab.key === "finance" && d && <FinanceForm key={k} v={d.finance} canEdit={canEdit} />}
          {tab.key === "meta" && d && <MetaForm key={k} v={d.meta} canEdit={canEdit} />}
          {tab.key === "statusLabels" && d && <StatusLabelsForm key={k} v={d.statusLabels} canEdit={canEdit} />}
          {tab.key === "notifications" && (
            <div className="space-y-4">
              {d && <NotificationsForm key={k} v={d.notifications} canEdit={canEdit} />}
              {canNotify ? (
                <>
                  <TemplatesSection />
                  <OutboundLogSection />
                  <OptOutsSection />
                </>
              ) : <p className="text-sm text-muted-foreground">Templates, the outbound message log and opt-outs need the “Manage notification templates” permission.</p>}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function SettingsPage() {
  return <Suspense><SettingsScreen /></Suspense>;
}
