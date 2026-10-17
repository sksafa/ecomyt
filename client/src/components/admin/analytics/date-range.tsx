"use client";

import { CalendarDays } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { dhakaDaysAgo, dhakaToday } from "@/lib/format";
import { useUrlState } from "./url-state";

export const RANGE_PRESETS = [
  { key: "today", label: "Today" },
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "month", label: "This month" },
  { key: "custom", label: "Custom" },
] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number]["key"];

/** Inclusive Asia/Dhaka business-day range for a preset. */
export function presetRange(preset: RangePreset, custom?: { from?: string; to?: string }): { from: string; to: string } {
  const today = dhakaToday();
  switch (preset) {
    case "today":
      return { from: today, to: today };
    case "7d":
      return { from: dhakaDaysAgo(6), to: today };
    case "month":
      return { from: `${today.slice(0, 8)}01`, to: today };
    case "custom": {
      const from = custom?.from || dhakaDaysAgo(29);
      const to = custom?.to || today;
      return from <= to ? { from, to } : { from: to, to: from };
    }
    default:
      return { from: dhakaDaysAgo(29), to: today };
  }
}

const RANGE_KEYS = ["range", "from", "to"] as const;

/** Reads the date range from the URL (?range=7d or ?range=custom&from=…&to=…); default is the last 30 days. */
export function useDateRange(defaultPreset: RangePreset = "30d") {
  const [v, set] = useUrlState(RANGE_KEYS);
  const preset = (RANGE_PRESETS.some((p) => p.key === v.range) ? v.range : defaultPreset) as RangePreset;
  const { from, to } = presetRange(preset, { from: v.from, to: v.to });
  const setPreset = (p: RangePreset) => {
    if (p === "custom") set({ range: "custom", from, to });
    else set({ range: p === defaultPreset ? undefined : p, from: undefined, to: undefined });
  };
  const setCustom = (patch: { from?: string; to?: string }) => set({ range: "custom", from: patch.from ?? from, to: patch.to ?? to });
  return { preset, from, to, setPreset, setCustom };
}

export function DateRangeControl({ range, className }: { range: ReturnType<typeof useDateRange>; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <div role="radiogroup" aria-label="Date range" className="inline-flex flex-wrap rounded-lg border bg-white p-0.5">
        {RANGE_PRESETS.map((p) => {
          const active = range.preset === p.key;
          return (
            <button
              key={p.key}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => range.setPreset(p.key)}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                active ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-muted",
              )}
            >
              {p.label}
            </button>
          );
        })}
      </div>
      {range.preset === "custom" ? (
        <div className="flex items-center gap-1.5">
          <Input type="date" aria-label="From date" className="h-9 w-[9.5rem]" value={range.from} max={range.to} onChange={(e) => e.target.value && range.setCustom({ from: e.target.value })} />
          <span className="text-sm text-muted-foreground">to</span>
          <Input type="date" aria-label="To date" className="h-9 w-[9.5rem]" value={range.to} min={range.from} max={dhakaToday()} onChange={(e) => e.target.value && range.setCustom({ to: e.target.value })} />
        </div>
      ) : (
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <CalendarDays className="size-3.5" />
          {fmtDay(range.from)}
          {range.from !== range.to && <> – {fmtDay(range.to)}</>} · Dhaka time
        </span>
      )}
    </div>
  );
}

/** "2026-10-17" → "17 Oct 2026" without timezone shifts. */
export function fmtDay(ymd: string) {
  const [y, m, d] = ymd.split("-").map(Number);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${d} ${months[m - 1]} ${y}`;
}
