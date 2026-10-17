"use client";

import { PageHeader } from "@/components/admin/ui";
import { OrderForm } from "@/components/admin/orders/order-form";

export default function NewOrderPage() {
  return (
    <>
      <PageHeader title="Create order" description="Manual order (phone, Facebook inbox, WhatsApp…). Stock is reserved when you save." />
      <OrderForm />
    </>
  );
}
