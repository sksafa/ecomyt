import type { Metadata } from "next";
import { Suspense } from "react";
import { SandboxPay } from "@/components/store/sandbox-pay";

export const metadata: Metadata = { title: "Test payment", robots: { index: false, follow: false } };

export default function SandboxPayPage() {
  return (
    <Suspense>
      <SandboxPay />
    </Suspense>
  );
}
