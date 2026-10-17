import type { Metadata } from "next";
import { Suspense } from "react";
import { OrderStatusView } from "@/components/store/order-status";

export const metadata: Metadata = { title: "Track your order", description: "Check your Bent & Bound order status with your order number and mobile number.", robots: { index: false } };

export default function OrderStatusPage() {
  return (
    <Suspense>
      <OrderStatusView />
    </Suspense>
  );
}
