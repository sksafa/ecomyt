"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Search } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field } from "@/components/admin/ui";
import { Thumb, useDebounced, useVariantSearch, type VariantOption } from "./shared";

export interface StockRow {
  variantId: string; sku: string; name: string; color: string | null; size: string | null; isActive: boolean;
  productId: string; productName: string; imageUrl: string | null;
  available: number; reserved: number; damaged: number; returned: number; lowStockThreshold: number; lowStock: boolean;
  unitCost?: string; stockValue?: string;
}

type Mode = "count" | "delta" | "to_damaged" | "dispose_damaged";
const MODES: { key: Mode; label: string; help: string }[] = [
  { key: "count", label: "Set counted stock", help: "Enter how many sellable units you physically counted; the difference is recorded as a correction." },
  { key: "delta", label: "Add / remove", help: "Increase or decrease available stock (e.g. +3 found, −2 missing)." },
  { key: "to_damaged", label: "Move to damaged", help: "Take units out of available stock and hold them as damaged." },
  { key: "dispose_damaged", label: "Dispose damaged", help: "Write off damaged units that were thrown away or sold off-book." },
];

export function AdjustStockDialog({ row, onClose }: { row: StockRow | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [mode, setMode] = useState<Mode>("count");
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");

  const n = value.trim() === "" || !/^-?\d+$/.test(value.trim()) ? null : Number(value.trim());
  let quantity: number | null = null;
  let apiMode: "available" | "to_damaged" | "dispose_damaged" = "available";
  let problem: string | null = null;
  if (row && n !== null) {
    if (mode === "count") {
      if (n < 0) problem = "Counted stock cannot be negative";
      else quantity = n - row.available;
      if (quantity === 0) problem = "Counted stock matches the system – nothing to adjust";
    } else if (mode === "delta") {
      quantity = n;
      if (n === 0) problem = "Enter a non-zero change";
      else if (row.available + n < 0) problem = `Only ${row.available} available`;
    } else {
      apiMode = mode;
      quantity = n;
      if (n <= 0) problem = "Enter a positive quantity";
      else if (mode === "to_damaged" && n > row.available) problem = `Only ${row.available} available`;
      else if (mode === "dispose_damaged" && n > row.damaged) problem = `Only ${row.damaged} damaged`;
    }
  }
  const after = row && quantity !== null && !problem
    ? {
        available: row.available + (apiMode === "available" ? quantity : apiMode === "to_damaged" ? -quantity : 0),
        damaged: row.damaged + (apiMode === "to_damaged" ? quantity : apiMode === "dispose_damaged" ? -quantity : 0),
      }
    : null;

  const save = useMutation({
    mutationFn: () => api("/inventory/adjust", { method: "POST", body: { variantId: row!.variantId, mode: apiMode, quantity, reason: reason.trim() } }),
    onSuccess: () => {
      toast.success("Stock adjusted");
      qc.invalidateQueries({ queryKey: ["inventory"] });
      qc.invalidateQueries({ queryKey: ["products"] });
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <Dialog open={!!row} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Adjust stock</DialogTitle>
          {row && (
            <DialogDescription>
              {row.productName} – {row.name} ({row.sku}). Now: <strong>{row.available}</strong> available, {row.reserved} reserved, {row.damaged} damaged.
            </DialogDescription>
          )}
        </DialogHeader>
        <div role="radiogroup" aria-label="Adjustment type" className="grid grid-cols-2 gap-2">
          {MODES.map((m) => (
            <button
              key={m.key}
              type="button"
              role="radio"
              aria-checked={mode === m.key}
              onClick={() => { setMode(m.key); setValue(""); }}
              className={cn("rounded-md border px-3 py-2 text-left text-sm", mode === m.key ? "border-blue-600 bg-blue-50 font-medium text-blue-800" : "hover:bg-muted")}
            >
              {m.label}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">{MODES.find((m) => m.key === mode)?.help}</p>
        <form
          id="adjust-form"
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!problem && quantity !== null && reason.trim().length >= 3) save.mutate();
          }}
        >
          <Field label={mode === "count" ? "Counted sellable units" : mode === "delta" ? "Change (use − to remove)" : "Quantity"} htmlFor="adj-qty" error={problem ?? undefined}>
            <Input id="adj-qty" inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value)} autoFocus placeholder={mode === "delta" ? "e.g. -2" : "0"} />
          </Field>
          {after && (
            <p className="rounded-md bg-muted/60 p-2 text-sm">
              After: <strong>{after.available}</strong> available · {after.damaged} damaged
              {mode === "count" && quantity !== null && <span className="text-muted-foreground"> (correction {quantity > 0 ? `+${quantity}` : quantity})</span>}
            </p>
          )}
          <Field label="Reason (required)" htmlFor="adj-reason" error={reason && reason.trim().length < 3 ? "At least 3 characters" : undefined}>
            <Textarea id="adj-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Monthly stock count, water damage in store room…" />
          </Field>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="adjust-form" disabled={save.isPending || !!problem || quantity === null || reason.trim().length < 3}>
            {save.isPending && <Loader2 className="size-4 animate-spin" />} Apply adjustment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Search-as-you-type variant picker (combobox). */
export function VariantPicker({ onPick, placeholder = "Search product or SKU", className, autoFocus }: { onPick: (v: VariantOption) => void; placeholder?: string; className?: string; autoFocus?: boolean }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const dq = useDebounced(q.trim(), 200);
  const results = useVariantSearch(dq, open);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);
  return (
    <div ref={box} className={cn("relative", className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={q}
        autoFocus={autoFocus}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
          if (e.key === "Enter") {
            e.preventDefault();
            const first = results.data?.[0];
            if (first) { onPick(first); setQ(""); setOpen(false); }
          }
        }}
        placeholder={placeholder}
        className="h-9 pl-9"
        role="combobox"
        aria-expanded={open}
        aria-label={placeholder}
      />
      {open && (
        <ul role="listbox" className="absolute z-50 mt-1 max-h-72 w-full overflow-y-auto rounded-md border bg-white shadow-lg">
          {results.isLoading && <li className="p-2 text-sm text-muted-foreground">Searching…</li>}
          {results.isError && <li className="p-2 text-sm text-red-600">{errorMessage(results.error)}</li>}
          {results.data?.length === 0 && <li className="p-2 text-sm text-muted-foreground">No variants found</li>}
          {results.data?.map((v) => (
            <li key={v.id} role="option" aria-selected={false}>
              <button
                type="button"
                className="flex w-full items-center gap-2 p-2 text-left text-sm hover:bg-muted"
                onClick={() => { onPick(v); setQ(""); setOpen(false); }}
              >
                <Thumb src={v.imageUrl} alt={v.productName} size={28} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{v.productName}</span>
                  <span className="block truncate text-xs text-muted-foreground">{v.name} · {v.sku}</span>
                </span>
                <span className="text-xs text-muted-foreground">{v.available} in stock</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export const VariantFilterPicker = ({ onPick }: { onPick: (v: VariantOption) => void }) => <VariantPicker onPick={onPick} placeholder="Filter by product or SKU" />;
