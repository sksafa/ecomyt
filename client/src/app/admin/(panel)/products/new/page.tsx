"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { EmptyState, PageHeader } from "@/components/admin/ui";
import { ProductForm } from "@/components/admin/catalog/product-form";

export default function NewProductPage() {
  const { can } = useAuth();
  return (
    <div className="space-y-4">
      <Link href="/admin/products" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Products
      </Link>
      <PageHeader title="New product" description="Add details, photos, variants and costs. Save as draft until it is ready to sell." />
      {can("products.manage") ? <ProductForm /> : <EmptyState title="You can't create products" description="Ask an admin for the products.manage permission." />}
    </div>
  );
}
