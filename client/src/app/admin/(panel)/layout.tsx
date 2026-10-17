"use client";

import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { AuthGate } from "@/lib/auth";
import { AdminShell } from "@/components/admin/shell";

export default function PanelLayout({ children }: { children: ReactNode }) {
  return (
    <AuthGate
      fallback={
        <div className="flex min-h-screen items-center justify-center text-muted-foreground">
          <Loader2 className="size-6 animate-spin" />
        </div>
      }
    >
      <AdminShell>{children}</AdminShell>
    </AuthGate>
  );
}
