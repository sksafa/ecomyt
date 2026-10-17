"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ExternalLink, Loader2, Printer } from "lucide-react";
import { api, ApiError, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { bdt, dhakaDateTime } from "@/lib/format";
import { SHIPMENT_TONE } from "@/lib/status";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { ErrorState, Field, LoadingRows, NativeSelect, Pill } from "@/components/admin/ui";
import { useCourierProviders } from "@/components/admin/orders/order-dialogs";
import { JsonBlock } from "./common";
import type { ShipmentDetail, ShipmentRow } from "./types";

type ShipmentLike = Pick<ShipmentRow, "id" | "status" | "trackingCode" | "attempts" | "provider" | "order">;

export const LIVE = ["PENDING", "BOOKED", "PICKED_UP", "IN_TRANSIT", "RETURNING"];
export const canRetry = (s: Pick<ShipmentRow, "status">) => s.status === "PENDING" || s.status === "FAILED";
export const canCancel = (s: Pick<ShipmentRow, "status">) => s.status === "PENDING" || s.status === "BOOKED";
export const canSync = (s: Pick<ShipmentRow, "status">) => ["BOOKED", "PICKED_UP", "IN_TRANSIT", "RETURNING"].includes(s.status);

export function useShipmentMutations() {
  const qc = useQueryClient();
  const refresh = (id?: string) => {
    qc.invalidateQueries({ queryKey: ["shipments"] });
    if (id) qc.invalidateQueries({ queryKey: ["shipment", id] });
    qc.invalidateQueries({ queryKey: ["orders"] });
  };
  const retry = useMutation({
    mutationFn: (id: string) => api<ShipmentRow>(`/couriers/shipments/${id}/retry`, { method: "POST" }),
    onSuccess: (s, id) => {
      refresh(id);
      if (s.status === "FAILED") toast.error(`Booking failed again: ${s.lastError ?? "unknown error"}`);
      else if (s.status === "PENDING") toast.warning("Courier still unavailable – it will be retried automatically");
      else toast.success(`Booked${s.trackingCode ? ` · ${s.trackingCode}` : ""}`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const sync = useMutation({
    mutationFn: (id: string) => api<{ applied: boolean; status: string }>(`/couriers/shipments/${id}/sync`, { method: "POST" }),
    onSuccess: (r, id) => {
      refresh(id);
      toast.success(r.applied ? `Updated from courier: ${r.status.replace(/_/g, " ").toLowerCase()}` : `No change (${r.status.replace(/_/g, " ").toLowerCase()})`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return { retry, sync, refresh };
}

/** Courier label if the provider supports it; otherwise explains and links to our printable label. */
export function LabelDialog({ shipment, onClose }: { shipment: ShipmentLike | null; onClose: () => void }) {
  const q = useQuery({
    queryKey: ["shipment-label", shipment?.id],
    queryFn: () => api<{ supported: boolean; url: string | null; message?: string }>(`/couriers/shipments/${shipment!.id}/label`),
    enabled: !!shipment,
    retry: false,
    staleTime: 0,
  });
  return (
    <Dialog open={!!shipment} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Shipping label · {shipment?.order.orderNumber}</DialogTitle>
          <DialogDescription>{shipment?.provider.name}{shipment?.trackingCode ? ` · ${shipment.trackingCode}` : ""}</DialogDescription>
        </DialogHeader>
        {q.isLoading ? (
          <Loader2 className="mx-auto size-5 animate-spin" />
        ) : q.isError ? (
          <p className="text-sm text-red-600">{errorMessage(q.error)}</p>
        ) : q.data?.supported && q.data.url ? (
          <p className="text-sm">The courier generated a label for this parcel.</p>
        ) : (
          <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            {q.data?.message ?? "This courier does not provide labels through its API."} Our own printable label includes the order number, address, COD amount and tracking code.
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
          {shipment && (
            <Button variant={q.data?.supported ? "outline" : "default"} asChild>
              <a href={`/admin/orders/print?type=label&ids=${shipment.order.id}`} target="_blank" rel="noreferrer"><Printer className="size-4" /> Printable label</a>
            </Button>
          )}
          {q.data?.supported && q.data.url && (
            <Button asChild>
              <a href={q.data.url} target="_blank" rel="noreferrer"><ExternalLink className="size-4" /> Open courier label</a>
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Cancel at the courier, or (when the courier has no cancel API) record a cancellation done in the courier portal. */
export function CancelShipmentDialog({ shipment, onClose }: { shipment: ShipmentLike | null; onClose: () => void }) {
  const providers = useCourierProviders();
  const { refresh } = useShipmentMutations();
  const provider = providers.data?.find((p) => p.id === shipment?.provider.id);
  const noApi = !!provider && (!provider.capabilities?.cancelShipment || !provider.implemented);
  const [reason, setReason] = useState("");
  const [manualChoice, setManualChoice] = useState<boolean | null>(null);
  const [unsupportedMsg, setUnsupportedMsg] = useState<string | null>(null);
  // never-booked PENDING shipments with no attempts have nothing at the courier
  const nothingAtCourier = shipment?.status === "PENDING" && shipment.attempts === 0;
  const manual = manualChoice ?? (noApi && !nothingAtCourier) ?? false;
  const close = () => {
    setReason("");
    setManualChoice(null);
    setUnsupportedMsg(null);
    onClose();
  };
  const m = useMutation({
    mutationFn: () => api(`/couriers/shipments/${shipment!.id}/cancel`, { method: "POST", body: { reason: reason.trim(), manual } }),
    onSuccess: () => {
      toast.success(manual ? "Shipment marked cancelled" : "Shipment cancelled at the courier");
      refresh(shipment!.id);
      close();
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === "UNSUPPORTED") {
        setUnsupportedMsg(e.message);
        setManualChoice(true);
      } else toast.error(errorMessage(e));
    },
  });
  return (
    <Dialog open={!!shipment} onOpenChange={(o) => !o && close()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancel shipment · {shipment?.order.orderNumber}</DialogTitle>
          <DialogDescription>
            {shipment?.provider.name}
            {shipment?.trackingCode ? ` · ${shipment.trackingCode}` : ""}. The order goes back to “Ready to ship” so it can be re-booked.
          </DialogDescription>
        </DialogHeader>
        {(noApi || unsupportedMsg) && !nothingAtCourier && (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            {unsupportedMsg ?? `${shipment?.provider.name} does not offer cancellation through its API.`} First cancel the parcel in the courier&apos;s merchant portal,
            then use <strong>Mark cancelled manually</strong> to record it here. Nothing is sent to the courier in that case.
          </div>
        )}
        <Field label="Reason (required)" htmlFor="cancel-reason">
          <Textarea id="cancel-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Customer changed address" />
        </Field>
        <label className="flex items-start gap-2 text-sm">
          <Checkbox checked={manual} onCheckedChange={(v) => setManualChoice(!!v)} className="mt-0.5" />
          <span>
            Mark cancelled manually
            <span className="block text-xs text-muted-foreground">I already cancelled it in the courier portal (no API call).</span>
          </span>
        </label>
        <DialogFooter>
          <Button variant="outline" onClick={close}>Keep shipment</Button>
          <Button variant="destructive" disabled={reason.trim().length < 3 || m.isPending} onClick={() => m.mutate()}>
            {m.isPending && <Loader2 className="size-4 animate-spin" />} {manual ? "Mark cancelled" : "Cancel at courier"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const SIM_STATUSES = ["picked_up", "in_transit", "delivered", "partial_delivered", "returning", "returned", "cancelled", "hold"] as const;

/** Shipment detail: fees, event timeline and (couriers.manage) the redacted API call log. */
export function ShipmentDrawer({ id, onClose, onCancel, onLabel }: { id: string | null; onClose: () => void; onCancel: (s: ShipmentRow) => void; onLabel: (s: ShipmentRow) => void }) {
  const { can } = useAuth();
  const q = useQuery({ queryKey: ["shipment", id], queryFn: () => api<ShipmentDetail>(`/couriers/shipments/${id}`), enabled: !!id });
  const { retry, sync, refresh } = useShipmentMutations();
  const [sim, setSim] = useState<string>("delivered");
  const [simAmount, setSimAmount] = useState("");
  const simulate = useMutation({
    mutationFn: () => api("/couriers/mock/simulate", { method: "POST", body: { shipmentId: id, status: sim, ...(simAmount ? { collectedAmount: simAmount } : {}) } }),
    onSuccess: () => {
      toast.success("Sandbox webhook delivered");
      refresh(id!);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const s = q.data;
  return (
    <Sheet open={!!id} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>Shipment {s?.trackingCode ?? s?.consignmentId ?? ""}</SheetTitle>
          <SheetDescription>
            {s ? (
              <>
                <Link className="text-blue-700 hover:underline" href={`/admin/orders/${s.order.id}`}>{s.order.orderNumber}</Link> · {s.provider.name}
                {s.isReturn ? " · return parcel" : ""}
              </>
            ) : (
              "Loading…"
            )}
          </SheetDescription>
        </SheetHeader>
        <div className="space-y-5 px-4 pb-6">
          {q.isLoading ? (
            <LoadingRows rows={4} />
          ) : q.isError || !s ? (
            <ErrorState error={q.error} onRetry={() => q.refetch()} />
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Pill tone={SHIPMENT_TONE[s.status] ?? "gray"}>{s.status.replace(/_/g, " ").toLowerCase()}</Pill>
                {s.rawStatus && <span className="text-xs text-muted-foreground">courier: {s.rawStatus}</span>}
                {s.settlementItem && <Pill tone="green">Settled</Pill>}
              </div>
              {s.lastError && <p className="rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-800">Last error: {s.lastError}{s.nextRetryAt ? ` · next retry ${dhakaDateTime(s.nextRetryAt)}` : ""}</p>}
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <dt className="text-muted-foreground">COD amount</dt><dd className="text-right tabular-nums">{bdt(s.codAmount)}</dd>
                <dt className="text-muted-foreground">Collected</dt><dd className="text-right tabular-nums">{s.collectedAmount ? bdt(s.collectedAmount) : "—"}</dd>
                <dt className="text-muted-foreground">Delivery fee</dt><dd className="text-right tabular-nums">{s.deliveryFee ? bdt(s.deliveryFee) : "—"}</dd>
                <dt className="text-muted-foreground">COD charge</dt><dd className="text-right tabular-nums">{s.codCharge ? bdt(s.codCharge) : "—"}</dd>
                <dt className="text-muted-foreground">Return fee</dt><dd className="text-right tabular-nums">{s.returnFee ? bdt(s.returnFee) : "—"}</dd>
                <dt className="text-muted-foreground">Weight</dt><dd className="text-right">{s.weightGrams ? `${s.weightGrams} g` : "—"}</dd>
                <dt className="text-muted-foreground">Consignment</dt><dd className="truncate text-right font-mono text-xs">{s.consignmentId ?? "—"}</dd>
                <dt className="text-muted-foreground">Booking attempts</dt><dd className="text-right">{s.attempts}</dd>
                <dt className="text-muted-foreground">Booked</dt><dd className="text-right">{dhakaDateTime(s.bookedAt)}</dd>
                <dt className="text-muted-foreground">Picked up</dt><dd className="text-right">{dhakaDateTime(s.pickedUpAt)}</dd>
                <dt className="text-muted-foreground">Delivered</dt><dd className="text-right">{dhakaDateTime(s.deliveredAt)}</dd>
                <dt className="text-muted-foreground">Returned</dt><dd className="text-right">{dhakaDateTime(s.returnedAt)}</dd>
              </dl>
              <div className="flex flex-wrap gap-2">
                {can("shipments.book") && canRetry(s) && (
                  <Button size="sm" onClick={() => retry.mutate(s.id)} disabled={retry.isPending}>{retry.isPending && <Loader2 className="size-4 animate-spin" />} Retry booking</Button>
                )}
                {canSync(s) && (
                  <Button size="sm" variant="outline" onClick={() => sync.mutate(s.id)} disabled={sync.isPending}>{sync.isPending && <Loader2 className="size-4 animate-spin" />} Sync status</Button>
                )}
                <Button size="sm" variant="outline" onClick={() => onLabel(s)}><Printer className="size-4" /> Label</Button>
                {can("shipments.cancel") && canCancel(s) && <Button size="sm" variant="outline" className="text-red-700" onClick={() => onCancel(s)}>Cancel…</Button>}
              </div>

              <section>
                <h3 className="mb-2 text-sm font-semibold">Courier events</h3>
                {s.events.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No courier status updates received yet.</p>
                ) : (
                  <ol className="relative space-y-3 border-l pl-5">
                    {s.events.map((e) => (
                      <li key={e.id} className="relative">
                        <span className={`absolute -left-[26px] top-1.5 size-2.5 rounded-full ${e.applied ? "bg-blue-600" : "bg-slate-300"}`} />
                        <div className="flex flex-wrap items-center gap-2 text-sm">
                          <span className="font-medium">{e.rawStatus}</span>
                          {e.mappedStatus && <Pill tone={SHIPMENT_TONE[e.mappedStatus] ?? "gray"}>{e.mappedStatus.replace(/_/g, " ").toLowerCase()}</Pill>}
                          {!e.applied && <span className="text-xs text-muted-foreground">(not applied{e.error ? `: ${e.error}` : ""})</span>}
                        </div>
                        <div className="text-xs text-muted-foreground">{dhakaDateTime(e.occurredAt)} · received {dhakaDateTime(e.receivedAt)}</div>
                      </li>
                    ))}
                  </ol>
                )}
              </section>

              {s.provider.code === "MOCK" && can("shipments.book") && LIVE.includes(s.status) && (
                <section className="rounded-lg border border-dashed p-3">
                  <h3 className="text-sm font-semibold">Sandbox: simulate courier update</h3>
                  <p className="mb-2 text-xs text-muted-foreground">Sends a signed webhook through the real pipeline. Only for the sandbox courier.</p>
                  <div className="flex flex-wrap gap-2">
                    <NativeSelect className="w-44" value={sim} onChange={(e) => setSim(e.target.value)} aria-label="Simulated status">
                      {SIM_STATUSES.map((x) => <option key={x} value={x}>{x.replace(/_/g, " ")}</option>)}
                    </NativeSelect>
                    {sim === "delivered" || sim === "partial_delivered" ? (
                      <Input className="h-9 w-36" inputMode="decimal" placeholder={`Collected (${s.codAmount})`} value={simAmount} onChange={(e) => setSimAmount(e.target.value)} aria-label="Collected amount" />
                    ) : null}
                    <Button size="sm" variant="outline" className="h-9" onClick={() => simulate.mutate()} disabled={simulate.isPending}>Simulate</Button>
                  </div>
                </section>
              )}

              {s.apiLogs && (
                <section>
                  <h3 className="mb-2 text-sm font-semibold">Courier API log <span className="font-normal text-muted-foreground">(personal data redacted)</span></h3>
                  {s.apiLogs.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No API calls recorded.</p>
                  ) : (
                    <div className="space-y-2">
                      {s.apiLogs.map((l) => (
                        <details key={l.id} className="rounded-md border bg-white text-sm">
                          <summary className="flex cursor-pointer flex-wrap items-center gap-2 px-3 py-2">
                            <Pill tone={l.success ? "green" : "red"}>{l.statusCode ?? (l.success ? "OK" : "ERR")}</Pill>
                            <span className="font-medium">{l.operation}</span>
                            <span className="text-xs text-muted-foreground">{dhakaDateTime(l.createdAt)}{l.durationMs !== null ? ` · ${l.durationMs} ms` : ""}</span>
                            {l.error && <span className="w-full text-xs text-red-700">{l.error}</span>}
                          </summary>
                          <div className="space-y-2 border-t p-3">
                            <div className="text-xs font-semibold text-muted-foreground">Request</div>
                            <JsonBlock value={l.request} />
                            <div className="text-xs font-semibold text-muted-foreground">Response</div>
                            <JsonBlock value={l.response} />
                          </div>
                        </details>
                      ))}
                    </div>
                  )}
                </section>
              )}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
