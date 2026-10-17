"use client";

import type { ReactNode } from "react";
import { Info } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * What a figure is based on. Shown as a small tag on every money KPI so "placed" value is never
 * mistaken for revenue, and profit is never mistaken for cash.
 */
export const BASIS = {
  placed: { label: "Placed", className: "border-blue-200 bg-blue-50 text-blue-700" },
  delivered: { label: "Delivered", className: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  collected: { label: "Collected", className: "border-teal-200 bg-teal-50 text-teal-700" },
  profit: { label: "Profit", className: "border-violet-200 bg-violet-50 text-violet-700" },
  cost: { label: "Cost", className: "border-orange-200 bg-orange-50 text-orange-700" },
  estimate: { label: "Estimate", className: "border-amber-300 bg-amber-50 text-amber-800" },
  platform: { label: "Platform-reported", className: "border-slate-300 bg-slate-100 text-slate-600" },
  verified: { label: "Verified", className: "border-emerald-300 bg-emerald-50 text-emerald-800" },
} as const;
export type Basis = keyof typeof BASIS;

export function BasisTag({ basis, className, children }: { basis: Basis; className?: string; children?: ReactNode }) {
  return (
    <span className={cn("inline-flex items-center whitespace-nowrap rounded border px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide", BASIS[basis].className, className)}>
      {children ?? BASIS[basis].label}
    </span>
  );
}

/** Small "i" icon with a definition tooltip (keyboard focusable). */
export function Definition({ text, label = "Definition" }: { text?: ReactNode; label?: string }) {
  if (!text) return null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" aria-label={label} className="inline-flex shrink-0 rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <Info className="size-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-72 text-xs leading-relaxed">{text}</TooltipContent>
    </Tooltip>
  );
}

export function KpiCard({
  label, value, definition, basis, sub, tone, className, emphasis,
}: {
  label: string;
  value: ReactNode;
  definition?: string;
  basis?: Basis[];
  sub?: ReactNode;
  tone?: "positive" | "negative";
  className?: string;
  emphasis?: boolean;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1 rounded-xl border bg-white p-3.5", emphasis && "border-slate-300 shadow-sm", className)}>
      <div className="flex items-start justify-between gap-2">
        <span className="text-[13px] font-medium leading-tight text-slate-600">{label}</span>
        <Definition text={definition} label={`What is ${label}?`} />
      </div>
      <div className={cn("truncate text-xl font-semibold tabular-nums tracking-tight md:text-2xl", tone === "negative" && "text-red-700", tone === "positive" && "text-emerald-700")}>{value}</div>
      {(basis?.length || sub) && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          {basis?.map((b) => <BasisTag key={b} basis={b} />)}
          {sub}
        </div>
      )}
    </div>
  );
}

export function KpiSkeleton({ count = 6, className }: { count?: number; className?: string }) {
  return (
    <div className={className} aria-busy="true" aria-label="Loading figures">
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} className="h-[92px] rounded-xl" />
      ))}
    </div>
  );
}

/** A percentage with a thin meter (0–100). */
export function RateTile({ label, pct, detail, definition, good = "high" }: { label: string; pct: number | null; detail?: ReactNode; definition?: string; good?: "high" | "low" }) {
  const v = pct ?? 0;
  return (
    <div className="rounded-xl border bg-white p-3.5">
      <div className="flex items-start justify-between gap-2">
        <span className="text-[13px] font-medium text-slate-600">{label}</span>
        <Definition text={definition} label={`What is ${label}?`} />
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{pct === null ? "—" : `${pct}%`}</div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={v} aria-label={label}>
        <div className={cn("h-full rounded-full", good === "high" ? "bg-[#2a78d6]" : "bg-[#eb6834]")} style={{ width: `${Math.min(100, Math.max(0, v))}%` }} />
      </div>
      {detail && <p className="mt-1.5 text-xs text-muted-foreground">{detail}</p>}
    </div>
  );
}
