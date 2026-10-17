"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { FlaskConical, Loader2 } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { bdt } from "@/lib/format";
import { LAST_ORDER_STORE } from "./checkout-form";
import { Container } from "./ui";

type Outcome = "success" | "fail" | "cancel";

/**
 * Development-only stand-in for the payment gateway page. The server signs and validates the
 * sandbox callback (POST /payments/sandbox/complete) – the browser never sees the signing secret.
 */
export function SandboxPay() {
  const sp = useSearchParams();
  const router = useRouter();
  const tranId = sp.get("tran_id") ?? "";
  const amount = sp.get("amount") ?? "";
  const [busy, setBusy] = useState<Outcome | null>(null);
  const [error, setError] = useState<string | null>(null);

  const finish = async (outcome: Outcome) => {
    setBusy(outcome);
    setError(null);
    try {
      const { redirectUrl } = await api<{ redirectUrl: string }>("/payments/sandbox/complete", { method: "POST", body: { tranId, outcome } });
      let url = redirectUrl;
      try {
        const last = JSON.parse(sessionStorage.getItem(LAST_ORDER_STORE) ?? "null") as { order: string; phone: string } | null;
        if (last && url.includes(`order=${encodeURIComponent(last.order)}`)) url += `&phone=${last.phone}`;
      } catch {
        // phone is optional – the status page asks for it
      }
      router.replace(url);
    } catch (e) {
      setBusy(null);
      setError(errorMessage(e));
    }
  };

  if (!tranId) {
    return (
      <Container className="max-w-md py-16 text-center">
        <p className="font-display text-2xl">No payment to process</p>
        <p className="mt-2 text-sm text-muted-foreground">This page is opened by the test gateway after checkout.</p>
      </Container>
    );
  }

  return (
    <Container className="max-w-md py-10">
      <div className="rounded-xl border-2 border-dashed border-amber-400 bg-amber-50 p-4 text-amber-900" role="note">
        <p className="flex items-center gap-2 font-semibold">
          <FlaskConical className="size-5" aria-hidden /> Sandbox gateway: development only
        </p>
        <p className="mt-1 text-sm">No real money moves. This simulates the online payment page so the order flow can be tested end to end.</p>
      </div>
      <div className="mt-6 rounded-xl border border-border bg-card p-6 text-center">
        <p className="text-xs uppercase tracking-widest text-muted-foreground">Amount to pay</p>
        <p className="mt-1 text-4xl font-semibold tabular-nums text-primary">{bdt(amount)}</p>
        <p className="mt-2 font-mono text-xs text-muted-foreground">Transaction {tranId}</p>
        <div className="mt-6 grid gap-3">
          <button type="button" disabled={!!busy} onClick={() => finish("success")} className="flex h-12 items-center justify-center gap-2 rounded-md bg-emerald-700 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-60">
            {busy === "success" && <Loader2 className="size-4 animate-spin" aria-hidden />} Simulate successful payment
          </button>
          <button type="button" disabled={!!busy} onClick={() => finish("fail")} className="flex h-12 items-center justify-center gap-2 rounded-md border border-red-300 bg-card text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-60">
            {busy === "fail" && <Loader2 className="size-4 animate-spin" aria-hidden />} Simulate failure
          </button>
          <button type="button" disabled={!!busy} onClick={() => finish("cancel")} className="flex h-11 items-center justify-center gap-2 rounded-md text-sm text-muted-foreground hover:bg-secondary disabled:opacity-60">
            {busy === "cancel" && <Loader2 className="size-4 animate-spin" aria-hidden />} Cancel
          </button>
        </div>
        {error && (
          <p className="mt-4 text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
      </div>
    </Container>
  );
}
