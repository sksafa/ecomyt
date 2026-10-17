import type { Metadata } from "next";
import { CheckoutView } from "@/components/store/checkout-view";

export const metadata: Metadata = { title: "Checkout", robots: { index: false } };

export default function CheckoutPage() {
  return <CheckoutView />;
}
