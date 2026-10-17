"use client";

import Link from "next/link";
import { Suspense, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";
import { api, newIdempotencyKey, request } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { bdt, dhakaDay } from "@/lib/format";
import { SHIPMENT_TONE } from "@/lib/status";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDialog, EmptyState, ErrorState, Field, LoadingRows, NativeSelect, PageHeader, Pill, Section } from "@/components/admin/ui";
import { useCourierProviders } from "@/components/admin/orders/order-dialogs";
import { dhakaLocalToIso, fieldErrorsOf, Forbidden, isoToDhakaLocal, Stat, TableShell, TD, TH } from "@/components/admin/ops/common";
import type { AccountRow, SettlementRow, ShipmentRow } from "@/components/admin/ops/types";

interface Line { collected: string; deliveryFee: string; codCharge: string; returnFee: string }

const isMoney = (v: string) => /^\d+(\.\d{1,2})?$/.test(v.trim());
const n = (v: string) => (isMoney(v) ? Number(v) : 0);

function defaultLine(s: ShipmentRow): Line {
  const returned = s.status === "RETURNED";
  return {
    collected: returned ? "0" : String(s.collectedAmount ?? s.codAmount),
    deliveryFee: String(s.deliveryFee ?? "0"),
    codCharge: returned ? "0" : String(s.codCharge ?? "0"),
    returnFee: returned ? String(s.returnFee ?? "0") : "0",
  };
}

function NewSettlement() {
  const { can } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const providers = useCourierProviders();
  const accounts = useQuery({ queryKey: ["finance", "accounts"], queryFn: () => api<AccountRow[]>("/finance/accounts"), enabled: can("finance.view") });

  const [providerId, setProviderId] = useState(params.get("providerId") ?? "");
  const [accountId, setAccountId] = useState("");
  const [reference, setReference] = useState("");
  const [receivedAmount, setReceivedAmount] = useState("");
  const [receivedAt, setReceivedAt] = useState(() => isoToDhakaLocal(new Date().toISOString()));
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<Record<string, Line>>({});
  const [confirm, setConfirm] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [idempotencyKey] = useState(newIdempotencyKey);

  const candidates = useQuery({
    queryKey: ["shipments", "unsettled", providerId],
    queryFn: () => request<ShipmentRow[]>("/couriers/shipments", { query: { providerId, unsettled: "true", pageSize: 200 } }),
    enabled: !!providerId,
  });
  const rows = useMemo(() => (candidates.data?.data ?? []).filter((s) => !s.isReturn), [candidates.data]);
  const selectedIds = Object.keys(lines);
  const totals = useMemo(() => {
    let collected = 0, fees = 0;
    for (const l of Object.values(lines)) {
      collected += n(l.collected);
      fees += n(l.deliveryFee) + n(l.codCharge) + n(l.returnFee);
    }
    const net = collected - fees;
    return { collected, fees, net, variance: receivedAmount && isMoney(receivedAmount) ? Number(receivedAmount) - net : null };
  }, [lines, receivedAmount]);

  if (!can("accounts.reconcile")) return <Forbidden what="settlement recording" />;

  const toggle = (s: ShipmentRow, on: boolean) =>
    setLines((cur) => {
      const next = { ...cur };
      if (on) next[s.id] = defaultLine(s);
      else delete next[s.id];
      return next;
    });
  const allOn = rows.length > 0 && rows.every((s) => lines[s.id]);
  const setLine = (id: string, k: keyof Line, v: string) => setLines((cur) => ({ ...cur, [id]: { ...cur[id], [k]: v } }));
  const badLine = Object.values(lines).some((l) => !isMoney(l.collected) || !isMoney(l.deliveryFee) || !isMoney(l.codCharge) || !isMoney(l.returnFee));
  const ready = providerId && accountId && isMoney(receivedAmount) && receivedAt && selectedIds.length > 0 && !badLine;
  const provider = providers.data?.find((p) => p.id === providerId);

  const submit = async () => {
    setErrors({});
    try {
      const r = await api<SettlementRow & { variance: string }>("/couriers/settlements", {
        method: "POST",
        idempotencyKey,
        body: {
          providerId, accountId, reference: reference.trim() || undefined, receivedAmount: receivedAmount.trim(), receivedAt: dhakaLocalToIso(receivedAt),
          periodStart: periodStart ? dhakaLocalToIso(`${periodStart}T00:00`) : null, periodEnd: periodEnd ? dhakaLocalToIso(`${periodEnd}T23:59`) : null,
          note: note.trim() || null,
          items: selectedIds.map((shipmentId) => ({ shipmentId, ...Object.fromEntries(Object.entries(lines[shipmentId]).map(([k, v]) => [k, v.trim()])) })),
        },
      });
      toast.success(`Settlement ${r.reference} recorded${Number(r.variance) ? ` · variance ${bdt(r.variance)}` : ""}`);
      qc.invalidateQueries({ queryKey: ["settlements"] });
      qc.invalidateQueries({ queryKey: ["cod-summary"] });
      qc.invalidateQueries({ queryKey: ["shipments"] });
      router.push(`/admin/shipments/settlements?id=${r.id}`);
    } catch (e) {
      setErrors(fieldErrorsOf(e));
      throw e;
    }
  };

  return (
    <div className="space-y-4">
      <Link href="/admin/shipments/settlements" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> COD settlements
      </Link>
      <PageHeader title="Record courier settlement" description="Enter the payout you received and tick the parcels it covers. Fees entered here replace the estimated fees in the books." />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-4">
          <Section title="Payout">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Courier" htmlFor="provider" error={errors.providerId}>
                <NativeSelect id="provider" value={providerId} onChange={(e) => { setProviderId(e.target.value); setLines({}); }}>
                  <option value="">Choose courier…</option>
                  {providers.data?.filter((p) => p.implemented).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </NativeSelect>
              </Field>
              <Field label="Received into account" htmlFor="account" error={errors.accountId}>
                <NativeSelect id="account" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                  <option value="">Choose account…</option>
                  {accounts.data?.filter((a) => a.isActive).map((a) => <option key={a.id} value={a.id}>{a.name} ({a.type.replace("_", " ").toLowerCase()})</option>)}
                </NativeSelect>
              </Field>
              <Field label="Amount received (৳)" htmlFor="received" error={errors.receivedAmount ?? (receivedAmount && !isMoney(receivedAmount) ? "Enter an amount like 12500 or 12500.50" : undefined)}>
                <Input id="received" inputMode="decimal" value={receivedAmount} onChange={(e) => setReceivedAmount(e.target.value)} placeholder="0.00" />
              </Field>
              <Field label="Received at (Dhaka time)" htmlFor="receivedAt" error={errors.receivedAt}>
                <Input id="receivedAt" type="datetime-local" value={receivedAt} onChange={(e) => setReceivedAt(e.target.value)} />
              </Field>
              <Field label="Courier reference (optional)" htmlFor="ref" hint="Payout / invoice id from the courier. Left blank, one is generated." error={errors.reference}>
                <Input id="ref" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={100} />
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Period from" htmlFor="ps"><Input id="ps" type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} /></Field>
                <Field label="Period to" htmlFor="pe"><Input id="pe" type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} /></Field>
              </div>
              <div className="sm:col-span-2">
                <Field label="Note" htmlFor="note" error={errors.note}><Textarea id="note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} /></Field>
              </div>
            </div>
          </Section>

          <Section title={`Parcels in this payout${selectedIds.length ? ` (${selectedIds.length} selected)` : ""}`}>
            {!providerId ? (
              <p className="text-sm text-muted-foreground">Choose a courier to list its delivered and returned parcels that are not settled yet.</p>
            ) : candidates.isLoading ? (
              <LoadingRows rows={4} />
            ) : candidates.isError ? (
              <ErrorState error={candidates.error} onRetry={() => candidates.refetch()} />
            ) : rows.length === 0 ? (
              <EmptyState title="Nothing to settle" description={`${provider?.name ?? "This courier"} has no unsettled delivered or returned parcels.`} />
            ) : (
              <>
                {(candidates.data?.meta?.total ?? 0) > 200 && <p className="mb-2 text-xs text-amber-700">Showing the newest 200 unsettled parcels; record older ones in another settlement.</p>}
                <TableShell minWidth={900}>
                  <thead>
                    <tr>
                      <th className={cn(TH, "w-8")}><input type="checkbox" className="size-4" checked={allOn} onChange={(e) => setLines(e.target.checked ? Object.fromEntries(rows.map((s) => [s.id, lines[s.id] ?? defaultLine(s)])) : {})} aria-label="Select all parcels" /></th>
                      <th className={TH}>Order / tracking</th>
                      <th className={TH}>Status</th>
                      <th className={cn(TH, "text-right")}>COD</th>
                      <th className={TH}>Collected</th>
                      <th className={TH}>Delivery fee</th>
                      <th className={TH}>COD fee</th>
                      <th className={TH}>Return fee</th>
                      <th className={cn(TH, "text-right")}>Net</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((s) => {
                      const l = lines[s.id];
                      const net = l ? n(l.collected) - n(l.deliveryFee) - n(l.codCharge) - n(l.returnFee) : null;
                      const cell = (k: keyof Line) => (
                        <td className={TD}>
                          {l ? (
                            <Input
                              className={cn("h-8 w-24 text-right tabular-nums", !isMoney(l[k]) && "border-red-400")}
                              inputMode="decimal"
                              value={l[k]}
                              onChange={(e) => setLine(s.id, k, e.target.value)}
                              aria-label={`${k} for ${s.order.orderNumber}`}
                            />
                          ) : <span className="text-muted-foreground">—</span>}
                        </td>
                      );
                      return (
                        <tr key={s.id} className={cn(l && "bg-blue-50/40")}>
                          <td className={TD}><input type="checkbox" className="size-4" checked={!!l} onChange={(e) => toggle(s, e.target.checked)} aria-label={`Include ${s.order.orderNumber}`} /></td>
                          <td className={TD}>
                            <div className="font-medium">{s.order.orderNumber}</div>
                            <div className="font-mono text-xs text-muted-foreground">{s.trackingCode ?? s.consignmentId}</div>
                          </td>
                          <td className={TD}>
                            <Pill tone={SHIPMENT_TONE[s.status] ?? "gray"}>{s.status.replace(/_/g, " ").toLowerCase()}</Pill>
                            <div className="text-xs text-muted-foreground">{dhakaDay(s.deliveredAt ?? s.returnedAt)}</div>
                          </td>
                          <td className={cn(TD, "text-right tabular-nums")}>{bdt(s.codAmount)}</td>
                          {cell("collected")}
                          {cell("deliveryFee")}
                          {cell("codCharge")}
                          {cell("returnFee")}
                          <td className={cn(TD, "text-right font-medium tabular-nums")}>{net === null ? "—" : bdt(net)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </TableShell>
              </>
            )}
          </Section>
        </div>

        <div className="space-y-3 xl:sticky xl:top-20 xl:self-start">
          <Stat label="COD collected" value={bdt(totals.collected)} hint={`${selectedIds.length} parcel${selectedIds.length === 1 ? "" : "s"}`} />
          <Stat label="Courier fees" value={bdt(totals.fees)} />
          <Stat label="Net payable" value={bdt(totals.net)} />
          <Stat
            label="Variance (received − net)"
            value={totals.variance === null ? "—" : bdt(totals.variance)}
            tone={totals.variance === null ? "default" : Math.abs(totals.variance) < 0.005 ? "good" : "warn"}
            hint={totals.variance === null ? "enter the amount received" : Math.abs(totals.variance) < 0.005 ? "payout matches the parcels" : totals.variance < 0 ? "courier paid less than expected" : "courier paid more than expected"}
          />
          <Button className="w-full" disabled={!ready} onClick={() => setConfirm(true)}>Review & record</Button>
          {!ready && <p className="text-xs text-muted-foreground">Choose courier and account, enter the amount and date, and tick at least one parcel.</p>}
        </div>
      </div>

      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Record this settlement?"
        confirmLabel="Record settlement"
        description={
          <div className="space-y-1 text-sm">
            <p>{provider?.name}: {selectedIds.length} parcel{selectedIds.length === 1 ? "" : "s"}, net payable {bdt(totals.net)}, received {bdt(receivedAmount)}.</p>
            {totals.variance !== null && Math.abs(totals.variance) >= 0.005 && <p className="font-medium text-amber-700">Variance of {bdt(totals.variance)} will be recorded.</p>}
            <p className="text-muted-foreground">Each parcel can be settled only once; this posts the cash to the account and marks the orders reconciled. It cannot be undone from this screen.</p>
          </div>
        }
        onConfirm={submit}
      />
      {Object.keys(errors).length > 0 && <p className="text-sm text-red-600">Please fix the highlighted fields.</p>}
    </div>
  );
}

export default function NewSettlementPage() {
  return (
    <Suspense>
      <NewSettlement />
    </Suspense>
  );
}
