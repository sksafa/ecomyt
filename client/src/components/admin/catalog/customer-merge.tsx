"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Loader2 } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

export interface MergeCandidate { id: string; name: string; phone: string; email: string | null; totalOrders: number }

/** Merge two customer profiles: the user picks which one to keep; the other's orders, addresses and history move over. */
export function MergeCustomersDialog({ pair, reason: why, onClose, onMerged }: { pair: [MergeCandidate, MergeCandidate] | null; reason?: string; onClose: () => void; onMerged?: (keptId: string) => void }) {
  const qc = useQueryClient();
  const [keepId, setKeepId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);
  const keep = pair?.find((c) => c.id === keepId) ?? null;
  const dup = pair?.find((c) => c.id !== keepId) ?? null;

  const merge = useMutation({
    mutationFn: () => api<{ mergedInto: string }>(`/customers/${keep!.id}/merge`, { method: "POST", body: { duplicateId: dup!.id, reason: reason.trim() } }),
    onSuccess: (r) => {
      toast.success(`Merged into ${keep!.name}`);
      qc.invalidateQueries({ queryKey: ["customers"] });
      qc.invalidateQueries({ queryKey: ["customer"] });
      onMerged?.(r.mergedInto);
      close();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  function close() {
    setKeepId(null);
    setReason("");
    setConfirming(false);
    onClose();
  }

  return (
    <Dialog open={!!pair} onOpenChange={(o) => !o && close()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Merge customer profiles</DialogTitle>
          <DialogDescription>
            {why ? <>Flagged because: <strong>{why}</strong>. </> : null}
            Choose the profile to keep. The other profile&apos;s orders, addresses and communication history move to it, its phone becomes the alternate phone, and it is closed.
          </DialogDescription>
        </DialogHeader>
        {pair && (
          <div role="radiogroup" aria-label="Profile to keep" className="grid gap-2 sm:grid-cols-2">
            {pair.map((c) => (
              <button
                key={c.id}
                type="button"
                role="radio"
                aria-checked={keepId === c.id}
                onClick={() => { setKeepId(c.id); setConfirming(false); }}
                className={cn("rounded-lg border p-3 text-left text-sm transition-colors", keepId === c.id ? "border-blue-600 bg-blue-50 ring-2 ring-blue-600/20" : "hover:bg-muted")}
              >
                <p className="font-medium">{c.name}</p>
                <p className="tabular-nums text-muted-foreground">{c.phone}</p>
                {c.email && <p className="truncate text-muted-foreground">{c.email}</p>}
                <p className="mt-1 text-xs">{c.totalOrders} order{c.totalOrders === 1 ? "" : "s"}</p>
                {keepId === c.id && <p className="mt-1 text-xs font-medium text-blue-700">Keep this profile</p>}
                {keepId && keepId !== c.id && <p className="mt-1 text-xs font-medium text-amber-700">Will be merged and closed</p>}
              </button>
            ))}
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="merge-reason">Reason (required)</Label>
          <Textarea id="merge-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Same person – confirmed on call" />
        </div>
        {confirming && keep && dup && (
          <div role="alert" className="flex gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <span>
              This moves {dup.totalOrders} order{dup.totalOrders === 1 ? "" : "s"} from <strong>{dup.name} ({dup.phone})</strong> into <strong>{keep.name} ({keep.phone})</strong>. This cannot be undone from the admin.
            </span>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={close} disabled={merge.isPending}>Cancel</Button>
          {!confirming ? (
            <Button disabled={!keepId || reason.trim().length < 3} onClick={() => setConfirming(true)}>Continue</Button>
          ) : (
            <Button variant="destructive" disabled={merge.isPending} onClick={() => merge.mutate()}>
              {merge.isPending && <Loader2 className="size-4 animate-spin" />} Merge profiles
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
