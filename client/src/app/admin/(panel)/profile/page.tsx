"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, ShieldCheck, ShieldOff } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { meQueryKey, useAuth } from "@/lib/auth";
import { ago, dhakaDateTime } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmDialog, ErrorState, Field, LoadingRows, PageHeader, Pill, Section } from "@/components/admin/ui";
import { CopyButton, deviceLabel } from "@/components/admin/ops/common";

interface SessionRow { id: string; ip: string | null; userAgent: string | null; createdAt: string; lastSeenAt: string; expiresAt: string; current: boolean }
interface LoginRow { id: string; success: boolean; reason: string | null; ip: string | null; userAgent: string | null; createdAt: string }

const passwordOk = (p: string) => p.length >= 8 && /[A-Za-z]/.test(p) && /\d/.test(p);

function ChangePassword() {
  const qc = useQueryClient();
  const [f, setF] = useState({ current: "", next: "", repeat: "" });
  const m = useMutation({
    mutationFn: () => api("/auth/change-password", { method: "POST", body: { currentPassword: f.current, newPassword: f.next } }),
    onSuccess: () => {
      toast.success("Password changed. Your other devices were signed out.");
      setF({ current: "", next: "", repeat: "" });
      qc.invalidateQueries({ queryKey: ["auth", "sessions"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Section title="Change password">
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        <Field label="Current password" htmlFor="cp-cur"><Input id="cp-cur" type="password" autoComplete="current-password" value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} /></Field>
        <Field label="New password" htmlFor="cp-new" hint="At least 8 characters with letters and numbers." error={f.next && !passwordOk(f.next) ? "At least 8 characters with letters and numbers." : undefined}>
          <Input id="cp-new" type="password" autoComplete="new-password" value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} />
        </Field>
        <Field label="Repeat new password" htmlFor="cp-rep" error={f.repeat && f.repeat !== f.next ? "Passwords don't match" : undefined}>
          <Input id="cp-rep" type="password" autoComplete="new-password" value={f.repeat} onChange={(e) => setF({ ...f, repeat: e.target.value })} />
        </Field>
        <Button type="submit" disabled={!f.current || !passwordOk(f.next) || f.next !== f.repeat || m.isPending}>{m.isPending && <Loader2 className="size-4 animate-spin" />} Change password</Button>
      </form>
    </Section>
  );
}

function TwoFactor() {
  const { me } = useAuth();
  const qc = useQueryClient();
  const [setup, setSetup] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [code, setCode] = useState("");
  const [pw, setPw] = useState("");
  const begin = useMutation({ mutationFn: () => api<{ secret: string; otpauthUrl: string }>("/auth/2fa/setup", { method: "POST" }), onSuccess: setSetup, onError: (e) => toast.error(errorMessage(e)) });
  const enable = useMutation({
    mutationFn: () => api("/auth/2fa/enable", { method: "POST", body: { code: code.replace(/\s/g, "") } }),
    onSuccess: () => { toast.success("Two-factor authentication is on"); setSetup(null); setCode(""); qc.invalidateQueries({ queryKey: meQueryKey }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const disable = useMutation({
    mutationFn: () => api("/auth/2fa/disable", { method: "POST", body: { password: pw } }),
    onSuccess: () => { toast.success("Two-factor authentication turned off"); setPw(""); qc.invalidateQueries({ queryKey: meQueryKey }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Section title="Two-factor authentication" actions={me.twoFactorEnabled ? <Pill tone="green">On</Pill> : <Pill tone="amber">Off</Pill>}>
      {me.twoFactorEnabled ? (
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); disable.mutate(); }}>
          <p className="flex items-start gap-2 text-sm"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-600" /> Sign-ins ask for a 6-digit code from your authenticator app.</p>
          <Field label="Confirm your password to turn it off" htmlFor="tf-pw"><Input id="tf-pw" type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
          <Button type="submit" variant="outline" className="text-red-700" disabled={!pw || disable.isPending}>{disable.isPending ? <Loader2 className="size-4 animate-spin" /> : <ShieldOff className="size-4" />} Turn off 2FA</Button>
        </form>
      ) : !setup ? (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">Protect your account with a code from an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password…) in addition to your password.</p>
          <Button onClick={() => begin.mutate()} disabled={begin.isPending}>{begin.isPending && <Loader2 className="size-4 animate-spin" />} Set up 2FA</Button>
        </div>
      ) : (
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); enable.mutate(); }}>
          <ol className="list-decimal space-y-1 pl-5 text-sm">
            <li>In your authenticator app, choose <em>Add account → Enter a setup key</em>.</li>
            <li>Enter the account <strong>{me.email}</strong> and the key below (time-based).</li>
            <li>Type the 6-digit code the app shows to finish.</li>
          </ol>
          <Field label="Setup key">
            <div className="flex gap-2"><Input readOnly value={setup.secret} className="font-mono tracking-wider" onFocus={(e) => e.target.select()} aria-label="Setup key" /><CopyButton value={setup.secret} /></div>
          </Field>
          <Field label="Or paste this otpauth link into an app that accepts it" hint="Keep this private — it is your second factor.">
            <div className="flex gap-2"><Input readOnly value={setup.otpauthUrl} className="font-mono text-xs" onFocus={(e) => e.target.select()} aria-label="otpauth URL" /><CopyButton value={setup.otpauthUrl} /></div>
          </Field>
          <Field label="6-digit code" htmlFor="tf-code"><Input id="tf-code" inputMode="numeric" autoComplete="one-time-code" maxLength={10} className="w-40 font-mono text-lg tracking-widest" value={code} onChange={(e) => setCode(e.target.value)} /></Field>
          <div className="flex gap-2">
            <Button type="submit" disabled={code.replace(/\s/g, "").length < 6 || enable.isPending}>{enable.isPending && <Loader2 className="size-4 animate-spin" />} Verify & turn on</Button>
            <Button type="button" variant="ghost" onClick={() => { setSetup(null); setCode(""); }}>Cancel</Button>
          </div>
        </form>
      )}
    </Section>
  );
}

function Sessions() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["auth", "sessions"], queryFn: () => api<SessionRow[]>("/auth/sessions") });
  const [revoke, setRevoke] = useState<SessionRow | null>(null);
  return (
    <Section title="Active sessions">
      {q.isLoading ? <LoadingRows rows={2} /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (
        <ul className="space-y-2">
          {q.data?.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm">
              <div>
                <div className="font-medium">{deviceLabel(s.userAgent)} {s.current && <Pill tone="green" className="ml-1">This device</Pill>}</div>
                <div className="text-xs text-muted-foreground">{s.ip ?? "unknown IP"} · signed in {dhakaDateTime(s.createdAt)} · active {ago(s.lastSeenAt)}</div>
              </div>
              {!s.current && <Button size="sm" variant="outline" onClick={() => setRevoke(s)}>Sign out</Button>}
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog open={!!revoke} onOpenChange={(o) => !o && setRevoke(null)} title="Sign out this device?" description={`${deviceLabel(revoke?.userAgent)} (${revoke?.ip ?? "unknown IP"}) will need to sign in again.`} confirmLabel="Sign out" destructive
        onConfirm={async () => { await api(`/auth/sessions/${revoke!.id}`, { method: "DELETE" }); toast.success("Session signed out"); qc.invalidateQueries({ queryKey: ["auth", "sessions"] }); }} />
    </Section>
  );
}

function LoginHistory() {
  const q = useQuery({ queryKey: ["auth", "login-history"], queryFn: () => api<LoginRow[]>("/auth/login-history") });
  return (
    <Section title="Recent sign-ins">
      {q.isLoading ? <LoadingRows rows={3} /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !q.data?.length ? <p className="text-sm text-muted-foreground">No sign-ins recorded.</p> : (
        <ul className="divide-y text-sm">
          {q.data.slice(0, 20).map((l) => (
            <li key={l.id} className="flex items-start justify-between gap-2 py-2">
              <div><div>{dhakaDateTime(l.createdAt)}</div><div className="text-xs text-muted-foreground">{deviceLabel(l.userAgent)} · {l.ip ?? "unknown IP"}</div></div>
              {l.success ? <Pill tone="green">success</Pill> : <Pill tone="red">{l.reason?.replace(/_/g, " ").toLowerCase() ?? "failed"}</Pill>}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-xs text-muted-foreground">Don&apos;t recognise a sign-in? Change your password and sign out other devices.</p>
    </Section>
  );
}

export default function ProfilePage() {
  const { me } = useAuth();
  return (
    <div className="space-y-4">
      <PageHeader title="Security & sessions" description={`${me.name} · ${me.email} · ${me.roles.map((r) => r.name).join(", ")}${me.lastLoginAt ? ` · last sign-in ${dhakaDateTime(me.lastLoginAt)}` : ""}`} />
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <ChangePassword />
          <TwoFactor />
        </div>
        <div className="space-y-4">
          <Sessions />
          <LoginHistory />
        </div>
      </div>
    </div>
  );
}
