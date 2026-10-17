"use client";

import { PageGate } from "@/components/admin/analytics/gate";
import { MarketingScreen } from "@/components/admin/analytics/marketing";

export default function MarketingPage() {
  return (
    <PageGate anyOf={["marketing.view"]}>
      <MarketingScreen />
    </PageGate>
  );
}
