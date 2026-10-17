"use client";

import { PageGate } from "@/components/admin/analytics/gate";
import { AccountsScreen } from "@/components/admin/analytics/accounts";

export default function AccountsPage() {
  return (
    <PageGate anyOf={["finance.view"]}>
      <AccountsScreen />
    </PageGate>
  );
}
