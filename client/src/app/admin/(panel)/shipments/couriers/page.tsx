"use client";

import { useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, BookOpen, Check, KeyRound, Loader2, Plus, ScrollText, Trash2, X } from "lucide-react";
import { api, errorMessage, request } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { dhakaDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ConfirmDialog, ErrorState, Field, LoadingRows, PageHeader, Pagination, Pill } from "@/components/admin/ui";
import { CopyButton, JsonBlock, SHIPPING_NAV, SubNav } from "@/components/admin/ops/common";
import { CAPABILITY_LABELS, type CourierApiLog, type CourierProviderFull } from "@/components/admin/ops/types";

const PROVIDERS_KEY = ["couriers", "providers"];

/** Provider config values: JSON (objects, numbers, booleans) when it parses, otherwise a plain string. */
function parseValue(v: string): unknown {
  const t = v.trim();
  if (t === "") return "";
  if (/^[[{]/.test(t) || /^(true|false|null|-?\d+(\.\d+)?)$/.test(t)) {
    try {
      return JSON.parse(t);
    } catch {
      return t;
    }
  }
  return t;
}
const showValue = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v));

function LogsDialog({ provider, onClose }: { provider: CourierProviderFull | null; onClose: () => void }) {
  const [page, setPage] = useState(1);
  const q = useQuery({
    queryKey: ["courier-logs", provider?.id, page],
    queryFn: () => request<CourierApiLog[]>(`/couriers/providers/${provider!.id}/logs`, { query: { page, pageSize: 20 } }),
    enabled: !!provider,
    placeholderData: keepPreviousData,
  });
  return (
    <Dialog open={!!provider} onOpenChange={(o) => { if (!o) { setPage(1); onClose(); } }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>API log · {provider?.name}</DialogTitle>
          <DialogDescription>Every call to the courier, newest first. Phone numbers and credentials are redacted.</DialogDescription>
        </DialogHeader>
        {q.isLoading ? <LoadingRows rows={4} /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !q.data?.data.length ? (
          <p className="text-sm text-muted-foreground">No API calls recorded yet.</p>
        ) : (
          <div className="space-y-2">
            {q.data.data.map((l) => (
              <details key={l.id} className="rounded-md border text-sm">
                <summary className="flex cursor-pointer flex-wrap items-center gap-2 px-3 py-2">
                  <Pill tone={l.success ? "green" : "red"}>{l.statusCode ?? (l.success ? "OK" : "ERR")}</Pill>
                  <span className="font-medium">{l.operation}</span>
                  <span className="text-xs text-muted-foreground">{dhakaDateTime(l.createdAt)}{l.durationMs !== null ? ` · ${l.durationMs} ms` : ""}</span>
                  {l.error && <span className="w-full text-xs text-red-700">{l.error}</span>}
                </summary>
                <div className="grid gap-2 border-t p-3 md:grid-cols-2">
                  <div><div className="mb-1 text-xs font-semibold text-muted-foreground">Request</div><JsonBlock value={l.request} /></div>
                  <div><div className="mb-1 text-xs font-semibold text-muted-foreground">Response</div><JsonBlock value={l.response} /></div>
                </div>
              </details>
            ))}
            <Pagination meta={q.data.meta} onPage={setPage} />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ProviderCard({ p, manage, onLogs }: { p: CourierProviderFull; manage: boolean; onLogs: () => void }) {
  const qc = useQueryClient();
  const [creds, setCreds] = useState<Record<string, string>>({});
  const [config, setConfig] = useState<{ key: string; value: string; removed?: boolean }[]>(() => Object.entries(p.config ?? {}).filter(([, v]) => v !== null).map(([key, v]) => ({ key, value: showValue(v) })));
  const [rotateOpen, setRotateOpen] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [showMap, setShowMap] = useState(false);

  const update = useMutation({
    mutationFn: (body: Record<string, unknown>) => api<{ webhookSecret?: string }>(`/couriers/providers/${p.id}`, { method: "PUT", body }),
    onSuccess: (r, body) => {
      qc.invalidateQueries({ queryKey: PROVIDERS_KEY });
      if (r.webhookSecret) setSecret(r.webhookSecret);
      else toast.success(body.credentials ? "Credentials saved" : body.config ? "Configuration saved" : `${p.name} updated`);
      if (body.credentials) setCreds({});
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const caps = p.capabilities;
  const badKeys = config.some((c) => !c.removed && !/^[A-Za-z][A-Za-z0-9_]{0,40}$/.test(c.key));

  return (
    <article className={cn("rounded-xl border bg-white", !p.implemented && "bg-slate-50")}>
      <header className="flex flex-wrap items-start justify-between gap-3 border-b p-4">
        <div>
          <h2 className="flex flex-wrap items-center gap-2 text-lg font-semibold">
            {p.name}
            <span className="font-mono text-xs font-normal text-muted-foreground">{p.code}</span>
          </h2>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {!p.implemented ? <Pill tone="gray">Not implemented</Pill> : p.isEnabled ? <Pill tone="green">Enabled</Pill> : <Pill tone="gray">Disabled</Pill>}
            {p.isDefault && <Pill tone="blue">Default</Pill>}
            {p.implemented && p.sandbox && <Pill tone="amber">Sandbox</Pill>}
          </div>
        </div>
        {p.implemented && (
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <label className="flex items-center gap-2">
              <Switch checked={p.isEnabled} disabled={!manage || update.isPending} onCheckedChange={(v) => update.mutate({ isEnabled: v })} aria-label={`Enable ${p.name}`} /> Enabled
            </label>
            <label className="flex items-center gap-2">
              <Switch checked={p.isDefault} disabled={!manage || update.isPending || p.isDefault || !p.isEnabled} onCheckedChange={(v) => v && update.mutate({ isDefault: true })} aria-label={`Make ${p.name} default`} /> Default
            </label>
            <label className="flex items-center gap-2">
              <Switch checked={p.sandbox} disabled={!manage || update.isPending || !caps?.sandbox} onCheckedChange={(v) => update.mutate({ sandbox: v })} aria-label={`${p.name} sandbox mode`} /> Sandbox
            </label>
          </div>
        )}
      </header>

      <div className="grid gap-5 p-4 lg:grid-cols-2">
        <div className="space-y-4">
          {caps ? (
            <div>
              <h3 className="mb-2 text-sm font-semibold">Capabilities</h3>
              <ul className="grid gap-1 text-sm sm:grid-cols-2">
                {Object.entries(CAPABILITY_LABELS).map(([k, label]) => {
                  const on = !!caps[k];
                  const unverified = p.unverified.includes(k);
                  return (
                    <li key={k} className="flex items-center gap-1.5">
                      {on ? <Check className="size-4 shrink-0 text-emerald-600" aria-label="supported" /> : <X className="size-4 shrink-0 text-slate-400" aria-label="not supported" />}
                      <span className={cn(!on && "text-muted-foreground")}>{label}</span>
                      {unverified && <span className="rounded border border-amber-300 bg-amber-50 px-1 text-[10px] font-medium uppercase text-amber-800" title="Implemented from community SDKs; not yet verified against official docs">unverified</span>}
                    </li>
                  );
                })}
              </ul>
              {p.webhookConfirmedViaApi && <p className="mt-2 text-xs text-muted-foreground">Webhooks from this courier are not signed, so each one triggers a status re-check through the API before anything changes.</p>}
            </div>
          ) : null}
          {p.notes.length > 0 && (
            <div className={cn("rounded-md border p-3 text-sm", p.implemented ? "bg-slate-50" : "border-amber-200 bg-amber-50 text-amber-900")}>
              {!p.implemented && <AlertTriangle className="mb-1 size-4" />}
              <ul className="list-disc space-y-1 pl-4">{p.notes.map((n) => <li key={n}>{n}</li>)}</ul>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {p.docsUrl && <Button variant="outline" size="sm" asChild><a href={p.docsUrl} target="_blank" rel="noreferrer"><BookOpen className="size-4" /> API docs</a></Button>}
            {manage && p.implemented && <Button variant="outline" size="sm" onClick={onLogs}><ScrollText className="size-4" /> API log</Button>}
            {p.statusMap && <Button variant="ghost" size="sm" onClick={() => setShowMap((v) => !v)}>{showMap ? "Hide" : "Show"} status mapping</Button>}
          </div>
          {showMap && p.statusMap && (
            <div className="max-h-64 overflow-y-auto rounded-md border text-xs">
              <table className="w-full">
                <tbody>
                  {Object.entries(p.statusMap).map(([k, v]) => (
                    <tr key={k} className="border-b last:border-0"><td className="px-2 py-1 font-mono">{k}</td><td className="px-2 py-1">{v ? v.replace(/_/g, " ").toLowerCase() : <span className="text-muted-foreground">informational</span>}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {p.implemented && (
          <div className="space-y-5">
            {p.credentialFields.length > 0 && (
              <form
                className="space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  update.mutate({ credentials: creds });
                }}
              >
                <h3 className="flex items-center gap-1.5 text-sm font-semibold"><KeyRound className="size-4" /> Credentials</h3>
                <p className="text-xs text-muted-foreground">Stored encrypted and never shown again. Leave a field empty to keep its saved value.</p>
                {p.credentialFields.map((f) => (
                  <Field key={f.key} label={`${f.label}${f.required ? "" : " (optional)"}`} htmlFor={`${p.id}-${f.key}`} hint={f.configured ? "✓ configured" : f.required ? "not set" : undefined}>
                    <Input
                      id={`${p.id}-${f.key}`}
                      type={f.secret ? "password" : "text"}
                      autoComplete="off"
                      value={creds[f.key] ?? ""}
                      onChange={(e) => setCreds((c) => ({ ...c, [f.key]: e.target.value }))}
                      placeholder={f.configured ? "•••••••• (configured – leave blank to keep)" : ""}
                      disabled={!manage}
                    />
                  </Field>
                ))}
                {manage && (
                  <Button type="submit" size="sm" disabled={update.isPending || !Object.values(creds).some((v) => v.trim())}>
                    {update.isPending && <Loader2 className="size-4 animate-spin" />} Save credentials
                  </Button>
                )}
              </form>
            )}

            <div className="space-y-2">
              <h3 className="text-sm font-semibold">Provider configuration</h3>
              <p className="text-xs text-muted-foreground">Settings the notes above refer to (e.g. storeId, areaMap, packageCode). Values that look like JSON — numbers, true/false, {"{…}"} — are saved as JSON.</p>
              {config.filter((c) => !c.removed).length === 0 && <p className="text-xs text-muted-foreground">No configuration values.</p>}
              {config.map((c, i) =>
                c.removed ? null : (
                  <div key={i} className="flex gap-2">
                    <Input className="h-8 w-36 font-mono text-xs" value={c.key} placeholder="key" aria-label="Config key" disabled={!manage} onChange={(e) => setConfig((cs) => cs.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))} />
                    <Input className="h-8 flex-1 font-mono text-xs" value={c.value} placeholder="value" aria-label={`Value for ${c.key || "new key"}`} disabled={!manage} onChange={(e) => setConfig((cs) => cs.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} />
                    {manage && <Button type="button" variant="ghost" size="icon" className="size-8" aria-label={`Remove ${c.key}`} onClick={() => setConfig((cs) => cs.map((x, j) => (j === i ? { ...x, removed: true } : x)))}><Trash2 className="size-4" /></Button>}
                  </div>
                ),
              )}
              {manage && (
                <div className="flex gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => setConfig((cs) => [...cs, { key: "", value: "" }])}><Plus className="size-4" /> Add value</Button>
                  <Button
                    type="button"
                    size="sm"
                    disabled={update.isPending || badKeys}
                    onClick={() => {
                      const body: Record<string, unknown> = {};
                      for (const c of config) if (c.key.trim()) body[c.key.trim()] = c.removed ? null : parseValue(c.value);
                      update.mutate({ config: body });
                      setConfig((cs) => cs.filter((c) => !c.removed && c.key.trim()));
                    }}
                  >
                    Save configuration
                  </Button>
                </div>
              )}
              {badKeys && <p className="text-xs text-red-600">Keys must start with a letter and use letters, digits or underscores.</p>}
            </div>

            {caps?.webhooks && (
              <div className="space-y-2">
                <h3 className="text-sm font-semibold">Status webhook</h3>
                <div className="flex gap-2">
                  <Input readOnly value={p.webhookUrl} className="h-8 font-mono text-xs" aria-label="Webhook URL" onFocus={(e) => e.target.select()} />
                  <CopyButton value={p.webhookUrl} />
                </div>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  {p.webhookConfigured ? <Pill tone="green">Secret configured</Pill> : <Pill tone="amber">No webhook secret yet</Pill>}
                  {manage && <Button variant="outline" size="sm" onClick={() => setRotateOpen(true)}>{p.webhookConfigured ? "Rotate secret" : "Generate secret"}</Button>}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={rotateOpen}
        onOpenChange={setRotateOpen}
        title={`${p.webhookConfigured ? "Rotate" : "Generate"} webhook secret for ${p.name}?`}
        description={p.webhookConfigured ? "The old secret stops working immediately. Status updates will be rejected until you paste the new secret into the courier portal." : "Paste the new secret into the courier's merchant portal."}
        confirmLabel={p.webhookConfigured ? "Rotate" : "Generate"}
        destructive={p.webhookConfigured}
        onConfirm={() => update.mutateAsync({ rotateWebhookSecret: true })}
      />
      <Dialog open={!!secret} onOpenChange={(o) => !o && setSecret(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New webhook secret</DialogTitle>
            <DialogDescription>Copy it now and paste it into the {p.name} portal. For security it will not be shown again.</DialogDescription>
          </DialogHeader>
          <div className="flex gap-2">
            <Input readOnly value={secret ?? ""} className="font-mono text-xs" aria-label="Webhook secret" onFocus={(e) => e.target.select()} />
            <CopyButton value={secret ?? ""} />
          </div>
          <p className="flex items-center gap-1.5 text-xs text-amber-800"><AlertTriangle className="size-4" /> Anyone with this secret can send status updates for your parcels. Don&apos;t share it in chat or email.</p>
          <DialogFooter><Button onClick={() => setSecret(null)}>I&apos;ve saved it</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </article>
  );
}

export default function CouriersPage() {
  const { can } = useAuth();
  const q = useQuery({ queryKey: PROVIDERS_KEY, queryFn: () => api<CourierProviderFull[]>("/couriers/providers") });
  const [logsOf, setLogsOf] = useState<CourierProviderFull | null>(null);
  const manage = can("couriers.manage");
  const sorted = [...(q.data ?? [])].sort((a, b) => Number(b.implemented) - Number(a.implemented));
  return (
    <div className="space-y-4">
      <PageHeader title="Shipping" description="Courier integrations: what each one supports, credentials and webhooks." />
      <SubNav items={SHIPPING_NAV(can)} />
      {!manage && <p className="rounded-md border bg-slate-50 p-3 text-sm text-muted-foreground">View only — changing courier settings needs the “Manage courier providers” permission.</p>}
      {q.isLoading ? <LoadingRows rows={4} className="[&>*]:h-48" /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (
        <div className="space-y-4">
          {sorted.map((p) => <ProviderCard key={p.id} p={p} manage={manage} onLogs={() => setLogsOf(p)} />)}
        </div>
      )}
      <LogsDialog provider={logsOf} onClose={() => setLogsOf(null)} />
    </div>
  );
}
