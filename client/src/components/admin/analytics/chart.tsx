"use client";

import type { ReactNode } from "react";
import { BarChart3 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { bdt, num } from "@/lib/format";
import { Definition } from "./kpi";

/**
 * Validated categorical palette (light surface), assigned in fixed order. Measures keep the same
 * colour on every chart: placed = blue, delivered/recognised = aqua, costs = orange.
 */
export const SERIES = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"] as const;
export const MEASURE_COLOR = { placed: SERIES[0], delivered: SERIES[2], cost: SERIES[1] } as const;
export const AXIS = { stroke: "#94a3b8", fontSize: 11, tickLine: false, axisLine: false } as const;
export const GRID = { stroke: "#e2e8f0", strokeDasharray: "0", vertical: false } as const;

/** Compact BDT for axis ticks: ৳950, ৳12k, ৳1.2L, ৳3.4Cr (South-Asian units). */
export function compactBdt(v: number | string) {
  const n = Number(v);
  const a = Math.abs(n);
  const s = n < 0 ? "-" : "";
  if (a >= 1e7) return `${s}৳${trim(a / 1e7)}Cr`;
  if (a >= 1e5) return `${s}৳${trim(a / 1e5)}L`;
  if (a >= 1e3) return `${s}৳${trim(a / 1e3)}k`;
  return `${s}৳${Math.round(a)}`;
}
const trim = (x: number) => (x >= 100 ? Math.round(x).toString() : x.toFixed(1).replace(/\.0$/, ""));

export function ChartCard({
  title, definition, basis, actions, loading, empty, emptyText = "No data for this range", children, className, height = 260, footer, autoHeight,
}: {
  autoHeight?: boolean;
  title: string;
  definition?: string;
  basis?: ReactNode;
  actions?: ReactNode;
  loading?: boolean;
  empty?: boolean;
  emptyText?: string;
  children: ReactNode;
  className?: string;
  height?: number;
  footer?: ReactNode;
}) {
  return (
    <section className={cn("flex min-w-0 flex-col rounded-xl border bg-white p-4", className)}>
      <header className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <h2 className="text-sm font-semibold">{title}</h2>
            <Definition text={definition} label={`About ${title}`} />
          </div>
          {basis && <div className="mt-1 flex flex-wrap items-center gap-1.5">{basis}</div>}
        </div>
        {actions}
      </header>
      {loading ? (
        <Skeleton className="w-full rounded-lg" style={{ height }} />
      ) : empty ? (
        <div className="flex flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed text-sm text-muted-foreground" style={{ height }}>
          <BarChart3 className="size-6" />
          {emptyText}
        </div>
      ) : (
        <div className="min-w-0" style={autoHeight ? undefined : { height }}>
          {children}
        </div>
      )}
      {footer && !loading && <div className="mt-3">{footer}</div>}
    </section>
  );
}

export function Legend({ items }: { items: { label: string; color: string; dashed?: boolean }[] }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600">
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-1.5">
          <span className={cn("inline-block h-0.5 w-4 rounded", i.dashed && "border-t-2 border-dashed bg-transparent")} style={i.dashed ? { borderColor: i.color } : { backgroundColor: i.color, height: 3 }} />
          {i.label}
        </li>
      ))}
    </ul>
  );
}

type TooltipEntry = { name?: string | number; value?: number | string | (number | string)[]; color?: string; dataKey?: string | number; payload?: Record<string, unknown> };

/** Tooltip body for Recharts' `content` prop; values use text ink, colour only in the swatch. */
export function ChartTooltip({
  active, payload, label, money, labelFormatter, extra,
}: {
  active?: boolean;
  payload?: readonly TooltipEntry[];
  label?: string | number;
  money?: boolean | ((key: string) => boolean);
  labelFormatter?: (l: string) => string;
  extra?: (row: Record<string, unknown>) => ReactNode;
}) {
  if (!active || !payload?.length) return null;
  const isMoney = (k: string) => (typeof money === "function" ? money(k) : !!money);
  return (
    <div className="min-w-40 rounded-lg border bg-white px-3 py-2 text-xs shadow-md">
      {label !== undefined && <p className="mb-1 font-medium text-slate-900">{labelFormatter ? labelFormatter(String(label)) : label}</p>}
      <ul className="space-y-0.5">
        {payload.map((p) => (
          <li key={String(p.dataKey)} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-slate-600">
              <span className="size-2 rounded-sm" style={{ backgroundColor: p.color }} />
              {p.name}
            </span>
            <span className="font-medium tabular-nums text-slate-900">{isMoney(String(p.dataKey)) ? bdt(p.value as number) : num(p.value as number)}</span>
          </li>
        ))}
      </ul>
      {extra && payload[0]?.payload && <div className="mt-1 border-t pt-1">{extra(payload[0].payload)}</div>}
    </div>
  );
}
