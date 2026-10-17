"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { EmptyState, PageHeader } from "@/components/admin/ui";
import { PurchaseOrderForm } from "@/components/admin/catalog/po-form";

export default function NewPurchaseOrderPage() {
  const { can } = useAuth();
  return (
    <div className="space-y-4">
      <Link href="/admin/purchasing" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> Purchase orders</Link>
      <PageHeader title="New purchase order" description="Saved as a draft. Mark it as ordered once sent to the supplier." />
      {can("purchasing.manage") ? <PurchaseOrderForm /> : <EmptyState title="You can't create purchase orders" description="This needs the purchasing.manage permission." />}
    </div>
  );
}
