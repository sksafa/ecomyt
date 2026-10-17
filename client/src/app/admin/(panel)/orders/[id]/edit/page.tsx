"use client";

import { use } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { OrderDetail } from "@/lib/types";
import { ErrorState, LoadingRows, PageHeader } from "@/components/admin/ui";
import { OrderForm } from "@/components/admin/orders/order-form";

export default function EditOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const q = useQuery({ queryKey: ["order", id], queryFn: () => api<OrderDetail>(`/orders/${id}`) });
  if (q.isLoading) return <LoadingRows />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  return (
    <>
      <PageHeader title={`Edit ${q.data!.orderNumber}`} description="Item changes re-reserve stock. Every change is recorded in the audit log." />
      <OrderForm existing={q.data!} />
    </>
  );
}
