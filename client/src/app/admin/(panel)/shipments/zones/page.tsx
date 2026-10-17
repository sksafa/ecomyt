"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, Loader2, Pencil, Plus, Search } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { bdt } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ErrorState, Field, LoadingRows, NativeSelect, PageHeader, Pill, Section } from "@/components/admin/ui";
import { fieldErrorsOf, SHIPPING_NAV, SubNav, TableShell, TD, TH } from "@/components/admin/ops/common";

interface Zone {
  id: string; code: string; name: string; baseCharge: string; baseWeightGrams: number; perKgCharge: string; freeShippingAbove: string | null;
  isActive: boolean; sortOrder: number; _count: { districts: number; areas: number };
}
interface AreaLoc { id: string; name: string; nameBn: string | null; zone: { code: string } | null }
interface DistrictLoc { id: string; name: string; nameBn: string | null; zone: { code: string } | null; areas: AreaLoc[] }
interface Division { id: string; name: string; districts: DistrictLoc[] }
interface Pickup { id: string; name: string; contactName: string; phone: string; address: string; districtName: string | null; areaName: string | null; isDefault: boolean; isActive: boolean }

const money = (v: string) => /^\d+(\.\d{1,2})?$/.test(v.trim());

function ZoneRow({ z, manage }: { z: Zone; manage: boolean }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ name: z.name, baseCharge: String(z.baseCharge), baseWeightGrams: String(z.baseWeightGrams), perKgCharge: String(z.perKgCharge), freeShippingAbove: z.freeShippingAbove ? String(z.freeShippingAbove) : "", isActive: z.isActive });
  const dirty = f.name !== z.name || f.baseCharge !== String(z.baseCharge) || f.baseWeightGrams !== String(z.baseWeightGrams) || f.perKgCharge !== String(z.perKgCharge) || f.freeShippingAbove !== (z.freeShippingAbove ? String(z.freeShippingAbove) : "") || f.isActive !== z.isActive;
  const valid = f.name.trim().length >= 2 && money(f.baseCharge) && money(f.perKgCharge) && /^\d+$/.test(f.baseWeightGrams) && (!f.freeShippingAbove || money(f.freeShippingAbove));
  const save = useMutation({
    mutationFn: () => api(`/shipping/zones/${z.id}`, { method: "PUT", body: { name: f.name.trim(), baseCharge: f.baseCharge.trim(), baseWeightGrams: Number(f.baseWeightGrams), perKgCharge: f.perKgCharge.trim(), freeShippingAbove: f.freeShippingAbove.trim() || null, isActive: f.isActive, sortOrder: z.sortOrder } }),
    onSuccess: () => { toast.success(`${f.name} rates saved`); qc.invalidateQueries({ queryKey: ["shipping"] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const inp = (k: "baseCharge" | "baseWeightGrams" | "perKgCharge" | "freeShippingAbove", label: string, ok: boolean) => (
    <td className={TD}>
      <Input className={cn("h-8 w-24 text-right tabular-nums", !ok && "border-red-400")} inputMode="decimal" value={f[k]} disabled={!manage} aria-label={`${label} for ${z.name}`} onChange={(e) => setF({ ...f, [k]: e.target.value })} placeholder={k === "freeShippingAbove" ? "never" : ""} />
    </td>
  );
  return (
    <tr>
      <td className={TD}>
        <Input className="h-8 w-40" value={f.name} disabled={!manage} aria-label={`Name for ${z.code}`} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">{z.code} · {z._count.districts} districts, {z._count.areas} area overrides</div>
      </td>
      {inp("baseCharge", "Base charge", money(f.baseCharge))}
      {inp("baseWeightGrams", "Base weight", /^\d+$/.test(f.baseWeightGrams))}
      {inp("perKgCharge", "Per kg", money(f.perKgCharge))}
      {inp("freeShippingAbove", "Free shipping above", !f.freeShippingAbove || money(f.freeShippingAbove))}
      <td className={TD}><Switch checked={f.isActive} disabled={!manage} onCheckedChange={(v) => setF({ ...f, isActive: v })} aria-label={`${z.name} active`} /></td>
      <td className={TD}>
        {manage && <Button size="sm" disabled={!dirty || !valid || save.isPending} onClick={() => save.mutate()}>{save.isPending && <Loader2 className="size-4 animate-spin" />} Save</Button>}
      </td>
    </tr>
  );
}

function NewZoneDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const empty = { code: "", name: "", baseCharge: "", baseWeightGrams: "1000", perKgCharge: "0", freeShippingAbove: "" };
  const [f, setF] = useState(empty);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const m = useMutation({
    mutationFn: () => api("/shipping/zones", { method: "POST", body: { code: f.code.trim().toUpperCase(), name: f.name.trim(), baseCharge: f.baseCharge.trim(), baseWeightGrams: Number(f.baseWeightGrams), perKgCharge: f.perKgCharge.trim(), freeShippingAbove: f.freeShippingAbove.trim() || null, isActive: true, sortOrder: 100 } }),
    onSuccess: () => { toast.success("Zone created"); qc.invalidateQueries({ queryKey: ["shipping"] }); setF(empty); setErrs({}); onClose(); },
    onError: (e) => { setErrs(fieldErrorsOf(e)); toast.error(errorMessage(e)); },
  });
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>New delivery zone</DialogTitle></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Code" htmlFor="z-code" hint="UPPER_SNAKE_CASE, e.g. CHATTOGRAM_CITY" error={errs.code}><Input id="z-code" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} /></Field>
          <Field label="Name" htmlFor="z-name" error={errs.name}><Input id="z-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Base charge (৳)" htmlFor="z-base" error={errs.baseCharge}><Input id="z-base" inputMode="decimal" value={f.baseCharge} onChange={(e) => setF({ ...f, baseCharge: e.target.value })} /></Field>
          <Field label="Base weight (g)" htmlFor="z-bw" error={errs.baseWeightGrams}><Input id="z-bw" inputMode="numeric" value={f.baseWeightGrams} onChange={(e) => setF({ ...f, baseWeightGrams: e.target.value })} /></Field>
          <Field label="Per extra kg (৳)" htmlFor="z-kg" error={errs.perKgCharge}><Input id="z-kg" inputMode="decimal" value={f.perKgCharge} onChange={(e) => setF({ ...f, perKgCharge: e.target.value })} /></Field>
          <Field label="Free shipping above (৳)" htmlFor="z-free" hint="Leave empty for never" error={errs.freeShippingAbove}><Input id="z-free" inputMode="decimal" value={f.freeShippingAbove} onChange={(e) => setF({ ...f, freeShippingAbove: e.target.value })} /></Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={m.isPending || !/^[A-Z0-9_]{2,30}$/.test(f.code) || !money(f.baseCharge)} onClick={() => m.mutate()}>{m.isPending && <Loader2 className="size-4 animate-spin" />} Create</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AreaEditor({ district, area, zones, onClose }: { district: DistrictLoc; area: AreaLoc | null; zones: Zone[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(area?.name ?? "");
  const [nameBn, setNameBn] = useState(area?.nameBn ?? "");
  const [zoneId, setZoneId] = useState(zones.find((z) => z.code === area?.zone?.code)?.id ?? "");
  const m = useMutation({
    mutationFn: () => {
      const body = { name: name.trim(), nameBn: nameBn.trim() || null, zoneId: zoneId || null };
      return area ? api(`/shipping/areas/${area.id}`, { method: "PUT", body }) : api(`/shipping/districts/${district.id}/areas`, { method: "POST", body });
    },
    onSuccess: () => { toast.success(area ? "Area updated" : "Area added"); qc.invalidateQueries({ queryKey: ["shipping"] }); onClose(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{area ? `Edit ${area.name}` : `Add area in ${district.name}`}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <Field label="Area name (English)" htmlFor="a-name"><Input id="a-name" value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Area name (Bangla)" htmlFor="a-bn"><Input id="a-bn" lang="bn" value={nameBn} onChange={(e) => setNameBn(e.target.value)} /></Field>
          <Field label="Delivery zone" htmlFor="a-zone" hint={`Empty = same as ${district.name} (${district.zone?.code ?? "outside Dhaka"})`}>
            <NativeSelect id="a-zone" value={zoneId} onChange={(e) => setZoneId(e.target.value)}>
              <option value="">Use district zone</option>
              {zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
            </NativeSelect>
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={name.trim().length < 2 || m.isPending} onClick={() => m.mutate()}>{m.isPending && <Loader2 className="size-4 animate-spin" />} Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Districts({ divisions, zones, manage }: { divisions: Division[]; zones: Zone[]; manage: boolean }) {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [editArea, setEditArea] = useState<{ district: DistrictLoc; area: AreaLoc | null } | null>(null);
  const zoneByCode = (code?: string | null) => zones.find((z) => z.code === code);
  const assign = useMutation({
    mutationFn: ({ id, zoneId }: { id: string; zoneId: string | null }) => api(`/shipping/districts/${id}/zone`, { method: "PUT", body: { zoneId } }),
    onSuccess: () => { toast.success("District zone updated"); qc.invalidateQueries({ queryKey: ["shipping"] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const s = search.trim().toLowerCase();
  const filtered = divisions
    .map((d) => ({ ...d, districts: d.districts.filter((x) => !s || x.name.toLowerCase().includes(s) || x.nameBn?.includes(search.trim()) || x.areas.some((a) => a.name.toLowerCase().includes(s))) }))
    .filter((d) => d.districts.length);
  return (
    <Section title="Districts & areas" actions={<div className="relative w-56"><Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input className="h-8 pl-8" placeholder="Find district or area" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Find district or area" /></div>}>
      <p className="mb-3 text-xs text-muted-foreground">Each district belongs to a zone; areas can override it (e.g. Savar inside Dhaka district charged as sub-Dhaka). Districts without a zone are charged as outside Dhaka.</p>
      <div className="max-h-[560px] space-y-4 overflow-y-auto pr-1">
        {filtered.map((div) => (
          <div key={div.id}>
            <h3 className="sticky top-0 z-10 bg-card py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{div.name} division</h3>
            <ul className="divide-y rounded-lg border">
              {div.districts.map((d) => {
                const isOpen = open === d.id || (!!s && d.areas.some((a) => a.name.toLowerCase().includes(s)));
                const overrides = d.areas.filter((a) => a.zone).length;
                return (
                  <li key={d.id}>
                    <div className="flex flex-wrap items-center gap-2 px-3 py-2">
                      <button className="flex min-w-40 flex-1 items-center gap-1 text-left text-sm font-medium" onClick={() => setOpen(isOpen ? null : d.id)} aria-expanded={isOpen}>
                        {isOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                        {d.name} {d.nameBn && <span className="font-normal text-muted-foreground">· {d.nameBn}</span>}
                        <span className="ml-1 text-xs font-normal text-muted-foreground">{d.areas.length} areas{overrides ? `, ${overrides} override${overrides === 1 ? "" : "s"}` : ""}</span>
                      </button>
                      <NativeSelect className="h-8 w-48" value={zoneByCode(d.zone?.code)?.id ?? ""} disabled={!manage || assign.isPending} aria-label={`Zone for ${d.name}`} onChange={(e) => assign.mutate({ id: d.id, zoneId: e.target.value || null })}>
                        <option value="">No zone (outside Dhaka)</option>
                        {zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
                      </NativeSelect>
                    </div>
                    {isOpen && (
                      <div className="border-t bg-slate-50 px-3 py-2">
                        {d.areas.length === 0 ? <p className="text-xs text-muted-foreground">No areas yet.</p> : (
                          <ul className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
                            {d.areas.map((a) => (
                              <li key={a.id} className="flex items-center justify-between gap-2 rounded bg-white px-2 py-1 text-sm">
                                <span className="truncate">{a.name}{a.nameBn ? <span className="text-muted-foreground"> · {a.nameBn}</span> : null}</span>
                                <span className="flex shrink-0 items-center gap-1">
                                  {a.zone && <Pill tone="violet" className="text-[10px]">{zoneByCode(a.zone.code)?.name ?? a.zone.code}</Pill>}
                                  {manage && <Button variant="ghost" size="icon" className="size-7" aria-label={`Edit ${a.name}`} onClick={() => setEditArea({ district: d, area: a })}><Pencil className="size-3.5" /></Button>}
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                        {manage && <Button variant="outline" size="sm" className="mt-2" onClick={() => setEditArea({ district: d, area: null })}><Plus className="size-4" /> Add area</Button>}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
        {filtered.length === 0 && <p className="text-sm text-muted-foreground">No district or area matches “{search}”.</p>}
      </div>
      {editArea && <AreaEditor district={editArea.district} area={editArea.area} zones={zones} onClose={() => setEditArea(null)} />}
    </Section>
  );
}

function QuoteTester({ divisions }: { divisions: Division[] }) {
  const districts = useMemo(() => divisions.flatMap((d) => d.districts).sort((a, b) => a.name.localeCompare(b.name)), [divisions]);
  const [districtId, setDistrictId] = useState("");
  const [areaId, setAreaId] = useState("");
  const [weight, setWeight] = useState("500");
  const [total, setTotal] = useState("2500");
  const areas = districts.find((d) => d.id === districtId)?.areas ?? [];
  const m = useMutation({
    mutationFn: () => api<{ zone: string | null; district: string | null; area: string | null; deliveryCharge: string }>("/shipping/quote", { method: "POST", body: { districtId: districtId || null, areaId: areaId || null, weightGrams: Number(weight) || 0, merchandiseTotal: money(total) ? total.trim() : "0" } }),
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Section title="Delivery charge tester">
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        <Field label="District" htmlFor="q-d">
          <NativeSelect id="q-d" value={districtId} onChange={(e) => { setDistrictId(e.target.value); setAreaId(""); }}>
            <option value="">Choose district…</option>
            {districts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </NativeSelect>
        </Field>
        <Field label="Area" htmlFor="q-a">
          <NativeSelect id="q-a" value={areaId} onChange={(e) => setAreaId(e.target.value)} disabled={!areas.length}>
            <option value="">Any / not listed</option>
            {areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </NativeSelect>
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Weight (g)" htmlFor="q-w"><Input id="q-w" inputMode="numeric" value={weight} onChange={(e) => setWeight(e.target.value)} /></Field>
          <Field label="Order value (৳)" htmlFor="q-t"><Input id="q-t" inputMode="decimal" value={total} onChange={(e) => setTotal(e.target.value)} /></Field>
        </div>
        <Button type="submit" size="sm" disabled={!districtId || m.isPending}>{m.isPending && <Loader2 className="size-4 animate-spin" />} Get quote</Button>
      </form>
      {m.data && (
        <div className="mt-3 rounded-lg border bg-blue-50 p-3 text-sm">
          <div className="text-2xl font-semibold tabular-nums">{Number(m.data.deliveryCharge) === 0 ? "Free" : bdt(m.data.deliveryCharge)}</div>
          <div className="text-muted-foreground">Zone {m.data.zone ?? "—"} · {[m.data.area, m.data.district].filter(Boolean).join(", ")}</div>
        </div>
      )}
    </Section>
  );
}

function PickupDialog({ pickup, onClose }: { pickup: Pickup | "new"; onClose: () => void }) {
  const qc = useQueryClient();
  const init = pickup === "new" ? { name: "", contactName: "", phone: "", address: "", districtName: "", areaName: "", isDefault: false, isActive: true } : { ...pickup, districtName: pickup.districtName ?? "", areaName: pickup.areaName ?? "" };
  const [f, setF] = useState(init);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const m = useMutation({
    mutationFn: () => {
      const body = { name: f.name.trim(), contactName: f.contactName.trim(), phone: f.phone.trim(), address: f.address.trim(), districtName: f.districtName.trim() || null, areaName: f.areaName.trim() || null, isDefault: f.isDefault, isActive: f.isActive };
      return pickup === "new" ? api("/shipping/pickup-addresses", { method: "POST", body }) : api(`/shipping/pickup-addresses/${pickup.id}`, { method: "PUT", body });
    },
    onSuccess: () => { toast.success("Pickup address saved"); qc.invalidateQueries({ queryKey: ["shipping", "pickups"] }); onClose(); },
    onError: (e) => { setErrs(fieldErrorsOf(e)); toast.error(errorMessage(e)); },
  });
  const text = (k: "name" | "contactName" | "phone" | "address" | "districtName" | "areaName", label: string) => (
    <Field label={label} htmlFor={`p-${k}`} error={errs[k]}><Input id={`p-${k}`} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></Field>
  );
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{pickup === "new" ? "New pickup address" : "Edit pickup address"}</DialogTitle></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          {text("name", "Label (e.g. Mirpur warehouse)")}
          {text("contactName", "Contact person")}
          {text("phone", "Phone")}
          {text("districtName", "District")}
          <div className="sm:col-span-2">{text("address", "Address")}</div>
          {text("areaName", "Area")}
          <div className="flex flex-col justify-end gap-2 text-sm">
            <label className="flex items-center gap-2"><Checkbox checked={f.isDefault} onCheckedChange={(v) => setF({ ...f, isDefault: !!v })} /> Default pickup</label>
            <label className="flex items-center gap-2"><Checkbox checked={f.isActive} onCheckedChange={(v) => setF({ ...f, isActive: !!v })} /> Active</label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={m.isPending} onClick={() => m.mutate()}>{m.isPending && <Loader2 className="size-4 animate-spin" />} Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Pickups({ manage }: { manage: boolean }) {
  const { can } = useAuth();
  const q = useQuery({ queryKey: ["shipping", "pickups"], queryFn: () => api<Pickup[]>("/shipping/pickup-addresses"), enabled: can("shipments.view") });
  const [edit, setEdit] = useState<Pickup | "new" | null>(null);
  if (!can("shipments.view")) return null;
  return (
    <Section title="Pickup addresses" actions={manage && <Button size="sm" variant="outline" onClick={() => setEdit("new")}><Plus className="size-4" /> Add</Button>}>
      {q.isLoading ? <LoadingRows rows={2} /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !q.data?.length ? (
        <p className="text-sm text-muted-foreground">No pickup addresses yet. Couriers collect parcels from the default one.</p>
      ) : (
        <ul className="space-y-2">
          {q.data.map((p) => (
            <li key={p.id} className={cn("flex items-start justify-between gap-2 rounded-lg border p-3 text-sm", !p.isActive && "opacity-60")}>
              <div>
                <div className="flex flex-wrap items-center gap-1.5 font-medium">{p.name}{p.isDefault && <Pill tone="blue">Default</Pill>}{!p.isActive && <Pill tone="gray">Inactive</Pill>}</div>
                <div className="text-muted-foreground">{p.contactName} · {p.phone}</div>
                <div className="text-muted-foreground">{[p.address, p.areaName, p.districtName].filter(Boolean).join(", ")}</div>
              </div>
              {manage && <Button variant="ghost" size="icon" className="size-8" aria-label={`Edit ${p.name}`} onClick={() => setEdit(p)}><Pencil className="size-4" /></Button>}
            </li>
          ))}
        </ul>
      )}
      {manage && <p className="mt-2 text-xs text-muted-foreground">Addresses can be deactivated but not deleted, so past bookings keep their pickup reference.</p>}
      {edit && <PickupDialog pickup={edit} onClose={() => setEdit(null)} />}
    </Section>
  );
}

export default function ZonesPage() {
  const { can } = useAuth();
  const manage = can("shipping.manage");
  const zones = useQuery({ queryKey: ["shipping", "zones"], queryFn: () => api<Zone[]>("/shipping/zones") });
  const locations = useQuery({ queryKey: ["shipping", "locations"], queryFn: () => api<Division[]>("/shipping/locations"), staleTime: 60_000 });
  const [newZone, setNewZone] = useState(false);
  return (
    <div className="space-y-4">
      <PageHeader title="Shipping" description="Delivery charges by zone, which districts and areas fall in each zone, and pickup addresses." />
      <SubNav items={SHIPPING_NAV(can)} />
      {!manage && <p className="rounded-md border bg-slate-50 p-3 text-sm text-muted-foreground">View only — editing rates needs the “Manage delivery zones” permission.</p>}

      <Section title="Zone rates" actions={manage && <Button size="sm" variant="outline" onClick={() => setNewZone(true)}><Plus className="size-4" /> New zone</Button>}>
        {zones.isLoading ? <LoadingRows rows={3} /> : zones.isError ? <ErrorState error={zones.error} onRetry={() => zones.refetch()} /> : (
          <TableShell minWidth={860} className="border-0">
            <thead>
              <tr>
                <th className={TH}>Zone</th>
                <th className={TH}>Base charge ৳</th>
                <th className={TH}>Base weight g</th>
                <th className={TH}>Per extra kg ৳</th>
                <th className={TH}>Free above ৳</th>
                <th className={TH}>Active</th>
                <th className={TH}><span className="sr-only">Save</span></th>
              </tr>
            </thead>
            <tbody>
              {zones.data?.map((z) => <ZoneRow key={`${z.id}:${z.baseCharge}:${z.perKgCharge}:${z.baseWeightGrams}:${z.freeShippingAbove}:${z.isActive}:${z.name}`} z={z} manage={manage} />)}
            </tbody>
          </TableShell>
        )}
        <p className="mt-2 text-xs text-muted-foreground">Charge = base charge for the first base weight, plus the per-kg rate for each started extra kilogram. Orders at or above the free-shipping value ship free. Inactive zones charge nothing.</p>
      </Section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        {locations.isLoading || zones.isLoading ? <LoadingRows rows={6} /> : locations.isError ? <ErrorState error={locations.error} onRetry={() => locations.refetch()} /> : (
          <Districts divisions={locations.data ?? []} zones={zones.data ?? []} manage={manage} />
        )}
        <div className="space-y-4">
          <QuoteTester divisions={locations.data ?? []} />
          <Pickups manage={manage} />
        </div>
      </div>
      <NewZoneDialog open={newZone} onClose={() => setNewZone(false)} />
    </div>
  );
}
