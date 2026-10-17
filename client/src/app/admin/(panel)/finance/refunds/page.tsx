"use client";

import { PageGate } from "@/components/admin/analytics/gate";
import { RefundsScreen } from "@/components/admin/analytics/refunds";

export default function RefundsPage() {
  return (
    <PageGate anyOf={["payments.view"]}>
      <RefundsScreen />
    </PageGate>
  );
}
