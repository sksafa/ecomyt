"use client";

import { PageGate } from "@/components/admin/analytics/gate";
import { DashboardScreen } from "@/components/admin/analytics/dashboard";

export default function DashboardPage() {
  return (
    <PageGate anyOf={["dashboard.view"]}>
      <DashboardScreen />
    </PageGate>
  );
}
