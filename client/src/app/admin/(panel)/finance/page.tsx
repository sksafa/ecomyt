"use client";

import { PageGate } from "@/components/admin/analytics/gate";
import { ProfitLossScreen } from "@/components/admin/analytics/profit-loss";

export default function ProfitLossPage() {
  return (
    <PageGate anyOf={["finance.view"]}>
      <ProfitLossScreen />
    </PageGate>
  );
}
