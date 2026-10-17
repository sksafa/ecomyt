"use client";

import Link from "next/link";
import { use } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { EmptyState, ErrorState, LoadingRows, PageHeader } from "@/components/admin/ui";
import { PurchaseOrderForm, type PurchaseOrder } from "@/components/admin/catalog/po-form";

export default function EditPurchaseOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { can } = useAuth();
  const q = useQuery({ queryKey: ["purchase-order", id], queryFn: () => api<PurchaseOrder>(`/purchase-orders/${id}`) });
  return (
    <div className="space-y-4">
      <Link href={`/admin/purchasing/${id}`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> Back to purchase order</Link>
      {q.isLoading ? <LoadingRows rows={6} /> : q.isError || !q.data ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (
        <>
          <PageHeader title={`Edit ${q.data.number}`} description="Only drafts can be edited. Items are replaced with what you save here." />
          {!can("purchasing.manage") ? (
            <EmptyState title="Read-only" description="This needs the purchasing.manage permission." />
          ) : q.data.status !== "DRAFT" ? (
            <EmptyState title="This purchase order is no longer a draft" description="Ordered purchase orders can't be edited. Cancel it and create a new one if nothing has been received." />
          ) : (
            <PurchaseOrderForm po={q.data} />
          )}
        </>
      )}
    </div>
  );
}
