"use client";

import { PageGate } from "@/components/admin/analytics/gate";
import { PaymentsScreen } from "@/components/admin/analytics/payments";

export default function PaymentsPage() {
  return (
    <PageGate anyOf={["payments.view"]}>
      <PaymentsScreen />
    </PageGate>
  );
}
