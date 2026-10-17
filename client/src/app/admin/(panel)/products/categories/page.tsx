"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, FolderTree, Layers, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { api, ApiError, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ConfirmDialog, EmptyState, ErrorState, Field, IconAction, LoadingRows, NativeSelect, PageHeader, Pill, Section } from "@/components/admin/ui";
import { ImageUploadButton } from "@/components/admin/catalog/product-form";
import { TableShell, Thumb, td, th, useCategories, useCollections, type Category, type Collection, RequirePermission } from "@/components/admin/catalog/shared";

type Kind = "category" | "collection";
interface Draft { id?: string; name: string; slug: string; parentId: string; description: string; imageUrl: string; sortOrder: string; isActive: boolean; isFeatured: boolean }
const emptyDraft: Draft = { name: "", slug: "", parentId: "", description: "", imageUrl: "", sortOrder: "0", isActive: true, isFeatured: false };

function CategoriesPageInner() {
  const { can } = useAuth();
  const canManage = can("products.manage");
  const categories = useCategories();
  const collections = useCollections();
  const [editing, setEditing] = useState<{ kind: Kind; draft: Draft } | null>(null);
  const [deleting, setDeleting] = useState<{ kind: Kind; id: string; name: string; count: number } | null>(null);
  const qc = useQueryClient();

  const catName = (id: string | null) => categories.data?.find((c) => c.id === id)?.name;
  // parents first, children right after their parent
  const ordered = (() => {
    const all = categories.data ?? [];
    const roots = all.filter((c) => !c.parentId || !all.some((p) => p.id === c.parentId));
    return roots.flatMap((r) => [r, ...all.filter((c) => c.parentId === r.id)]);
  })();

  return (
    <div className="space-y-4">
      <Link href="/admin/products" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Products
      </Link>
      <PageHeader title="Categories & collections" description="Categories organise the catalog (one per product); collections group products for campaigns and the storefront (many per product)." />

      <Section
        title={<span className="flex items-center gap-2"><FolderTree className="size-4" /> Categories</span>}
        actions={canManage && <Button size="sm" onClick={() => setEditing({ kind: "category", draft: emptyDraft })}><Plus className="size-4" /> New category</Button>}
      >
        {categories.isLoading ? <LoadingRows rows={3} /> : categories.isError ? <ErrorState error={categories.error} onRetry={() => categories.refetch()} /> : !ordered.length ? (
          <EmptyState title="No categories yet" />
        ) : (
          <TableShell className="border-0">
            <thead><tr><th className={th}>Name</th><th className={th}>Parent</th><th className={th}>Slug</th><th className={cn(th, "text-right")}>Products</th><th className={th}>Status</th><th className={cn(th, "text-right")}>Actions</th></tr></thead>
            <tbody>
              {ordered.map((c) => (
                <tr key={c.id}>
                  <td className={td}>
                    <div className={cn("flex items-center gap-2", c.parentId && "pl-6")}>
                      <Thumb src={c.imageUrl} alt={c.name} size={32} />
                      <span className="font-medium">{c.name}</span>
                    </div>
                  </td>
                  <td className={cn(td, "text-muted-foreground")}>{catName(c.parentId) ?? "—"}</td>
                  <td className={cn(td, "font-mono text-xs text-muted-foreground")}>{c.slug}</td>
                  <td className={cn(td, "text-right tabular-nums")}>
                    <Link className="text-blue-700 hover:underline" href={`/admin/products?categoryId=${c.id}`}>{c._count?.products ?? 0}</Link>
                  </td>
                  <td className={td}><Pill tone={c.isActive ? "green" : "gray"}>{c.isActive ? "Active" : "Hidden"}</Pill></td>
                  <td className={cn(td, "whitespace-nowrap text-right")}>
                    {canManage && (
                      <>
                        <IconAction label="Edit" onClick={() => setEditing({ kind: "category", draft: fromCategory(c) })}><Pencil className="size-4" /></IconAction>
                        <IconAction label="Delete" onClick={() => setDeleting({ kind: "category", id: c.id, name: c.name, count: c._count?.products ?? 0 })}><Trash2 className="size-4" /></IconAction>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </TableShell>
        )}
      </Section>

      <Section
        title={<span className="flex items-center gap-2"><Layers className="size-4" /> Collections</span>}
        actions={canManage && <Button size="sm" onClick={() => setEditing({ kind: "collection", draft: emptyDraft })}><Plus className="size-4" /> New collection</Button>}
      >
        {collections.isLoading ? <LoadingRows rows={3} /> : collections.isError ? <ErrorState error={collections.error} onRetry={() => collections.refetch()} /> : !collections.data?.length ? (
          <EmptyState title="No collections yet" description="e.g. Eid Collection, New Arrivals, Bridal." />
        ) : (
          <TableShell className="border-0">
            <thead><tr><th className={th}>Name</th><th className={th}>Slug</th><th className={cn(th, "text-right")}>Products</th><th className={th}>Status</th><th className={cn(th, "text-right")}>Actions</th></tr></thead>
            <tbody>
              {collections.data.map((c) => (
                <tr key={c.id}>
                  <td className={td}><div className="flex items-center gap-2"><Thumb src={c.imageUrl} alt={c.name} size={32} /><span className="font-medium">{c.name}</span></div></td>
                  <td className={cn(td, "font-mono text-xs text-muted-foreground")}>{c.slug}</td>
                  <td className={cn(td, "text-right tabular-nums")}><Link className="text-blue-700 hover:underline" href={`/admin/products?collectionId=${c.id}`}>{c._count?.products ?? 0}</Link></td>
                  <td className={td}>
                    <div className="flex gap-1">
                      <Pill tone={c.isActive ? "green" : "gray"}>{c.isActive ? "Active" : "Hidden"}</Pill>
                      {c.isFeatured && <Pill tone="amber">Featured</Pill>}
                    </div>
                  </td>
                  <td className={cn(td, "whitespace-nowrap text-right")}>
                    {canManage && (
                      <>
                        <IconAction label="Edit" onClick={() => setEditing({ kind: "collection", draft: fromCollection(c) })}><Pencil className="size-4" /></IconAction>
                        <IconAction label="Delete" onClick={() => setDeleting({ kind: "collection", id: c.id, name: c.name, count: c._count?.products ?? 0 })}><Trash2 className="size-4" /></IconAction>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </TableShell>
        )}
      </Section>

      {editing && <EditDialog kind={editing.kind} initial={editing.draft} categories={categories.data ?? []} onClose={() => setEditing(null)} />}

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete ${deleting?.kind} “${deleting?.name ?? ""}”?`}
        description={
          deleting?.kind === "category"
            ? deleting.count > 0
              ? `This category still has ${deleting.count} product(s). Move them to another category first — the server will refuse otherwise.`
              : "This empty category will be removed permanently."
            : `The collection is removed; its ${deleting?.count ?? 0} product(s) are kept and simply leave the collection.`
        }
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          await api(`/${deleting!.kind === "category" ? "categories" : "collections"}/${deleting!.id}`, { method: "DELETE" });
          toast.success(`${deleting!.kind === "category" ? "Category" : "Collection"} deleted`);
          qc.invalidateQueries({ queryKey: [deleting!.kind === "category" ? "categories" : "collections"] });
        }}
      />
    </div>
  );
}

const fromCategory = (c: Category): Draft => ({ id: c.id, name: c.name, slug: c.slug, parentId: c.parentId ?? "", description: c.description ?? "", imageUrl: c.imageUrl ?? "", sortOrder: String(c.sortOrder), isActive: c.isActive, isFeatured: false });
const fromCollection = (c: Collection): Draft => ({ id: c.id, name: c.name, slug: c.slug, parentId: "", description: c.description ?? "", imageUrl: c.imageUrl ?? "", sortOrder: String(c.sortOrder), isActive: c.isActive, isFeatured: c.isFeatured });

function EditDialog({ kind, initial, categories, onClose }: { kind: Kind; initial: Draft; categories: Category[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [d, setD] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const base = kind === "category" ? "/categories" : "/collections";
  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: d.name.trim(), slug: d.slug.trim() || undefined, description: d.description.trim() || null, imageUrl: d.imageUrl.trim() || null,
        sortOrder: Number(d.sortOrder) || 0, isActive: d.isActive,
        ...(kind === "category" ? { parentId: d.parentId || null } : { isFeatured: d.isFeatured }),
      };
      return api(d.id ? `${base}/${d.id}` : base, { method: d.id ? "PUT" : "POST", body });
    },
    onSuccess: () => {
      toast.success(`${kind === "category" ? "Category" : "Collection"} saved`);
      qc.invalidateQueries({ queryKey: [kind === "category" ? "categories" : "collections"] });
      onClose();
    },
    onError: (e) => {
      if (e instanceof ApiError) setErrors(e.status === 409 ? { slug: e.message } : e.fieldErrors);
      toast.error(errorMessage(e));
    },
  });
  // a category can't be its own parent or a child of its own child
  const parentOptions = categories.filter((c) => c.id !== d.id && c.parentId !== d.id);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>{d.id ? "Edit" : "New"} {kind}</DialogTitle></DialogHeader>
        <form
          id="cat-form"
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (d.name.trim().length < 2) return setErrors({ name: "Name must be at least 2 characters" });
            setErrors({});
            save.mutate();
          }}
        >
          <Field label="Name" htmlFor="cf-name" error={errors.name}><Input id="cf-name" value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} autoFocus /></Field>
          <Field label="Slug" htmlFor="cf-slug" error={errors.slug} hint="Leave empty to generate from the name"><Input id="cf-slug" value={d.slug} onChange={(e) => setD({ ...d, slug: e.target.value })} /></Field>
          {kind === "category" && (
            <Field label="Parent category" htmlFor="cf-parent" error={errors.parentId}>
              <NativeSelect id="cf-parent" value={d.parentId} onChange={(e) => setD({ ...d, parentId: e.target.value })}>
                <option value="">None (top level)</option>
                {parentOptions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </NativeSelect>
            </Field>
          )}
          <Field label="Description" htmlFor="cf-desc" error={errors.description}><Textarea id="cf-desc" rows={3} value={d.description} onChange={(e) => setD({ ...d, description: e.target.value })} /></Field>
          <Field label="Image" htmlFor="cf-img" error={errors.imageUrl}>
            <div className="flex items-center gap-2">
              <Thumb src={d.imageUrl || null} alt="" size={36} />
              <Input id="cf-img" value={d.imageUrl} onChange={(e) => setD({ ...d, imageUrl: e.target.value })} placeholder="/uploads/…" />
              <ImageUploadButton compact onUploaded={(url) => setD((x) => ({ ...x, imageUrl: url }))} />
            </div>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Sort order" htmlFor="cf-sort" error={errors.sortOrder}><Input id="cf-sort" inputMode="numeric" value={d.sortOrder} onChange={(e) => setD({ ...d, sortOrder: e.target.value.replace(/[^\d-]/g, "") })} /></Field>
            <div className="flex flex-col justify-end gap-2 pb-1">
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4" checked={d.isActive} onChange={(e) => setD({ ...d, isActive: e.target.checked })} /> Active</label>
              {kind === "collection" && <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4" checked={d.isFeatured} onChange={(e) => setD({ ...d, isFeatured: e.target.checked })} /> Featured</label>}
            </div>
          </div>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="cat-form" disabled={save.isPending}>{save.isPending && <Loader2 className="size-4 animate-spin" />} Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function CategoriesPage() {
  return (
    <RequirePermission permission="products.view">
      <CategoriesPageInner  />
    </RequirePermission>
  );
}
