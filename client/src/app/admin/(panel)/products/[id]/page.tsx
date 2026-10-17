"use client";

import Link from "next/link";
import { use } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { dhakaDateTime } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { ErrorState, LoadingRows, PageHeader, Pill } from "@/components/admin/ui";
import { PRODUCT_STATUS, RequirePermission } from "@/components/admin/catalog/shared";
import { ProductForm, type ProductDetail } from "@/components/admin/catalog/product-form";

function EditProductPageInner({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { can } = useAuth();
  const q = useQuery({ queryKey: ["product", id], queryFn: () => api<ProductDetail>(`/products/${id}`) });
  return (
    <div className="space-y-4">
      <Link href="/admin/products" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Products
      </Link>
      {q.isLoading ? (
        <LoadingRows rows={8} />
      ) : q.isError || !q.data ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <>
          <PageHeader
            title={q.data.name}
            description={`${q.data.sku} · updated ${dhakaDateTime(q.data.updatedAt)}${can("products.manage") ? "" : " · read only"}`}
            actions={
              q.data.isPublished ? (
                <Button variant="outline" size="sm" asChild>
                  <a href={`/products/${q.data.slug}`} target="_blank" rel="noreferrer"><ExternalLink className="size-4" /> View in store</a>
                </Button>
              ) : undefined
            }
          >
            <div className="mt-2 flex gap-1">
              <Pill tone={PRODUCT_STATUS[q.data.status]?.tone ?? "gray"}>{PRODUCT_STATUS[q.data.status]?.label}</Pill>
              <Pill tone={q.data.isPublished ? "emerald" : "gray"}>{q.data.isPublished ? "Published" : "Hidden"}</Pill>
            </div>
          </PageHeader>
          <ProductForm key={q.data.updatedAt} product={q.data} />
        </>
      )}
    </div>
  );
}

export default function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <RequirePermission permission="products.view">
      <EditProductPageInner params={params} />
    </RequirePermission>
  );
}
