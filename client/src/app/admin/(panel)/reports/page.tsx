"use client";

import { PageGate } from "@/components/admin/analytics/gate";
import { ReportsScreen } from "@/components/admin/analytics/reports";

export default function ReportsPage() {
  return (
    <PageGate anyOf={["reports.view"]}>
      <ReportsScreen />
    </PageGate>
  );
}
