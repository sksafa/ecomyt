"use client";

import { useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Eye, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { api, errorMessage, request } from "@/lib/api";
import { dhakaDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ConfirmDialog, EmptyState, ErrorState, Field, LoadingRows, NativeSelect, Pagination, Pill, Section } from "@/components/admin/ui";
import { fieldErrorsOf, TableShell, TD, TH } from "./common";

interface Template { id: string; key: string; channel: string; subject: string | null; body: string; isActive: boolean; updatedAt: string }
interface DefaultTemplate { key: string; subject: { en: string; bn: string }; body: { en: string; bn: string }; variables: string[] }
interface LogRow { id: string; channel: string; type: string; recipient: string | null; title: string; body: string; status: string; error: string | null; attempts: number; sentAt: string | null; createdAt: string }
interface OptOut { id: string; channel: string; recipient: string; reason: string | null; createdAt: string }

const CHANNELS = ["EMAIL", "SMS", "WHATSAPP", "IN_APP"] as const;
const STATUS_TONE = { PENDING: "amber", SENT: "green", FAILED: "red", SKIPPED: "gray" } as const;

const SAMPLE: Record<string, string> = {
  customerName: "Nusrat Jahan", orderNumber: "BB100123", total: "৳2,450", courier: "Steadfast", trackingCode: "SF123456", codAmount: "৳2,450",
  date: "17/10/2026", placedCount: "18", placedValue: "৳42,300", confirmedCount: "15", shippedCount: "12", deliveredCount: "10", deliveredValue: "৳24,800",
  cancelledCount: "2", returnedCount: "1", awaitingConfirmation: "3", lowStockCount: "4",
};
const interpolate = (t: string, vars: Record<string, string>) => t.replace(/\{\{\s*([A-Za-z0-9_.]+)\s*\}\}/g, (_m, k: string) => vars[k] ?? "");

function TemplateDialog({ tpl, defaults, onClose }: { tpl: Template | "new"; defaults: DefaultTemplate[]; onClose: () => void }) {
  const qc = useQueryClient();
  const isNew = tpl === "new";
  const [f, setF] = useState({ key: isNew ? defaults[0]?.key ?? "" : tpl.key, channel: isNew ? "SMS" : tpl.channel, subject: isNew ? "" : tpl.subject ?? "", body: isNew ? "" : tpl.body, isActive: isNew ? true : tpl.isActive });
  const [errs, setErrs] = useState<Record<string, string>>({});
  const baseKey = f.key.replace(/\.bn$/, "");
  const lang = f.key.endsWith(".bn") ? "bn" : "en";
  const def = defaults.find((d) => d.key === baseKey);
  const serverPreview = useMutation({
    mutationFn: () => api<{ subject: string; body: string; source: string }>("/notifications/templates/preview", { method: "POST", body: { key: baseKey, channel: f.channel, lang, vars: SAMPLE } }),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const m = useMutation({
    mutationFn: () => {
      const body = { key: f.key.trim(), channel: f.channel, subject: f.subject.trim() || null, body: f.body, isActive: f.isActive };
      return isNew ? api("/notifications/templates", { method: "POST", body }) : api(`/notifications/templates/${tpl.id}`, { method: "PUT", body });
    },
    onSuccess: () => { toast.success("Template saved"); qc.invalidateQueries({ queryKey: ["notifications", "templates"] }); onClose(); },
    onError: (e) => { setErrs(fieldErrorsOf(e)); toast.error(errorMessage(e)); },
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{isNew ? "New template override" : `Edit ${tpl.key} · ${tpl.channel}`}</DialogTitle>
          <DialogDescription>Overrides the built-in text for one key and channel. Bengali versions use the key suffix <code>.bn</code>. Use variables like {"{{customerName}}"}.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <Field label="Key" htmlFor="t-key" error={errs.key}>
                <Input id="t-key" list="tpl-keys" value={f.key} onChange={(e) => setF({ ...f, key: e.target.value })} />
                <datalist id="tpl-keys">{defaults.flatMap((d) => [d.key, `${d.key}.bn`]).map((k) => <option key={k} value={k} />)}</datalist>
              </Field>
              <Field label="Channel" htmlFor="t-ch" error={errs.channel}>
                <NativeSelect id="t-ch" value={f.channel} onChange={(e) => setF({ ...f, channel: e.target.value })}>{CHANNELS.map((c) => <option key={c} value={c}>{c.replace("_", "-").toLowerCase()}</option>)}</NativeSelect>
              </Field>
            </div>
            {(f.channel === "EMAIL" || f.channel === "IN_APP") && <Field label="Subject / title" htmlFor="t-sub" error={errs.subject}><Input id="t-sub" value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} placeholder={def?.subject[lang]} /></Field>}
            <Field label="Body" htmlFor="t-body" error={errs.body} hint={f.channel === "SMS" ? `${f.body.length} characters${/[^\x00-\x7F]/.test(f.body) ? " · Unicode SMS (70 per part)" : " (160 per part)"}` : undefined}>
              <Textarea id="t-body" rows={7} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} lang={lang} placeholder={def?.body[lang]} />
            </Field>
            {def && (
              <div className="text-xs text-muted-foreground">
                Variables: {def.variables.map((v) => <button key={v} type="button" className="mr-1 rounded bg-muted px-1 font-mono hover:bg-muted/70" onClick={() => setF({ ...f, body: `${f.body}{{${v}}}` })}>{`{{${v}}}`}</button>)}
                {!f.body && <button type="button" className="ml-1 text-blue-700 hover:underline" onClick={() => setF({ ...f, body: def.body[lang], subject: f.subject || def.subject[lang] })}>Start from default</button>}
              </div>
            )}
            <label className="flex items-center gap-2 text-sm"><Switch checked={f.isActive} onCheckedChange={(v) => setF({ ...f, isActive: v })} /> Active (inactive overrides fall back to the default)</label>
          </div>
          <div className="space-y-2">
            <div className="text-sm font-semibold">Preview with sample data</div>
            <div className="rounded-lg border bg-slate-50 p-3 text-sm" lang={lang}>
              {f.subject && <div className="mb-1 font-semibold">{interpolate(f.subject, SAMPLE)}</div>}
              <p className="whitespace-pre-wrap">{f.body ? interpolate(f.body, SAMPLE) : <span className="text-muted-foreground">Type a body to preview it.</span>}</p>
            </div>
            {!isNew && def && (
              <>
                <Button type="button" size="sm" variant="outline" onClick={() => serverPreview.mutate()} disabled={serverPreview.isPending}><Eye className="size-4" /> What customers get now</Button>
                {serverPreview.data && (
                  <div className="rounded-lg border p-3 text-sm" lang={lang}>
                    <div className="mb-1 text-xs text-muted-foreground">Saved version · source: {serverPreview.data.source === "db" ? "override" : "built-in default"}</div>
                    <div className="font-semibold">{serverPreview.data.subject}</div>
                    <p className="whitespace-pre-wrap">{serverPreview.data.body}</p>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={!f.key.trim() || !f.body.trim() || m.isPending} onClick={() => m.mutate()}>{m.isPending && <Loader2 className="size-4 animate-spin" />} Save template</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function TemplatesSection() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["notifications", "templates"], queryFn: () => api<{ templates: Template[]; defaults: DefaultTemplate[] }>("/notifications/templates") });
  const [edit, setEdit] = useState<Template | "new" | null>(null);
  const [del, setDel] = useState<Template | null>(null);
  return (
    <Section title="Message templates" actions={<Button size="sm" variant="outline" onClick={() => setEdit("new")}><Plus className="size-4" /> Override a template</Button>}>
      {q.isLoading ? <LoadingRows rows={3} /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (
        <div className="space-y-4">
          <div>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Built-in (used unless overridden)</h3>
            <ul className="grid gap-2 md:grid-cols-2">
              {q.data!.defaults.map((d) => (
                <li key={d.key} className="rounded-lg border p-3 text-sm">
                  <div className="font-mono text-xs font-semibold">{d.key}</div>
                  <p className="mt-1 line-clamp-2 text-muted-foreground">{d.body.en}</p>
                  <p className="line-clamp-2 text-muted-foreground" lang="bn">{d.body.bn}</p>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Your overrides</h3>
            {q.data!.templates.length === 0 ? <p className="text-sm text-muted-foreground">No overrides — the built-in texts are used.</p> : (
              <TableShell minWidth={640}>
                <thead><tr><th className={TH}>Key</th><th className={TH}>Channel</th><th className={TH}>Body</th><th className={TH}>Status</th><th className={TH}><span className="sr-only">Actions</span></th></tr></thead>
                <tbody>
                  {q.data!.templates.map((t) => (
                    <tr key={t.id}>
                      <td className={cn(TD, "font-mono text-xs")}>{t.key}</td>
                      <td className={TD}>{t.channel.toLowerCase()}</td>
                      <td className={cn(TD, "max-w-80")}><span className="line-clamp-2 text-xs">{t.body}</span></td>
                      <td className={TD}>{t.isActive ? <Pill tone="green">active</Pill> : <Pill tone="gray">inactive</Pill>}</td>
                      <td className={cn(TD, "whitespace-nowrap text-right")}>
                        <Button size="icon" variant="ghost" className="size-8" aria-label={`Edit ${t.key}`} onClick={() => setEdit(t)}><Pencil className="size-4" /></Button>
                        <Button size="icon" variant="ghost" className="size-8 text-red-700" aria-label={`Delete ${t.key}`} onClick={() => setDel(t)}><Trash2 className="size-4" /></Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </TableShell>
            )}
          </div>
        </div>
      )}
      {edit && q.data && <TemplateDialog tpl={edit} defaults={q.data.defaults} onClose={() => setEdit(null)} />}
      <ConfirmDialog open={!!del} onOpenChange={(o) => !o && setDel(null)} title={`Delete override ${del?.key} (${del?.channel.toLowerCase()})?`} description="The built-in default text is used again." destructive confirmLabel="Delete"
        onConfirm={async () => { await api(`/notifications/templates/${del!.id}`, { method: "DELETE" }); toast.success("Override deleted"); qc.invalidateQueries({ queryKey: ["notifications", "templates"] }); }} />
    </Section>
  );
}

export function OutboundLogSection() {
  const [f, setF] = useState({ channel: "", status: "", recipient: "", page: 1 });
  const [recipient, setRecipient] = useState("");
  const query = { channel: f.channel, status: f.status, recipient: f.recipient, page: f.page, pageSize: 20 };
  const q = useQuery({ queryKey: ["notifications", "log", query], queryFn: () => request<LogRow[]>("/notifications/log", { query }), placeholderData: keepPreviousData });
  const by = (q.data?.meta?.byStatus ?? {}) as Record<string, number>;
  return (
    <Section title="Outbound log">
      <div className="mb-3 flex flex-wrap gap-2">
        <NativeSelect className="w-36" aria-label="Channel" value={f.channel} onChange={(e) => setF({ ...f, channel: e.target.value, page: 1 })}>
          <option value="">All channels</option>{CHANNELS.filter((c) => c !== "IN_APP").map((c) => <option key={c} value={c}>{c.toLowerCase()}</option>)}
        </NativeSelect>
        <NativeSelect className="w-36" aria-label="Status" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value, page: 1 })}>
          <option value="">Any status</option>{Object.keys(STATUS_TONE).map((s) => <option key={s} value={s}>{s.toLowerCase()}{by[s] !== undefined && !f.status ? ` (${by[s]})` : ""}</option>)}
        </NativeSelect>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); setF({ ...f, recipient: recipient.trim(), page: 1 }); }}>
          <Input className="h-9 w-56" placeholder="Recipient phone / email" value={recipient} onChange={(e) => setRecipient(e.target.value)} aria-label="Recipient" />
          <Button type="submit" size="sm" variant="outline" className="h-9">Filter</Button>
        </form>
      </div>
      {q.isLoading ? <LoadingRows rows={4} /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !q.data?.data.length ? <EmptyState title="No messages" description="Customer SMS / email and staff emails appear here with their delivery status." /> : (
        <>
          <TableShell minWidth={760}>
            <thead><tr><th className={TH}>When</th><th className={TH}>Channel</th><th className={TH}>Recipient</th><th className={TH}>Message</th><th className={TH}>Status</th></tr></thead>
            <tbody>
              {q.data.data.map((l) => (
                <tr key={l.id}>
                  <td className={cn(TD, "whitespace-nowrap text-xs")}>{dhakaDateTime(l.createdAt)}</td>
                  <td className={TD}>{l.channel.toLowerCase()}</td>
                  <td className={cn(TD, "text-xs")}>{l.recipient ?? "—"}</td>
                  <td className={cn(TD, "max-w-80")}><div className="font-mono text-[11px] text-muted-foreground">{l.type}</div><span className="line-clamp-2 text-xs">{l.body}</span></td>
                  <td className={TD}><Pill tone={STATUS_TONE[l.status as keyof typeof STATUS_TONE] ?? "gray"}>{l.status.toLowerCase()}</Pill>{l.error && <div className="mt-1 max-w-48 text-[11px] text-red-700">{l.error}</div>}</td>
                </tr>
              ))}
            </tbody>
          </TableShell>
          <Pagination meta={q.data.meta} onPage={(page) => setF({ ...f, page })} />
        </>
      )}
    </Section>
  );
}

export function OptOutsSection() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const q = useQuery({ queryKey: ["notifications", "opt-outs", page], queryFn: () => request<OptOut[]>("/notifications/opt-outs", { query: { page, pageSize: 20 } }), placeholderData: keepPreviousData });
  const [n, setN] = useState({ channel: "SMS", recipient: "", reason: "" });
  const [del, setDel] = useState<OptOut | null>(null);
  const add = useMutation({
    mutationFn: () => api("/notifications/opt-outs", { method: "POST", body: { channel: n.channel, recipient: n.recipient.trim(), reason: n.reason.trim() || null } }),
    onSuccess: () => { toast.success("Opt-out recorded"); setN({ ...n, recipient: "", reason: "" }); qc.invalidateQueries({ queryKey: ["notifications", "opt-outs"] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Section title="Opt-outs">
      <p className="mb-3 text-xs text-muted-foreground">Customers who asked not to receive messages on a channel (e.g. replied STOP). They are skipped automatically.</p>
      <form className="mb-3 flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
        <NativeSelect className="w-32" aria-label="Channel" value={n.channel} onChange={(e) => setN({ ...n, channel: e.target.value })}>{["SMS", "WHATSAPP", "EMAIL"].map((c) => <option key={c} value={c}>{c.toLowerCase()}</option>)}</NativeSelect>
        <Input className="h-9 w-52" placeholder={n.channel === "EMAIL" ? "email@example.com" : "01XXXXXXXXX"} value={n.recipient} onChange={(e) => setN({ ...n, recipient: e.target.value })} aria-label="Recipient" />
        <Input className="h-9 w-52" placeholder="Reason (optional)" value={n.reason} onChange={(e) => setN({ ...n, reason: e.target.value })} aria-label="Reason" />
        <Button type="submit" size="sm" className="h-9" disabled={n.recipient.trim().length < 3 || add.isPending}>Add opt-out</Button>
      </form>
      {q.isLoading ? <LoadingRows rows={2} /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !q.data?.data.length ? <p className="text-sm text-muted-foreground">No opt-outs.</p> : (
        <>
          <ul className="divide-y rounded-lg border text-sm">
            {q.data.data.map((o) => (
              <li key={o.id} className="flex items-center justify-between gap-2 px-3 py-2">
                <span><Pill tone="gray">{o.channel.toLowerCase()}</Pill> <span className="ml-1 font-mono text-xs">{o.recipient}</span><span className="block text-xs text-muted-foreground">{dhakaDateTime(o.createdAt)}{o.reason ? ` · ${o.reason}` : ""}</span></span>
                <Button size="sm" variant="ghost" onClick={() => setDel(o)}>Remove</Button>
              </li>
            ))}
          </ul>
          <Pagination meta={q.data.meta} onPage={setPage} />
        </>
      )}
      <ConfirmDialog open={!!del} onOpenChange={(o) => !o && setDel(null)} title="Remove this opt-out?" description={`${del?.recipient} will receive ${del?.channel.toLowerCase()} messages again. Only do this if they opted back in.`} confirmLabel="Remove"
        onConfirm={async () => { await api(`/notifications/opt-outs/${del!.id}`, { method: "DELETE" }); toast.success("Opt-out removed"); qc.invalidateQueries({ queryKey: ["notifications", "opt-outs"] }); }} />
    </Section>
  );
}
