"use client";

import Link from "next/link";
import { Suspense, useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Archive, Package, Pencil, Plus, RefreshCw, Star } from "lucide-react";
import { api, request } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { bdt } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, EmptyState, ErrorState, IconAction, LoadingRows, NativeSelect, PageHeader, Pagination, Pill } from "@/components/admin/ui";
import { PRODUCT_STATUS, SearchBox, TableShell, Thumb, td, th, useCategories, useCollections, useUrlFilters, RequirePermission } from "@/components/admin/catalog/shared";
import type { ProductDetail } from "@/components/admin/catalog/product-form";

const KEYS = ["search", "status", "categoryId", "collectionId", "published", "lowStock", "sort", "page"] as const;

function ProductsScreen() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const { filters, setFilters } = useUrlFilters(KEYS);
  const [search, setSearch] = useState(filters.search ?? "");
  const [archiving, setArchiving] = useState<ProductDetail | null>(null);
  const categories = useCategories();
  const collections = useCollections();

  const query = {
    search: filters.search, status: filters.status, categoryId: filters.categoryId, collectionId: filters.collectionId,
    published: filters.published, lowStock: filters.lowStock, sort: filters.sort ?? "-createdAt", page: filters.page ?? 1, pageSize: 25,
  };
  const list = useQuery({ queryKey: ["products", "list", query], queryFn: () => request<ProductDetail[]>("/products", { query }), placeholderData: keepPreviousData });
  const canManage = can("products.manage");
  const anyFilter = KEYS.some((k) => k !== "page" && k !== "sort" && filters[k]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Products"
        description="Catalog, prices and stock across variants."
        actions={
          <>
            <Button variant="outline" size="sm" asChild><Link href="/admin/products/categories">Categories & collections</Link></Button>
            {canManage && <Button size="sm" asChild><Link href="/admin/products/new"><Plus className="size-4" /> New product</Link></Button>}
          </>
        }
      />
      <div className="grid gap-2 rounded-xl border bg-white p-3 sm:grid-cols-2 lg:flex lg:flex-wrap lg:items-center">
        <SearchBox className="sm:col-span-2" value={search} onChange={setSearch} onSubmit={(v) => setFilters({ search: v })} placeholder="Name, SKU or barcode" label="Search products" />
        <NativeSelect className="lg:w-36" aria-label="Status" value={filters.status ?? ""} onChange={(e) => setFilters({ status: e.target.value })}>
          <option value="">Draft + active</option>
          <option value="ACTIVE">Active</option>
          <option value="DRAFT">Draft</option>
          <option value="ARCHIVED">Archived</option>
        </NativeSelect>
        <NativeSelect className="lg:w-44" aria-label="Category" value={filters.categoryId ?? ""} onChange={(e) => setFilters({ categoryId: e.target.value })}>
          <option value="">All categories</option>
          {categories.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </NativeSelect>
        <NativeSelect className="lg:w-44" aria-label="Collection" value={filters.collectionId ?? ""} onChange={(e) => setFilters({ collectionId: e.target.value })}>
          <option value="">All collections</option>
          {collections.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </NativeSelect>
        <NativeSelect className="lg:w-36" aria-label="Published" value={filters.published ?? ""} onChange={(e) => setFilters({ published: e.target.value })}>
          <option value="">Any visibility</option>
          <option value="true">Published</option>
          <option value="false">Not published</option>
        </NativeSelect>
        <label className="flex h-9 items-center gap-2 rounded-md border px-3 text-sm">
          <input type="checkbox" className="size-4" checked={filters.lowStock === "true"} onChange={(e) => setFilters({ lowStock: e.target.checked ? "true" : undefined })} />
          Low stock only
        </label>
        <NativeSelect className="lg:w-40" aria-label="Sort" value={filters.sort ?? "-createdAt"} onChange={(e) => setFilters({ sort: e.target.value })}>
          <option value="-createdAt">Newest first</option>
          <option value="-updatedAt">Recently updated</option>
          <option value="name">Name A–Z</option>
        </NativeSelect>
        <Button variant="outline" size="icon" className="size-9" onClick={() => list.refetch()} aria-label="Refresh">
          <RefreshCw className={cn("size-4", list.isFetching && "animate-spin")} />
        </Button>
      </div>

      {list.isLoading ? (
        <LoadingRows rows={6} />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : !list.data?.data.length ? (
        <EmptyState
          icon={<Package className="size-8" />}
          title="No products match"
          description={anyFilter ? "Try clearing the search or filters." : "Add your first product to start selling."}
          action={canManage && !anyFilter ? <Button size="sm" asChild><Link href="/admin/products/new">New product</Link></Button> : undefined}
        />
      ) : (
        <TableShell className={cn(list.isFetching && "opacity-70")}>
          <thead>
            <tr>
              <th className={th}>Product</th>
              <th className={th}>Category</th>
              <th className={cn(th, "text-right")}>Price</th>
              <th className={cn(th, "text-right")}>Stock</th>
              <th className={th}>Status</th>
              <th className={cn(th, "text-right")}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {list.data.data.map((p) => {
              const active = p.variants.filter((v) => v.isActive);
              const low = active.filter((v) => v.lowStock).length;
              return (
                <tr key={p.id} className="hover:bg-muted/30">
                  <td className={td}>
                    <div className="flex items-center gap-3">
                      <Thumb src={p.images[0]?.url} alt={p.images[0]?.alt ?? p.name} size={44} />
                      <div className="min-w-0">
                        <Link href={`/admin/products/${p.id}`} className="font-medium text-blue-700 hover:underline">{p.name}</Link>
                        {p.isFeatured && <Star className="ml-1 inline size-3.5 fill-amber-400 text-amber-500" aria-label="Featured" />}
                        <p className="text-xs text-muted-foreground">{p.sku} · {active.length} variant{active.length === 1 ? "" : "s"}</p>
                      </div>
                    </div>
                  </td>
                  <td className={cn(td, "text-muted-foreground")}>{p.category?.name ?? "—"}</td>
                  <td className={cn(td, "whitespace-nowrap text-right tabular-nums")}>
                    {p.salePrice ? (
                      <>
                        <span className="font-medium">{bdt(p.salePrice)}</span>
                        <span className="block text-xs text-muted-foreground line-through">{bdt(p.regularPrice)}</span>
                      </>
                    ) : (
                      <span className="font-medium">{bdt(p.regularPrice)}</span>
                    )}
                  </td>
                  <td className={cn(td, "whitespace-nowrap text-right tabular-nums")}>
                    <span className={cn("font-medium", low > 0 && "text-amber-700")}>{p.stock.available}</span> available
                    <span className="block text-xs text-muted-foreground">{p.stock.reserved} reserved{low > 0 ? ` · ${low} low` : ""}</span>
                  </td>
                  <td className={td}>
                    <div className="flex flex-wrap gap-1">
                      <Pill tone={PRODUCT_STATUS[p.status]?.tone ?? "gray"}>{PRODUCT_STATUS[p.status]?.label ?? p.status}</Pill>
                      {p.status !== "ARCHIVED" && <Pill tone={p.isPublished ? "emerald" : "gray"}>{p.isPublished ? "Published" : "Hidden"}</Pill>}
                    </div>
                  </td>
                  <td className={cn(td, "whitespace-nowrap text-right")}>
                    <IconAction label={canManage ? "Edit" : "View"} href={`/admin/products/${p.id}`}><Pencil className="size-4" /></IconAction>
                    {canManage && p.status !== "ARCHIVED" && (
                      <IconAction label="Archive" onClick={() => setArchiving(p)}><Archive className="size-4" /></IconAction>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </TableShell>
      )}
      <Pagination meta={list.data?.meta} onPage={(p) => setFilters({ page: String(p) }, false)} />

      <ConfirmDialog
        open={!!archiving}
        onOpenChange={(o) => !o && setArchiving(null)}
        title={`Archive “${archiving?.name ?? ""}”?`}
        description="The product is unpublished and hidden from the store and product pickers. Order history and stock records are kept; you can restore it later by changing its status."
        confirmLabel="Archive"
        destructive
        onConfirm={async () => {
          await api(`/products/${archiving!.id}/archive`, { method: "POST" });
          toast.success("Product archived");
          qc.invalidateQueries({ queryKey: ["products"] });
        }}
      />
    </div>
  );
}

function ProductsPageInner() {
  return (
    <Suspense>
      <ProductsScreen />
    </Suspense>
  );
}

export default function ProductsPage() {
  return (
    <RequirePermission permission="products.view">
      <ProductsPageInner  />
    </RequirePermission>
  );
}
