"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Lock, Pencil, Plus, Trash2 } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { titleCase } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ConfirmDialog, ErrorState, Field, LoadingRows, Pill } from "@/components/admin/ui";
import { fieldErrorsOf } from "./common";

export interface Role { id: string; key: string; name: string; description: string | null; isSystem: boolean; permissions: string[]; userCount: number }
type Catalog = Record<string, { key: string; description: string }[]>;

export const useRoles = () => useQuery({ queryKey: ["roles"], queryFn: () => api<Role[]>("/roles") });
const useCatalog = () => useQuery({ queryKey: ["roles", "permissions"], queryFn: () => api<Catalog>("/roles/permissions"), staleTime: Infinity });

/** Grouped checkbox matrix with a select-all per module. */
export function PermissionMatrix({ catalog, value, onChange, readOnly }: { catalog: Catalog; value: Set<string>; onChange: (v: Set<string>) => void; readOnly?: boolean }) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {Object.entries(catalog).map(([module, perms]) => {
        const on = perms.filter((p) => value.has(p.key)).length;
        const all = on === perms.length;
        return (
          <fieldset key={module} className="rounded-lg border p-3">
            <legend className="px-1">
              <label className="flex items-center gap-2 text-sm font-semibold">
                <Checkbox
                  checked={all ? true : on ? "indeterminate" : false}
                  disabled={readOnly}
                  onCheckedChange={() => {
                    const next = new Set(value);
                    for (const p of perms) {
                      if (all) next.delete(p.key);
                      else next.add(p.key);
                    }
                    onChange(next);
                  }}
                  aria-label={`All ${module} permissions`}
                />
                {titleCase(module)} <span className="font-normal text-muted-foreground">{on}/{perms.length}</span>
              </label>
            </legend>
            <ul className="space-y-1.5">
              {perms.map((p) => (
                <li key={p.key}>
                  <label className={cn("flex items-start gap-2 text-sm", readOnly ? "cursor-default" : "cursor-pointer")}>
                    <Checkbox
                      className="mt-0.5"
                      checked={value.has(p.key)}
                      disabled={readOnly}
                      onCheckedChange={(c) => {
                        const next = new Set(value);
                        if (c) next.add(p.key);
                        else next.delete(p.key);
                        onChange(next);
                      }}
                    />
                    <span>
                      {p.description}
                      <span className="block font-mono text-[11px] text-muted-foreground">{p.key}</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
        );
      })}
    </div>
  );
}

function RoleDialog({ role, onClose }: { role: Role | "new"; onClose: () => void }) {
  const qc = useQueryClient();
  const { can } = useAuth();
  const catalog = useCatalog();
  const isNew = role === "new";
  const locked = !isNew && role.key === "super_admin";
  const readOnly = locked || !can("roles.manage");
  const [key, setKey] = useState(isNew ? "" : role.key);
  const [name, setName] = useState(isNew ? "" : role.name);
  const [description, setDescription] = useState(isNew ? "" : role.description ?? "");
  const [perms, setPerms] = useState<Set<string>>(new Set(isNew ? [] : role.permissions));
  const [errs, setErrs] = useState<Record<string, string>>({});
  const m = useMutation({
    mutationFn: () =>
      isNew
        ? api("/roles", { method: "POST", body: { key, name: name.trim(), description: description.trim() || undefined, permissions: [...perms] } })
        : api(`/roles/${role.id}`, { method: "PATCH", body: { name: name.trim(), description: description.trim(), ...(locked ? {} : { permissions: [...perms] }) } }),
    onSuccess: () => {
      toast.success(isNew ? "Role created" : "Role updated");
      qc.invalidateQueries({ queryKey: ["roles"] });
      qc.invalidateQueries({ queryKey: ["users"] });
      onClose();
    },
    onError: (e) => {
      setErrs(fieldErrorsOf(e));
      toast.error(errorMessage(e));
    },
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{isNew ? "New custom role" : `${readOnly ? "" : "Edit "}${role.name}`}</DialogTitle>
          <DialogDescription>
            {locked ? "The Super Admin role always has every permission; it cannot be changed." : `${perms.size} permission${perms.size === 1 ? "" : "s"} selected. Changes apply to everyone with this role on their next request.`}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Key" htmlFor="role-key" hint={isNew ? "lowercase_with_underscores, can't change later" : undefined} error={errs.key}>
            <Input id="role-key" value={key} disabled={!isNew} onChange={(e) => setKey(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_"))} />
          </Field>
          <Field label="Name" htmlFor="role-name" error={errs.name}><Input id="role-name" value={name} disabled={readOnly && !isNew} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Description" htmlFor="role-desc" error={errs.description}><Input id="role-desc" value={description} disabled={readOnly && !isNew} onChange={(e) => setDescription(e.target.value)} /></Field>
        </div>
        {catalog.isLoading ? <LoadingRows rows={3} /> : catalog.isError ? <ErrorState error={catalog.error} onRetry={() => catalog.refetch()} /> : (
          <PermissionMatrix catalog={catalog.data!} value={perms} onChange={setPerms} readOnly={readOnly} />
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{readOnly ? "Close" : "Cancel"}</Button>
          {!readOnly && (
            <Button disabled={m.isPending || name.trim().length < 2 || (isNew && !/^[a-z][a-z0-9_]{2,40}$/.test(key))} onClick={() => m.mutate()}>
              {m.isPending && <Loader2 className="size-4 animate-spin" />} {isNew ? "Create role" : "Save role"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function RolesTab() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const roles = useRoles();
  const [edit, setEdit] = useState<Role | "new" | null>(null);
  const [del, setDel] = useState<Role | null>(null);
  const manage = can("roles.manage");
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">Roles bundle permissions. A user’s access is the union of all their roles.</p>
        {manage && <Button size="sm" onClick={() => setEdit("new")}><Plus className="size-4" /> New role</Button>}
      </div>
      {roles.isLoading ? <LoadingRows rows={5} /> : roles.isError ? <ErrorState error={roles.error} onRetry={() => roles.refetch()} /> : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {roles.data?.map((r) => (
            <div key={r.id} className="flex flex-col rounded-xl border bg-white p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="flex items-center gap-1.5 font-semibold">{r.key === "super_admin" && <Lock className="size-4 text-amber-600" />}{r.name}</h3>
                  <div className="font-mono text-[11px] text-muted-foreground">{r.key}</div>
                </div>
                {r.isSystem ? <Pill tone="gray">Built-in</Pill> : <Pill tone="violet">Custom</Pill>}
              </div>
              {r.description && <p className="mt-1 text-sm text-muted-foreground">{r.description}</p>}
              <div className="mt-3 flex gap-4 text-sm">
                <span><strong className="tabular-nums">{r.permissions.length}</strong> permissions</span>
                <span><strong className="tabular-nums">{r.userCount}</strong> user{r.userCount === 1 ? "" : "s"}</span>
              </div>
              <div className="mt-auto flex gap-2 pt-3">
                <Button size="sm" variant="outline" onClick={() => setEdit(r)}>
                  {manage && r.key !== "super_admin" ? <><Pencil className="size-4" /> Edit permissions</> : "View permissions"}
                </Button>
                {manage && !r.isSystem && (
                  <Button size="sm" variant="ghost" className="text-red-700" disabled={r.userCount > 0} title={r.userCount > 0 ? "Remove it from all users first" : undefined} onClick={() => setDel(r)}>
                    <Trash2 className="size-4" /> Delete
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      {edit && <RoleDialog role={edit} onClose={() => setEdit(null)} />}
      <ConfirmDialog
        open={!!del}
        onOpenChange={(o) => !o && setDel(null)}
        title={`Delete role “${del?.name}”?`}
        description="This cannot be undone. The role has no users."
        destructive
        confirmLabel="Delete role"
        onConfirm={async () => {
          await api(`/roles/${del!.id}`, { method: "DELETE" });
          toast.success("Role deleted");
          qc.invalidateQueries({ queryKey: ["roles"] });
        }}
      />
    </div>
  );
}
