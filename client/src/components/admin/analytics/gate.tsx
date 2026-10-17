"use client";

import { Suspense, type ReactNode } from "react";
import { Lock } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { EmptyState } from "@/components/admin/ui";

/** Page-level permission gate (any of the listed permissions) + Suspense for useSearchParams. */
export function PageGate({ anyOf, children }: { anyOf: string[]; children: ReactNode }) {
  const { canAny } = useAuth();
  if (!canAny(...anyOf)) {
    return <EmptyState icon={<Lock className="size-8" />} title="You don't have access to this page" description={`Ask an owner for one of: ${anyOf.join(", ")}.`} />;
  }
  return <Suspense>{children}</Suspense>;
}
