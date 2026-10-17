"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { dhakaDateTime } from "@/lib/format";
import { ORDER_STATUS, type OrderStatus } from "@/lib/status";
import type { CourierProvider, OrderDetail, OrderListItem } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Field, NativeSelect, Pill } from "@/components/admin/ui";

type Target = Pick<OrderListItem, "id" | "orderNumber" | "status"> | null;

export function StatusHistoryDialog({ order, onClose }: { order: Target; onClose: () => void }) {
  const q = useQuery({ queryKey: ["order", order?.id], queryFn: () => api<OrderDetail>(`/orders/${order!.id}`), enabled: !!order });
  return (
    <Dialog open={!!order} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>History · {order?.orderNumber}</DialogTitle>
        </DialogHeader>
        {q.isLoading && <Loader2 className="mx-auto size-5 animate-spin" />}
        <ol className="relative max-h-[60vh] space-y-4 overflow-y-auto border-l pl-5">
          {q.data?.statusHistory.map((h) => (
            <li key={h.id} className="relative">
              <span className="absolute -left-[26px] top-1 size-2.5 rounded-full bg-primary" />
              <div className="flex flex-wrap items-center gap-2">
                <Pill tone={ORDER_STATUS[h.toStatus].tone}>{ORDER_STATUS[h.toStatus].en}</Pill>
                <span className="text-xs text-muted-foreground">{dhakaDateTime(h.createdAt)}</span>
              </div>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {h.source === "COURIER" ? "Courier update" : h.source === "STOREFRONT" ? "Website" : h.user?.name ?? "System"}
                {h.reason ? ` — ${h.reason}` : ""}
              </p>
            </li>
          ))}
        </ol>
      </DialogContent>
    </Dialog>
  );
}

/** Change status through allowed transitions only (server validates again). */
export function StatusDialog({ order, onClose }: { order: Target; onClose: () => void }) {
  const qc = useQueryClient();
  const detail = useQuery({ queryKey: ["order", order?.id], queryFn: () => api<OrderDetail>(`/orders/${order!.id}`), enabled: !!order });
  const [to, setTo] = useState<string>("");
  const [reason, setReason] = useState("");
  const options = detail.data?.nextStatuses.filter((s) => s.allowed) ?? [];
  const blocked = detail.data?.nextStatuses.filter((s) => !s.allowed) ?? [];
  const mutation = useMutation({
    mutationFn: () => api(`/orders/${order!.id}/status`, { method: "POST", body: { status: to, reason: reason || undefined } }),
    onSuccess: () => {
      toast.success(`${order!.orderNumber} → ${ORDER_STATUS[to as OrderStatus].en}`);
      qc.invalidateQueries({ queryKey: ["orders"] });
      qc.invalidateQueries({ queryKey: ["order", order!.id] });
      setTo("");
      setReason("");
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const needsReason = to === "CANCELLED";
  return (
    <Dialog open={!!order} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change status · {order?.orderNumber}</DialogTitle>
          <DialogDescription>
            Current: {order ? ORDER_STATUS[order.status].en : ""}. Only valid next steps are offered; courier and return steps happen through their own workflows.
          </DialogDescription>
        </DialogHeader>
        {detail.isLoading ? (
          <Loader2 className="mx-auto size-5 animate-spin" />
        ) : options.length === 0 ? (
          <p className="text-sm text-muted-foreground">No status changes are available to you for this order.</p>
        ) : (
          <div className="space-y-3">
            <Field label="New status" htmlFor="to">
              <NativeSelect id="to" value={to} onChange={(e) => setTo(e.target.value)}>
                <option value="">Choose…</option>
                {options.map((s) => (
                  <option key={s.to} value={s.to}>
                    {ORDER_STATUS[s.to].en} — {ORDER_STATUS[s.to].bn}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label={needsReason ? "Cancellation reason (required)" : "Note (optional)"} htmlFor="reason">
              <Textarea id="reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
            {blocked.some((b) => b.systemOnly) && (
              <p className="text-xs text-muted-foreground">
                Via workflow: {blocked.filter((b) => b.systemOnly).map((b) => ORDER_STATUS[b.to].en).join(", ")}
              </p>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={!to || (needsReason && reason.trim().length < 3) || mutation.isPending} variant={to === "CANCELLED" ? "destructive" : "default"} onClick={() => mutation.mutate()}>
            {mutation.isPending && <Loader2 className="size-4 animate-spin" />} Update
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function useCourierProviders() {
  return useQuery({ queryKey: ["couriers", "providers"], queryFn: () => api<CourierProvider[]>("/couriers/providers"), staleTime: 5 * 60_000 });
}

/** Book one or many orders with a courier; shows per-order results. */
export function BookCourierDialog({ orderIds, onClose }: { orderIds: string[] | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { can } = useAuth();
  const providers = useCourierProviders();
  const enabled = providers.data?.filter((p) => p.isEnabled && p.implemented) ?? [];
  const [providerId, setProviderId] = useState("");
  const [results, setResults] = useState<{ orderId: string; ok: boolean; error?: string | null; trackingCode?: string | null; status?: string }[] | null>(null);
  const chosen = providerId || enabled.find((p) => p.isDefault)?.id || enabled[0]?.id || "";
  const mutation = useMutation({
    mutationFn: async () => {
      if (orderIds!.length === 1) {
        const s = await api<{ status: string; trackingCode: string | null; lastError: string | null; alreadyBooked: boolean }>("/couriers/shipments", { method: "POST", body: { orderId: orderIds![0], providerId: chosen } });
        return [{ orderId: orderIds![0], ok: s.status !== "FAILED", status: s.status, trackingCode: s.trackingCode, error: s.lastError }];
      }
      const r = await api<{ results: { orderId: string; ok: boolean; error?: string | null; trackingCode?: string | null; status?: string }[] }>("/couriers/shipments/bulk", { method: "POST", body: { orderIds, providerId: chosen } });
      return r.results;
    },
    onSuccess: (r) => {
      setResults(r);
      qc.invalidateQueries({ queryKey: ["orders"] });
      const ok = r.filter((x) => x.ok).length;
      if (ok) toast.success(`${ok} shipment${ok === 1 ? "" : "s"} booked`);
      if (r.length - ok) toast.error(`${r.length - ok} booking${r.length - ok === 1 ? "" : "s"} failed`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const close = () => {
    setResults(null);
    onClose();
  };
  return (
    <Dialog open={!!orderIds} onOpenChange={(o) => !o && close()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Book courier</DialogTitle>
          <DialogDescription>
            {orderIds?.length ?? 0} order{orderIds?.length === 1 ? "" : "s"}. An order can only ever have one live shipment, so repeating this is safe.
          </DialogDescription>
        </DialogHeader>
        {!can("shipments.book") ? (
          <p className="text-sm text-red-600">You don&apos;t have permission to book shipments.</p>
        ) : results ? (
          <ul className="max-h-72 space-y-1 overflow-y-auto text-sm">
            {results.map((r) => (
              <li key={r.orderId} className={r.ok ? "text-emerald-700" : "text-red-600"}>
                {r.ok ? `✓ ${r.trackingCode ?? r.status}` : `✗ ${r.error ?? "failed"}`}
                {r.status === "PENDING" && " — courier busy, will retry automatically"}
              </li>
            ))}
          </ul>
        ) : enabled.length === 0 ? (
          <p className="text-sm text-muted-foreground">No courier is enabled. Configure one under Shipping → Couriers.</p>
        ) : (
          <Field label="Courier" htmlFor="provider">
            <NativeSelect id="provider" value={chosen} onChange={(e) => setProviderId(e.target.value)}>
              {enabled.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.sandbox ? " (sandbox)" : ""}
                  {p.isDefault ? " — default" : ""}
                </option>
              ))}
            </NativeSelect>
          </Field>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={close}>{results ? "Close" : "Cancel"}</Button>
          {!results && (
            <Button disabled={!chosen || mutation.isPending || !can("shipments.book")} onClick={() => mutation.mutate()}>
              {mutation.isPending && <Loader2 className="size-4 animate-spin" />} Book
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
