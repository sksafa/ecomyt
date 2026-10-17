"use client";

import Link from "next/link";
import { use, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Copy, Loader2, MapPin, MessageCircle, Pencil, Phone, Plus, ShieldAlert, Trash2, X } from "lucide-react";
import { api, ApiError, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { bdt, dhakaDateTime, dhakaDay, dhakaTime, telHref, titleCase, whatsappHref } from "@/lib/format";
import { ORDER_STATUS, PAYMENT_TONE, type OrderStatus } from "@/lib/status";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState, ErrorState, Field, IconAction, LoadingRows, NativeSelect, PageHeader, Pill, Section } from "@/components/admin/ui";
import { Stat, TableShell, td, th, RequirePermission } from "@/components/admin/catalog/shared";

interface CustomerDetail {
  id: string; name: string; phone: string; altPhone: string | null; email: string | null; notes: string | null; tags: string[];
  totalOrders: number; deliveredOrders: number; cancelledOrders: number; returnedOrders: number; lifetimeValue: string;
  firstOrderAt: string | null; lastOrderAt: string | null; createdAt: string; deletedAt: string | null; anonymizedAt: string | null;
  addresses: { id: string; label: string | null; recipientName: string; phone: string; addressLine: string; areaName: string | null; districtName: string | null; postalCode: string | null; isDefault: boolean }[];
  orders: { id: string; orderNumber: string; status: OrderStatus; total: string; paidAmount: string; createdAt: string; channel: string; paymentStatus: string; items: { productName: string; quantity: number }[] }[];
  communications: { id: string; channel: string; direction: string; summary: string; outcome: string | null; createdAt: string; user: { id: string; name: string } | null }[];
  indicators: { isRepeat: boolean; deliverySuccessRate: number | null; returnRate: number | null };
}

const CHANNELS = ["CALL", "SMS", "WHATSAPP", "EMAIL", "MESSENGER", "NOTE"] as const;

function CustomerDetailPageInner({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { can } = useAuth();
  const qc = useQueryClient();
  const router = useRouter();
  const q = useQuery({ queryKey: ["customer", id], queryFn: () => api<CustomerDetail>(`/customers/${id}`) });
  const [editing, setEditing] = useState(false);
  const [eraseOpen, setEraseOpen] = useState(false);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["customer", id] });
    qc.invalidateQueries({ queryKey: ["customers"] });
  };
  const patch = useMutation({
    mutationFn: (body: Record<string, unknown>) => api(`/customers/${id}`, { method: "PATCH", body }),
    onSuccess: () => { refresh(); toast.success("Customer updated"); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (q.isLoading) return <LoadingRows rows={8} />;
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const c = q.data;
  const canEdit = can("customers.edit") && !c.deletedAt;
  const ind = c.indicators;

  return (
    <div className="space-y-4">
      <Link href="/admin/customers" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Customers
      </Link>
      <PageHeader
        title={c.name}
        description={c.firstOrderAt ? `Customer since ${dhakaDay(c.firstOrderAt)}` : `Added ${dhakaDay(c.createdAt)}`}
        actions={
          <>
            <Button variant="outline" size="sm" asChild><a href={telHref(c.phone)}><Phone className="size-4" /> Call</a></Button>
            <Button variant="outline" size="sm" asChild><a href={whatsappHref(c.phone)} target="_blank" rel="noreferrer"><MessageCircle className="size-4" /> WhatsApp</a></Button>
            {can("customers.delete") && !c.deletedAt && (
              <Button variant="outline" size="sm" className="text-red-700 hover:bg-red-50 hover:text-red-800" onClick={() => setEraseOpen(true)}>
                <Trash2 className="size-4" /> Erase / anonymise
              </Button>
            )}
          </>
        }
      >
        {c.deletedAt && <Pill tone="red" className="mt-2">{c.anonymizedAt ? "Anonymised" : "Closed / merged"}</Pill>}
      </PageHeader>

      {/* Transparent indicators – facts from order history, no judgement */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Orders" value={c.totalOrders} hint={`${c.deliveredOrders} delivered · ${c.cancelledOrders} cancelled`} />
        <Stat label="Lifetime value" value={bdt(c.lifetimeValue)} hint="Delivered orders" />
        <Stat
          label="Delivery success"
          value={ind.deliverySuccessRate === null ? "—" : `${ind.deliverySuccessRate}%`}
          hint={ind.deliverySuccessRate === null ? "No completed deliveries yet" : `${c.deliveredOrders} of ${c.deliveredOrders + c.returnedOrders} shipped orders delivered`}
          tone={ind.deliverySuccessRate === null ? undefined : ind.deliverySuccessRate >= 80 ? "good" : ind.deliverySuccessRate >= 50 ? "warn" : "bad"}
        />
        <Stat
          label="Return rate"
          value={ind.returnRate === null ? "—" : `${ind.returnRate}%`}
          hint={`${c.returnedOrders} returned`}
          tone={ind.returnRate === null ? undefined : ind.returnRate === 0 ? "good" : ind.returnRate <= 20 ? "warn" : "bad"}
        />
        <Stat label="Repeat buyer" value={ind.isRepeat ? "Yes" : "No"} hint="2 or more delivered orders" tone={ind.isRepeat ? "good" : undefined} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Section title={`Orders (${c.orders.length}${c.totalOrders > c.orders.length ? ` of ${c.totalOrders}` : ""})`}>
            {c.orders.length === 0 ? (
              <p className="text-sm text-muted-foreground">No orders yet.</p>
            ) : (
              <TableShell className="-mx-1 border-0" minWidth={560}>
                <thead>
                  <tr>
                    <th className={th}>Order</th>
                    <th className={th}>Date</th>
                    <th className={th}>Items</th>
                    <th className={th}>Status</th>
                    <th className={th}>Payment</th>
                    <th className={cn(th, "text-right")}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {c.orders.map((o) => (
                    <tr key={o.id} className="hover:bg-muted/30">
                      <td className={td}>
                        <Link href={`/admin/orders/${o.id}`} className="font-medium text-blue-700 hover:underline">{o.orderNumber}</Link>
                        <p className="text-xs text-muted-foreground">{titleCase(o.channel)}</p>
                      </td>
                      <td className={cn(td, "whitespace-nowrap")}>{dhakaDay(o.createdAt)}<span className="block text-xs text-muted-foreground">{dhakaTime(o.createdAt)}</span></td>
                      <td className={cn(td, "max-w-40")}>
                        <p className="truncate" title={o.items.map((i) => `${i.productName} ×${i.quantity}`).join(", ")}>
                          {o.items.map((i) => `${i.productName} ×${i.quantity}`).join(", ")}
                        </p>
                      </td>
                      <td className={td}>
                        <Pill tone={ORDER_STATUS[o.status]?.tone ?? "gray"}>{ORDER_STATUS[o.status]?.en ?? o.status}</Pill>
                      </td>
                      <td className={td}><Pill tone={PAYMENT_TONE[o.paymentStatus] ?? "gray"}>{titleCase(o.paymentStatus)}</Pill></td>
                      <td className={cn(td, "text-right tabular-nums")}>{bdt(o.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </TableShell>
            )}
          </Section>

          <CommunicationLog customerId={id} items={c.communications} canAdd={canEdit} onAdded={refresh} />
        </div>

        <div className="space-y-4">
          <Section
            title="Contact"
            actions={canEdit && !editing ? <Button variant="ghost" size="sm" onClick={() => setEditing(true)}><Pencil className="size-4" /> Edit</Button> : undefined}
          >
            {editing ? (
              <ContactForm customer={c} onDone={() => setEditing(false)} onSaved={refresh} />
            ) : (
              <dl className="space-y-2 text-sm">
                <div>
                  <dt className="text-xs text-muted-foreground">Phone</dt>
                  <dd className="flex items-center gap-1 tabular-nums">
                    {c.phone}
                    <IconAction label="Copy phone" onClick={() => navigator.clipboard.writeText(c.phone).then(() => toast.success("Copied"))}><Copy className="size-3.5" /></IconAction>
                  </dd>
                </div>
                <div><dt className="text-xs text-muted-foreground">Alternate phone</dt><dd className="tabular-nums">{c.altPhone ?? "—"}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Email</dt><dd className="break-all">{c.email ?? "—"}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Last order</dt><dd>{dhakaDateTime(c.lastOrderAt)}</dd></div>
              </dl>
            )}
          </Section>

          <TagsEditor tags={c.tags} canEdit={canEdit} busy={patch.isPending} onSave={(tags) => patch.mutate({ tags })} />

          <NotesEditor notes={c.notes} canEdit={canEdit} busy={patch.isPending} onSave={(notes) => patch.mutate({ notes: notes || null })} />

          <Section title={`Addresses (${c.addresses.length})`}>
            {c.addresses.length === 0 ? (
              <p className="text-sm text-muted-foreground">No saved addresses.</p>
            ) : (
              <ul className="space-y-3">
                {c.addresses.map((a) => (
                  <li key={a.id} className="flex gap-2 text-sm">
                    <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    <div>
                      <p className="font-medium">
                        {a.recipientName} <span className="font-normal tabular-nums text-muted-foreground">· {a.phone}</span>
                        {a.isDefault && <Pill tone="blue" className="ml-2">Default</Pill>}
                      </p>
                      <p>{a.addressLine}</p>
                      <p className="text-muted-foreground">{[a.areaName, a.districtName, a.postalCode].filter(Boolean).join(", ")}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      </div>

      <EraseDialog
        open={eraseOpen}
        onOpenChange={setEraseOpen}
        customer={c}
        onDone={(result) => {
          qc.invalidateQueries({ queryKey: ["customers"] });
          toast.success(result === "deleted" ? "Customer deleted" : "Customer anonymised");
          router.push("/admin/customers");
        }}
      />
    </div>
  );
}

function ContactForm({ customer, onDone, onSaved }: { customer: CustomerDetail; onDone: () => void; onSaved: () => void }) {
  const [v, setV] = useState({ name: customer.name, phone: customer.phone, altPhone: customer.altPhone ?? "", email: customer.email ?? "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: () => api(`/customers/${customer.id}`, { method: "PATCH", body: { name: v.name.trim(), phone: v.phone.trim(), altPhone: v.altPhone.trim() || null, email: v.email.trim() || null } }),
    onSuccess: () => { onSaved(); toast.success("Contact details saved"); onDone(); },
    onError: (e) => {
      if (e instanceof ApiError && Object.keys(e.fieldErrors).length) setErrors(e.fieldErrors);
      else if (e instanceof ApiError && e.status === 400 && /phone/i.test(e.message)) setErrors({ phone: e.message });
      toast.error(errorMessage(e));
    },
  });
  const local: Record<string, string> = {};
  if (v.name.trim().length < 2) local.name = "Name is required";
  if (v.email && !/^\S+@\S+\.\S+$/.test(v.email)) local.email = "Enter a valid email";
  const err = (k: string) => errors[k] ?? local[k];
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        setErrors({});
        if (Object.keys(local).length) return;
        save.mutate();
      }}
    >
      <Field label="Name" htmlFor="c-name" error={err("name")}><Input id="c-name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></Field>
      <Field label="Phone" htmlFor="c-phone" error={err("phone")} hint="Any Bangladeshi format; saved as 01XXXXXXXXX"><Input id="c-phone" inputMode="tel" value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} /></Field>
      <Field label="Alternate phone" htmlFor="c-alt" error={err("altPhone")}><Input id="c-alt" inputMode="tel" value={v.altPhone} onChange={(e) => setV({ ...v, altPhone: e.target.value })} /></Field>
      <Field label="Email" htmlFor="c-email" error={err("email")}><Input id="c-email" type="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} /></Field>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onDone}>Cancel</Button>
        <Button type="submit" size="sm" disabled={save.isPending}>{save.isPending && <Loader2 className="size-4 animate-spin" />} Save</Button>
      </div>
    </form>
  );
}

function TagsEditor({ tags, canEdit, busy, onSave }: { tags: string[]; canEdit: boolean; busy: boolean; onSave: (tags: string[]) => void }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const t = draft.trim();
    if (!t || tags.includes(t)) return setDraft("");
    onSave([...tags, t].slice(0, 30));
    setDraft("");
  };
  return (
    <Section title="Tags">
      <div className="flex flex-wrap gap-1.5">
        {tags.length === 0 && <p className="text-sm text-muted-foreground">No tags.</p>}
        {tags.map((t) => (
          <span key={t} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs text-slate-700">
            {t}
            {canEdit && (
              <button type="button" disabled={busy} onClick={() => onSave(tags.filter((x) => x !== t))} aria-label={`Remove tag ${t}`} className="hover:text-red-700">
                <X className="size-3" />
              </button>
            )}
          </span>
        ))}
      </div>
      {canEdit && (
        <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); add(); }}>
          <Input value={draft} maxLength={40} onChange={(e) => setDraft(e.target.value)} placeholder="Add a tag (e.g. VIP, wholesale)" aria-label="New tag" className="h-8" />
          <Button type="submit" size="sm" variant="outline" disabled={busy || !draft.trim()}><Plus className="size-4" /> Add</Button>
        </form>
      )}
    </Section>
  );
}

function NotesEditor({ notes, canEdit, busy, onSave }: { notes: string | null; canEdit: boolean; busy: boolean; onSave: (n: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <Section
      title="Internal notes"
      actions={canEdit && draft === null ? <Button variant="ghost" size="sm" onClick={() => setDraft(notes ?? "")}><Pencil className="size-4" /> Edit</Button> : undefined}
    >
      {draft === null ? (
        <p className="whitespace-pre-wrap text-sm">{notes || <span className="text-muted-foreground">No notes.</span>}</p>
      ) : (
        <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); onSave(draft.trim()); setDraft(null); }}>
          <Textarea rows={4} maxLength={5000} value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="Internal notes" />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setDraft(null)}>Cancel</Button>
            <Button type="submit" size="sm" disabled={busy}>Save notes</Button>
          </div>
        </form>
      )}
    </Section>
  );
}

function CommunicationLog({ customerId, items, canAdd, onAdded }: { customerId: string; items: CustomerDetail["communications"]; canAdd: boolean; onAdded: () => void }) {
  const [v, setV] = useState({ channel: "CALL", direction: "OUTBOUND", summary: "", outcome: "" });
  const add = useMutation({
    mutationFn: () => api(`/customers/${customerId}/communications`, { method: "POST", body: { channel: v.channel, direction: v.direction, summary: v.summary.trim(), outcome: v.outcome.trim() || undefined } }),
    onSuccess: () => { setV({ channel: "CALL", direction: "OUTBOUND", summary: "", outcome: "" }); onAdded(); toast.success("Communication logged"); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Section title="Communication log">
      {canAdd && (
        <form className="mb-4 grid gap-2 rounded-lg border bg-muted/30 p-3 sm:grid-cols-[140px_140px_1fr]" onSubmit={(e) => { e.preventDefault(); if (v.summary.trim()) add.mutate(); }}>
          <NativeSelect aria-label="Channel" value={v.channel} onChange={(e) => setV({ ...v, channel: e.target.value })}>
            {CHANNELS.map((ch) => <option key={ch} value={ch}>{titleCase(ch)}</option>)}
          </NativeSelect>
          <NativeSelect aria-label="Direction" value={v.direction} onChange={(e) => setV({ ...v, direction: e.target.value })}>
            <option value="OUTBOUND">Outbound</option>
            <option value="INBOUND">Inbound</option>
          </NativeSelect>
          <Input aria-label="Outcome" placeholder="Outcome (optional, e.g. confirmed, no answer)" value={v.outcome} maxLength={100} onChange={(e) => setV({ ...v, outcome: e.target.value })} />
          <Textarea aria-label="Summary" className="sm:col-span-3" rows={2} placeholder="What was discussed?" value={v.summary} maxLength={2000} onChange={(e) => setV({ ...v, summary: e.target.value })} />
          <div className="flex justify-end sm:col-span-3">
            <Button type="submit" size="sm" disabled={add.isPending || !v.summary.trim()}>{add.isPending && <Loader2 className="size-4 animate-spin" />} Log</Button>
          </div>
        </form>
      )}
      {items.length === 0 ? (
        <EmptyState title="No communication logged" description="Calls, messages and notes with this customer will appear here." />
      ) : (
        <ol className="space-y-3">
          {items.map((m) => (
            <li key={m.id} className="rounded-lg border p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <Pill tone={m.channel === "NOTE" ? "gray" : "blue"}>{titleCase(m.channel)}</Pill>
                <span>{m.direction === "INBOUND" ? "Inbound" : "Outbound"}</span>
                {m.outcome && <span className="font-medium text-slate-700">· {m.outcome}</span>}
                <span className="ml-auto">{m.user?.name ?? "System"} · {dhakaDateTime(m.createdAt)}</span>
              </div>
              <p className="mt-1.5 whitespace-pre-wrap">{m.summary}</p>
            </li>
          ))}
        </ol>
      )}
    </Section>
  );
}

function EraseDialog({ open, onOpenChange, customer, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; customer: CustomerDetail; onDone: (result: string) => void }) {
  const [reason, setReason] = useState("");
  const [typed, setTyped] = useState("");
  const erase = useMutation({
    mutationFn: () => api<{ result: string }>(`/customers/${customer.id}`, { method: "DELETE", body: { reason: reason.trim() } }),
    onSuccess: (r) => { onOpenChange(false); onDone(r.result); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const hasOrders = customer.totalOrders > 0 || customer.orders.length > 0;
  const close = (o: boolean) => {
    if (!o) { setReason(""); setTyped(""); }
    onOpenChange(o);
  };
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-red-700"><ShieldAlert className="size-5" /> Erase customer data</DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-2 text-sm">
              {hasOrders ? (
                <>
                  <p>This customer has orders, so the profile will be <strong>anonymised</strong> rather than deleted:</p>
                  <ul className="list-disc space-y-1 pl-5">
                    <li>Name, phone, alternate phone, email, notes and tags are removed.</li>
                    <li>All saved addresses and the communication log are deleted.</li>
                    <li>Orders keep amounts and items (needed for accounting), but the shipping name, phone and address are replaced with “[erased]”.</li>
                    <li>Ad-click identifiers on those orders are cleared.</li>
                  </ul>
                </>
              ) : (
                <p>This customer has no orders, so the profile and its addresses will be <strong>permanently deleted</strong>.</p>
              )}
              <p className="font-medium text-red-700">This cannot be undone. The action is recorded in the audit log.</p>
            </div>
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="erase-reason">Reason (required)</Label>
            <Textarea id="erase-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Customer requested data deletion by phone on …" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="erase-confirm">Type <span className="font-mono font-semibold">ERASE</span> to confirm</Label>
            <Input id="erase-confirm" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)} disabled={erase.isPending}>Cancel</Button>
          <Button variant="destructive" disabled={erase.isPending || reason.trim().length < 3 || typed !== "ERASE"} onClick={() => erase.mutate()}>
            {erase.isPending && <Loader2 className="size-4 animate-spin" />} {hasOrders ? "Anonymise customer" : "Delete customer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <RequirePermission permission="customers.view">
      <CustomerDetailPageInner params={params} />
    </RequirePermission>
  );
}
