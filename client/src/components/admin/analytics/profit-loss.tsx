"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { BookOpen, RefreshCw } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { bdt, titleCase } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ErrorState, PageHeader } from "@/components/admin/ui";
import { DateRangeControl, fmtDay, useDateRange } from "./date-range";
import { BasisTag, KpiCard, KpiSkeleton } from "./kpi";
import { SERIES } from "./chart";

interface PnL {
  period: { from: string; to: string; timezone: string };
  revenue: { productSales: string; shippingCharges: string; returnsAndRefunds: string; total: string };
  costOfGoods: { cogs: string; restockRecovery: string };
  grossProfit: string;
  grossMarginPct: string | null;
  operatingCosts: { courierDelivery: string; courierCod: string; returnShipping: string; courierTotal: string; packaging: string; advertising: string; otherExpenses: string; adjustments: string };
  expensesByCategory: { name: string; type: string; total: string }[];
  netProfit: string;
  netMarginPct: string | null;
  cash: { in: string; out: string; net: string };
  notes: string[];
}

function Line({ label, value, hint, strong, indent, total }: { label: ReactNode; value: string; hint?: ReactNode; strong?: boolean; indent?: boolean; total?: boolean }) {
  const n = Number(value);
  return (
    <div className={cn("flex items-baseline justify-between gap-4 py-1.5 text-sm", total && "mt-1 border-t pt-2.5", strong && "font-semibold")}>
      <span className={cn("min-w-0", indent && "pl-4 text-slate-600")}>
        {label}
        {hint && <span className="ml-1.5 text-xs font-normal text-muted-foreground">{hint}</span>}
      </span>
      <span className={cn("shrink-0 tabular-nums", n < 0 && "text-red-700", total && "text-base")}>{bdt(value)}</span>
    </div>
  );
}

function Block({ title, children, className }: { title: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-xl border bg-white p-4", className)}>
      <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold">{title}</h2>
      {children}
    </section>
  );
}

export function ProfitLossScreen() {
  const { can } = useAuth();
  const range = useDateRange();
  const q = useQuery({
    queryKey: ["finance", "pnl", range.from, range.to],
    queryFn: () => api<PnL>("/finance/profit-and-loss", { query: { from: range.from, to: range.to } }),
    placeholderData: keepPreviousData,
  });
  const d = q.data;
  const oc = d?.operatingCosts;
  const opTotal = oc ? Number(oc.courierTotal) + Number(oc.packaging) + Number(oc.advertising) + Number(oc.otherExpenses) + Number(oc.adjustments) : 0;
  const catMax = Math.max(1, ...(d?.expensesByCategory.map((c) => Number(c.total)) ?? [1]));

  return (
    <div className="space-y-4">
      <PageHeader
        title="Profit & loss"
        description="From the ledger. Revenue is recognised when an order is delivered."
        actions={
          <>
            {can("reports.view") && (
              <Button variant="outline" size="sm" asChild>
                <Link href={`/admin/reports?type=profit-and-loss&range=custom&from=${range.from}&to=${range.to}`}>
                  <BookOpen className="size-4" /> Open as report
                </Link>
              </Button>
            )}
            <Button variant="outline" size="icon" className="size-9" aria-label="Refresh" onClick={() => q.refetch()}>
              <RefreshCw className={cn("size-4", q.isFetching && "animate-spin")} />
            </Button>
          </>
        }
      />
      <div className="rounded-xl border bg-white p-2.5">
        <DateRangeControl range={range} />
      </div>

      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !d || !oc ? (
        <KpiSkeleton count={8} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" />
      ) : (
        <div className={cn("space-y-4", q.isFetching && "opacity-70")}>
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <KpiCard emphasis label="Revenue" value={bdt(d.revenue.total)} basis={["delivered"]} sub="recognised on delivery" />
            <KpiCard emphasis label="Gross profit" value={bdt(d.grossProfit)} tone={Number(d.grossProfit) < 0 ? "negative" : undefined} basis={["profit"]} sub={`margin ${d.grossMarginPct ?? "—"}%`} />
            <KpiCard emphasis label="Net profit" value={bdt(d.netProfit)} tone={Number(d.netProfit) < 0 ? "negative" : "positive"} basis={["profit", "estimate"]} sub={`margin ${d.netMarginPct ?? "—"}%`} />
            <KpiCard label="Net cash flow" value={bdt(d.cash.net)} tone={Number(d.cash.net) < 0 ? "negative" : undefined} basis={["collected"]} sub="through accounts" />
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <div className="space-y-4">
              <Block title={<>Statement <span className="font-normal text-muted-foreground">· {fmtDay(d.period.from)} – {fmtDay(d.period.to)}</span></>}>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Revenue</p>
                <Line indent label="Product sales" value={d.revenue.productSales} hint="delivered orders, after discount" />
                <Line indent label="Shipping charges" value={d.revenue.shippingCharges} hint="paid by customers" />
                <Line indent label="Returns & refunds" value={d.revenue.returnsAndRefunds} />
                <Line strong total label="Total revenue" value={d.revenue.total} />

                <p className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Cost of goods</p>
                <Line indent label="Cost of goods sold" value={d.costOfGoods.cogs} />
                <Line indent label="Restock recovery" value={d.costOfGoods.restockRecovery} hint="returned goods put back in stock" />
                <Line strong total label={<>Gross profit <BasisTag basis="profit" className="ml-1" /></>} value={d.grossProfit} hint={`margin ${d.grossMarginPct ?? "—"}%`} />

                <p className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Operating costs</p>
                <Line indent label="Courier delivery fees" value={oc.courierDelivery} />
                <Line indent label="Courier COD charges" value={oc.courierCod} />
                <Line indent label="Return shipping" value={oc.returnShipping} />
                <Line indent strong label="Courier total" value={oc.courierTotal} />
                <Line indent label="Packaging" value={oc.packaging} />
                <Line indent label="Advertising" value={oc.advertising} hint="advertising-category expenses" />
                <Line indent label="Other expenses" value={oc.otherExpenses} />
                <Line indent label="Adjustments" value={oc.adjustments} />
                <Line strong total label="Total operating costs" value={opTotal.toFixed(2)} />

                <div className="mt-3 flex items-baseline justify-between gap-4 rounded-lg bg-slate-900 px-3 py-3 text-white">
                  <span className="font-semibold">
                    Net profit <span className="ml-1 rounded bg-amber-400/90 px-1.5 py-px text-[10px] font-semibold uppercase text-amber-950">estimate</span>
                  </span>
                  <span className={cn("text-lg font-semibold tabular-nums", Number(d.netProfit) < 0 && "text-red-300")}>
                    {bdt(d.netProfit)} <span className="text-xs font-normal text-slate-300">({d.netMarginPct ?? "—"}%)</span>
                  </span>
                </div>
              </Block>
            </div>

            <div className="space-y-4">
              <Block title={<>Cash in / out <BasisTag basis="collected" /></>}>
                <p className="mb-2 text-xs text-muted-foreground">Money that actually moved through your cash, bank and wallet accounts — not the same as profit.</p>
                <Line label="Cash in" value={d.cash.in} />
                <Line label="Cash out" value={d.cash.out} />
                <Line strong total label="Net cash" value={d.cash.net} />
              </Block>

              <Block title="Expenses by category">
                {d.expensesByCategory.length === 0 ? (
                  <p className="py-4 text-center text-sm text-muted-foreground">No expenses in this range.</p>
                ) : (
                  <ul className="mt-2 space-y-2.5">
                    {d.expensesByCategory.map((c) => (
                      <li key={c.name}>
                        <div className="flex items-baseline justify-between gap-3 text-sm">
                          <span className="min-w-0 truncate">
                            {c.name} <span className="text-xs text-muted-foreground">· {titleCase(c.type)}</span>
                          </span>
                          <span className="shrink-0 tabular-nums">{bdt(c.total)}</span>
                        </div>
                        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
                          <div className="h-full rounded-full" style={{ width: `${(Number(c.total) / catMax) * 100}%`, backgroundColor: c.type === "ADVERTISING" ? SERIES[1] : SERIES[0] }} />
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                {can("expenses.view") && (
                  <Link href="/admin/finance/expenses" className="mt-3 inline-block text-xs font-medium text-blue-700 hover:underline">
                    Manage expenses →
                  </Link>
                )}
              </Block>

              <Block title="How to read this">
                <ul className="list-disc space-y-1.5 pl-4 text-sm text-slate-700">
                  {d.notes.map((n) => <li key={n}>{n}</li>)}
                  <li>Net profit stays an estimate until courier settlements reconcile the actual fees.</li>
                </ul>
              </Block>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
