"use client";

import { Suspense, useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, MoreHorizontal, Plus, Search, ShieldCheck, X } from "lucide-react";
import { api, errorMessage, request } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { ago, dhakaDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ConfirmDialog, EmptyState, ErrorState, Field, LoadingRows, NativeSelect, PageHeader, Pagination, Pill } from "@/components/admin/ui";
import { deviceLabel, fieldErrorsOf, Forbidden, TableShell, TD, TH, useUrlFilters } from "@/components/admin/ops/common";
import { RolesTab, useRoles, type Role } from "@/components/admin/ops/roles-tab";

interface StaffUser {
  id: string; email: string; name: string; phone: string | null; status: "ACTIVE" | "DISABLED"; twoFactorEnabled: boolean;
  lastLoginAt: string | null; lockedUntil: string | null; createdAt: string; roles: { id: string; key: string; name: string }[];
}
interface SessionRow { id: string; ip: string | null; userAgent: string | null; createdAt: string; lastSeenAt: string; expiresAt: string }
interface LoginRow { id: string; email: string; ip: string | null; userAgent: string | null; success: boolean; reason: string | null; createdAt: string }

const passwordOk = (p: string) => p.length >= 8 && /[A-Za-z]/.test(p) && /\d/.test(p);
const PASSWORD_HINT = "At least 8 characters with letters and numbers.";

function RolePicker({ roles, value, onChange, canSuper }: { roles: Role[]; value: string[]; onChange: (v: string[]) => void; canSuper: boolean }) {
  return (
    <div className="grid max-h-56 gap-1.5 overflow-y-auto rounded-md border p-2 sm:grid-cols-2">
      {roles.map((r) => {
        const disabled = r.key === "super_admin" && !canSuper;
        return (
          <label key={r.id} className={cn("flex items-start gap-2 rounded p-1 text-sm", disabled ? "opacity-50" : "cursor-pointer hover:bg-muted/50")} title={disabled ? "Only a Super Admin can grant this role" : r.description ?? undefined}>
            <Checkbox className="mt-0.5" checked={value.includes(r.id)} disabled={disabled} onCheckedChange={(c) => onChange(c ? [...value, r.id] : value.filter((x) => x !== r.id))} />
            <span>{r.name}<span className="block text-[11px] text-muted-foreground">{r.permissions.length} permissions</span></span>
          </label>
        );
      })}
    </div>
  );
}

function UserDialog({ user, onClose }: { user: StaffUser | "new"; onClose: () => void }) {
  const qc = useQueryClient();
  const { me } = useAuth();
  const roles = useRoles();
  const isNew = user === "new";
  const isSelf = !isNew && user.id === me.id;
  const canSuper = me.roles.some((r) => r.key === "super_admin");
  const [f, setF] = useState({
    email: isNew ? "" : user.email, name: isNew ? "" : user.name, phone: isNew ? "" : user.phone ?? "", password: "",
    status: isNew ? "ACTIVE" : user.status, roleIds: isNew ? [] : user.roles.map((r) => r.id), unlock: false,
  });
  const [errs, setErrs] = useState<Record<string, string>>({});
  const locked = !isNew && user.lockedUntil && new Date(user.lockedUntil) > new Date();
  const m = useMutation({
    mutationFn: () =>
      isNew
        ? api("/users", { method: "POST", body: { email: f.email.trim(), name: f.name.trim(), phone: f.phone.trim() || null, password: f.password, roleIds: f.roleIds } })
        : api(`/users/${user.id}`, { method: "PATCH", body: { name: f.name.trim(), phone: f.phone.trim() || null, ...(isSelf ? {} : { status: f.status, roleIds: f.roleIds }), ...(f.unlock ? { unlock: true } : {}) } }),
    onSuccess: () => {
      toast.success(isNew ? "Staff account created" : "Saved");
      qc.invalidateQueries({ queryKey: ["users"] });
      qc.invalidateQueries({ queryKey: ["roles"] });
      onClose();
    },
    onError: (e) => {
      setErrs(fieldErrorsOf(e));
      toast.error(errorMessage(e));
    },
  });
  const valid = f.name.trim().length >= 2 && f.roleIds.length > 0 && (!isNew || (/^\S+@\S+\.\S+$/.test(f.email) && passwordOk(f.password)));
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{isNew ? "New staff account" : `Edit ${user.name}`}</DialogTitle>
          {!isNew && <DialogDescription>{user.email}</DialogDescription>}
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          {isNew && <Field label="Email" htmlFor="u-email" error={errs.email}><Input id="u-email" type="email" autoComplete="off" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>}
          <Field label="Full name" htmlFor="u-name" error={errs.name}><Input id="u-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Phone (optional)" htmlFor="u-phone" error={errs.phone}><Input id="u-phone" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
          {isNew && <Field label="Initial password" htmlFor="u-pw" hint={PASSWORD_HINT} error={errs.password ?? (f.password && !passwordOk(f.password) ? PASSWORD_HINT : undefined)}><Input id="u-pw" type="password" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>}
          {!isNew && (
            <Field label="Status" htmlFor="u-status" hint={isSelf ? "You can't disable yourself" : "Disabling signs them out everywhere"}>
              <NativeSelect id="u-status" value={f.status} disabled={isSelf} onChange={(e) => setF({ ...f, status: e.target.value as StaffUser["status"] })}>
                <option value="ACTIVE">Active</option>
                <option value="DISABLED">Disabled</option>
              </NativeSelect>
            </Field>
          )}
        </div>
        <Field label="Roles" error={errs.roleIds} hint={isSelf ? "You can't change your own roles" : undefined}>
          {roles.isLoading ? <LoadingRows rows={1} /> : <div className={cn(isSelf && "pointer-events-none opacity-60")}><RolePicker roles={roles.data ?? []} value={f.roleIds} onChange={(roleIds) => setF({ ...f, roleIds })} canSuper={canSuper} /></div>}
        </Field>
        {locked && (
          <label className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-sm text-amber-900">
            <Checkbox checked={f.unlock} onCheckedChange={(c) => setF({ ...f, unlock: !!c })} /> Locked after failed sign-ins until {dhakaDateTime(user.lockedUntil)} — unlock now
          </label>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={!valid || m.isPending} onClick={() => m.mutate()}>{m.isPending && <Loader2 className="size-4 animate-spin" />} {isNew ? "Create account" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ResetPasswordDialog({ user, onClose }: { user: StaffUser; onClose: () => void }) {
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const m = useMutation({
    mutationFn: () => api(`/users/${user.id}/reset-password`, { method: "POST", body: { password: pw } }),
    onSuccess: () => { toast.success(`Password reset; ${user.name} was signed out everywhere`); onClose(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reset password · {user.name}</DialogTitle>
          <DialogDescription>Share the new password with them securely. All their sessions are signed out.</DialogDescription>
        </DialogHeader>
        <Field label="New password" htmlFor="rp-1" hint={PASSWORD_HINT} error={pw && !passwordOk(pw) ? PASSWORD_HINT : undefined}><Input id="rp-1" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
        <Field label="Repeat password" htmlFor="rp-2" error={pw2 && pw2 !== pw ? "Passwords don't match" : undefined}><Input id="rp-2" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} /></Field>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant="destructive" disabled={!passwordOk(pw) || pw !== pw2 || m.isPending} onClick={() => m.mutate()}>{m.isPending && <Loader2 className="size-4 animate-spin" />} Reset password</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ActivitySheet({ user, onClose }: { user: StaffUser | null; onClose: () => void }) {
  const { can } = useAuth();
  const sessions = useQuery({ queryKey: ["users", user?.id, "sessions"], queryFn: () => api<SessionRow[]>(`/users/${user!.id}/sessions`), enabled: !!user && can("users.manage") });
  const logins = useQuery({ queryKey: ["users", user?.id, "logins"], queryFn: () => api<LoginRow[]>(`/users/${user!.id}/login-history`), enabled: !!user && can("audit.view") });
  return (
    <Sheet open={!!user} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{user?.name}</SheetTitle>
          <SheetDescription>{user?.email} · last sign-in {user?.lastLoginAt ? ago(user.lastLoginAt) : "never"}</SheetDescription>
        </SheetHeader>
        <div className="space-y-5 px-4 pb-6">
          <section>
            <h3 className="mb-2 text-sm font-semibold">Active sessions</h3>
            {!can("users.manage") ? <p className="text-sm text-muted-foreground">Needs “Manage staff accounts”.</p> : sessions.isLoading ? <LoadingRows rows={2} /> : sessions.isError ? <ErrorState error={sessions.error} /> : !sessions.data?.length ? <p className="text-sm text-muted-foreground">Not signed in anywhere.</p> : (
              <ul className="space-y-2 text-sm">
                {sessions.data.map((s) => (
                  <li key={s.id} className="rounded-md border p-2">
                    <div className="font-medium">{deviceLabel(s.userAgent)}</div>
                    <div className="text-xs text-muted-foreground">{s.ip ?? "unknown IP"} · signed in {dhakaDateTime(s.createdAt)} · active {ago(s.lastSeenAt)}</div>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section>
            <h3 className="mb-2 text-sm font-semibold">Sign-in history</h3>
            {!can("audit.view") ? <p className="text-sm text-muted-foreground">Needs “View audit and login logs”.</p> : logins.isLoading ? <LoadingRows rows={3} /> : logins.isError ? <ErrorState error={logins.error} /> : !logins.data?.length ? <p className="text-sm text-muted-foreground">No sign-ins recorded.</p> : (
              <ul className="divide-y text-sm">
                {logins.data.map((l) => (
                  <li key={l.id} className="flex items-start justify-between gap-2 py-1.5">
                    <div>
                      <div>{dhakaDateTime(l.createdAt)}</div>
                      <div className="text-xs text-muted-foreground">{deviceLabel(l.userAgent)} · {l.ip ?? "unknown IP"}</div>
                    </div>
                    {l.success ? <Pill tone="green">success</Pill> : <Pill tone="red">{l.reason?.replace(/_/g, " ").toLowerCase() ?? "failed"}</Pill>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function UsersTab() {
  const { can, me } = useAuth();
  const qc = useQueryClient();
  const [filters, setFilters] = useUrlFilters(["tab", "search", "status", "page"] as const);
  const [search, setSearch] = useState(filters.search ?? "");
  const [edit, setEdit] = useState<StaffUser | "new" | null>(null);
  const [reset, setReset] = useState<StaffUser | null>(null);
  const [revoke, setRevoke] = useState<StaffUser | null>(null);
  const [activity, setActivity] = useState<StaffUser | null>(null);
  const query = { search: filters.search, status: filters.status, page: filters.page ?? 1, pageSize: 25 };
  const list = useQuery({ queryKey: ["users", "list", query], queryFn: () => request<StaffUser[]>("/users", { query }), placeholderData: keepPreviousData });
  const manage = can("users.manage");
  const rows = list.data?.data ?? [];
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2 rounded-xl border bg-white p-3">
        <form className="relative min-w-56 flex-1" onSubmit={(e) => { e.preventDefault(); setFilters({ search: search.trim() }); }}>
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="h-9 rounded-full pl-9" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name or email" aria-label="Search staff" />
          {filters.search && <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" onClick={() => { setSearch(""); setFilters({ search: undefined }); }} aria-label="Clear search"><X className="size-4" /></button>}
        </form>
        <NativeSelect className="w-36" aria-label="Status" value={filters.status ?? ""} onChange={(e) => setFilters({ status: e.target.value })}>
          <option value="">All statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="DISABLED">Disabled</option>
        </NativeSelect>
        {manage && <Button size="sm" className="h-9" onClick={() => setEdit("new")}><Plus className="size-4" /> Add staff</Button>}
      </div>
      {list.isLoading ? <LoadingRows rows={5} /> : list.isError ? <ErrorState error={list.error} onRetry={() => list.refetch()} /> : rows.length === 0 ? <EmptyState title="No staff match" /> : (
        <TableShell minWidth={820}>
          <thead>
            <tr>
              <th className={TH}>Name</th>
              <th className={TH}>Roles</th>
              <th className={TH}>Status</th>
              <th className={TH}>2FA</th>
              <th className={TH}>Last sign-in</th>
              <th className={cn(TH, "w-12")}><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((u) => {
              const locked = u.lockedUntil && new Date(u.lockedUntil) > new Date();
              return (
                <tr key={u.id} className="hover:bg-muted/30">
                  <td className={TD}>
                    <div className="font-medium">{u.name}{u.id === me.id && <span className="ml-1 text-xs text-muted-foreground">(you)</span>}</div>
                    <div className="text-xs text-muted-foreground">{u.email}{u.phone ? ` · ${u.phone}` : ""}</div>
                  </td>
                  <td className={TD}><div className="flex flex-wrap gap-1">{u.roles.map((r) => <Pill key={r.id} tone={r.key === "super_admin" ? "amber" : "indigo"}>{r.name}</Pill>)}</div></td>
                  <td className={TD}>
                    {u.status === "ACTIVE" ? <Pill tone="green">Active</Pill> : <Pill tone="gray">Disabled</Pill>}
                    {locked && <div className="mt-1"><Pill tone="red">Locked</Pill></div>}
                  </td>
                  <td className={TD}>{u.twoFactorEnabled ? <ShieldCheck className="size-4 text-emerald-600" aria-label="2FA on" /> : <span className="text-xs text-muted-foreground">off</span>}</td>
                  <td className={cn(TD, "whitespace-nowrap text-xs")}>{u.lastLoginAt ? <>{dhakaDateTime(u.lastLoginAt)}<div className="text-muted-foreground">{ago(u.lastLoginAt)}</div></> : "never"}</td>
                  <td className={TD}>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="size-8" aria-label={`Actions for ${u.name}`}><MoreHorizontal className="size-4" /></Button></DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {manage && <DropdownMenuItem onClick={() => setEdit(u)}>Edit details & roles</DropdownMenuItem>}
                        <DropdownMenuItem onClick={() => setActivity(u)}>Sessions & sign-in history</DropdownMenuItem>
                        {manage && u.id !== me.id && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => setReset(u)}>Reset password…</DropdownMenuItem>
                            <DropdownMenuItem className="text-red-700" onClick={() => setRevoke(u)}>Sign out everywhere…</DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </TableShell>
      )}
      <Pagination meta={list.data?.meta} onPage={(p) => setFilters({ page: String(p) }, false)} />
      {edit && <UserDialog user={edit} onClose={() => setEdit(null)} />}
      {reset && <ResetPasswordDialog user={reset} onClose={() => setReset(null)} />}
      <ActivitySheet user={activity} onClose={() => setActivity(null)} />
      <ConfirmDialog
        open={!!revoke}
        onOpenChange={(o) => !o && setRevoke(null)}
        title={`Sign ${revoke?.name} out everywhere?`}
        description="All their active sessions end immediately; they can sign in again with their password."
        destructive
        confirmLabel="Sign out"
        onConfirm={async () => {
          const r = await api<{ revoked: number }>(`/users/${revoke!.id}/sessions/revoke-all`, { method: "POST" });
          toast.success(`${r.revoked} session${r.revoked === 1 ? "" : "s"} revoked`);
          qc.invalidateQueries({ queryKey: ["users", revoke!.id] });
        }}
      />
    </div>
  );
}

function StaffScreen() {
  const { can } = useAuth();
  const [filters, setFilters] = useUrlFilters(["tab"] as const);
  if (!can("users.view")) return <Forbidden what="staff accounts" />;
  const tab = filters.tab === "roles" ? "roles" : "users";
  return (
    <div className="space-y-4">
      <PageHeader title="Staff & roles" description="Who can sign in to the admin, and what each role is allowed to do." />
      <div className="flex gap-1 border-b" role="tablist">
        {(["users", "roles"] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setFilters({ tab: t === "users" ? undefined : t })}
            className={cn("border-b-2 px-4 py-2 text-sm font-medium", tab === t ? "border-blue-600 text-blue-700" : "border-transparent text-muted-foreground hover:text-foreground")}>
            {t === "users" ? "Staff" : "Roles & permissions"}
          </button>
        ))}
      </div>
      {tab === "users" ? <UsersTab /> : <RolesTab />}
    </div>
  );
}

export default function StaffPage() {
  return <Suspense><StaffScreen /></Suspense>;
}
