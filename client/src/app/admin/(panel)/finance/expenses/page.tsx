"use client";

import { PageGate } from "@/components/admin/analytics/gate";
import { ExpensesScreen } from "@/components/admin/analytics/expenses";

export default function ExpensesPage() {
  return (
    <PageGate anyOf={["expenses.view"]}>
      <ExpensesScreen />
    </PageGate>
  );
}
