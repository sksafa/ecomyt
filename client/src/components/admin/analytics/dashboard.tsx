"use client";

import Link from "next/link";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, Cell, LabelList, Line, LineChart, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from "recharts";
import { RefreshCw } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { bdt, num, titleCase } from "@/lib/format";
import { CHANNELS, ORDER_STATUS, type OrderStatus } from "@/lib/status";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ErrorState, NativeSelect, PageHeader } from "@/components/admin/ui";
import { DateRangeControl, useDateRange } from "./date-range";
import { useUrlState } from "./url-state";
import { BasisTag, KpiCard, KpiSkeleton, RateTile, type Basis } from "./kpi";
import { AXIS, ChartCard, ChartTooltip, compactBdt, GRID, Legend, MEASURE_COLOR } from "./chart";
import type { DashboardCharts, DashboardSummary, Granularity } from "./types";

const KEYS = ["channel", "g"] as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function bucketText(start: string, g: Granularity, long = false) {
  const [y, m, d] = start.split("-").map(Number);
  if (g === "month") return `${MONTHS[m - 1]} ${long ? y : String(y).slice(2)}`;
  const s = `${d} ${MONTHS[m - 1]}`;
  return g === "week" ? (long ? `Week of ${s} ${y}` : s) : long ? `${s} ${y}` : s;
}

const pctText = (v: string | number | null | undefined) => (v === null || v === undefined ? "—" : `${v}%`);

export function DashboardScreen() {
  const { can } = useAuth();
  const range = useDateRange();
  const [v, set] = useUrlState(KEYS);
  const g = (["day", "week", "month"].includes(v.g ?? "") ? v.g : "day") as Granularity;
  const query = { from: range.from, to: range.to, channel: v.channel };

  const summary = useQuery({
    queryKey: ["dashboard", "summary", query],
    queryFn: () => api<DashboardSummary>("/dashboard/summary", { query }),
    placeholderData: keepPreviousData,
  });
  const charts = useQuery({
    queryKey: ["dashboard", "charts", query, g],
    queryFn: () => api<DashboardCharts>("/dashboard/charts", { query: { ...query, granularity: g } }),
    placeholderData: keepPreviousData,
  });

  const s = summary.data;
  const c = charts.data;
  const finance = s?.financeVisible ?? can("finance.view");
  const def = s?.definitions ?? {};
  const cdef = c?.definitions ?? {};
  const series = c?.series;
  const chartsLoading = charts.isLoading;

  const granularity = (
    <div role="radiogroup" aria-label="Granularity" className="inline-flex rounded-md border p-0.5 text-xs">
      {(["day", "week", "month"] as const).map((x) => (
        <button
          key={x}
          type="button"
          role="radio"
          aria-checked={g === x}
          onClick={() => set({ g: x === "day" ? undefined : x })}
          className={cn("rounded px-2 py-1 font-medium capitalize focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", g === x ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-muted")}
        >
          {x}
        </button>
      ))}
    </div>
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title="Dashboard"
        description="Business days in Asia/Dhaka. Hover the ⓘ icons for exactly how each figure is counted."
        actions={
          <Button variant="outline" size="icon" className="size-9" aria-label="Refresh" onClick={() => { summary.refetch(); charts.refetch(); }}>
            <RefreshCw className={cn("size-4", (summary.isFetching || charts.isFetching) && "animate-spin")} />
          </Button>
        }
      />

      <div className="sticky top-14 z-20 -mx-1 flex flex-wrap items-center gap-2 rounded-xl border bg-white/95 p-2.5 backdrop-blur">
        <DateRangeControl range={range} />
        <NativeSelect aria-label="Sales channel" className="ml-auto h-9 w-44" value={v.channel ?? ""} onChange={(e) => set({ channel: e.target.value || undefined })}>
          <option value="">All channels</option>
          {CHANNELS.map((ch) => <option key={ch} value={ch}>{titleCase(ch)}</option>)}
        </NativeSelect>
      </div>

      {summary.isError ? (
        <ErrorState error={summary.error} onRetry={() => summary.refetch()} />
      ) : (
        <>
          {/* Orders */}
          <section aria-labelledby="kpi-orders" className="space-y-2">
            <h2 id="kpi-orders" className="text-sm font-semibold text-slate-700">Orders <span className="font-normal text-muted-foreground">· placed in the range, by current status</span></h2>
            {!s ? (
              <KpiSkeleton count={6} className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6" />
            ) : (
              <div className={cn("space-y-3", summary.isFetching && "opacity-70")}>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
                  <KpiCard emphasis label="Orders placed" value={num(s.totalOrders)} definition={def.totalOrders} basis={["placed"]} />
                  <KpiCard label="Placed today" value={num(s.ordersToday)} definition={def.ordersToday} sub="today, Dhaka" />
                  <KpiCard label="Ever confirmed" value={num(s.everConfirmed)} definition={def.everConfirmed} sub={s.totalOrders ? `${Math.round((s.everConfirmed / s.totalOrders) * 100)}% of placed` : undefined} />
                  <KpiCard emphasis label="Delivered in range" value={num(s.deliveredInRange)} definition={def.deliveredInRange} basis={["delivered"]} />
                  <KpiCard label="Cancelled" value={num(s.cancelled)} definition={def.cancelled} />
                  <KpiCard label="Returned / RTO" value={num(s.returned)} definition={def.returned} />
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {(
                    [
                      ["Pending", s.pending, "pending", "PENDING"],
                      ["Needs confirmation", s.awaitingConfirmation, "awaitingConfirmation", "CONFIRMATION_REQUIRED"],
                      ["Confirmed", s.confirmed, "confirmed", "CONFIRMED"],
                      ["Processing", s.processing, "processing", "PROCESSING"],
                      ["Courier booked", s.courierBooked, "courierBooked", "COURIER_BOOKED"],
                      ["In transit", s.shipped, "shipped", "SHIPPED"],
                      ["Delivered", s.delivered, "delivered", "DELIVERED"],
                      ["On hold", s.onHold, "onHold", "ON_HOLD"],
                    ] as const
                  ).map(([label, value, key, status]) => (
                    <PipelineTile key={key} label={label} value={value} definition={def[key]} status={status} />
                  ))}
                </div>
              </div>
            )}
          </section>

          {/* Money */}
          {finance && (
            <section aria-labelledby="kpi-money" className="space-y-2">
              <h2 id="kpi-money" className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-700">
                Money
                <span className="font-normal text-muted-foreground">· </span>
                <BasisTag basis="placed">Placed = ordered, not revenue</BasisTag>
                <BasisTag basis="delivered">Delivered = recognised revenue</BasisTag>
                <BasisTag basis="collected">Collected = cash received</BasisTag>
              </h2>
              {!s ? (
                <KpiSkeleton count={6} className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6" />
              ) : s.grossSales === undefined ? null : (
                <div className={cn("space-y-3", summary.isFetching && "opacity-70")}>
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
                    <MoneyKpi label="Gross sales" value={s.grossSales} definition={def.grossSales} basis={["placed"]} />
                    <MoneyKpi emphasis label="Delivered sales" value={s.deliveredSales} definition={def.deliveredSales} basis={["delivered"]} />
                    <MoneyKpi label="Collected payments" value={s.collectedPayments} definition={def.collectedPayments} basis={["collected"]} />
                    <MoneyKpi label="COD with couriers" value={s.outstandingCod} definition={def.outstandingCod} sub={`${num(s.outstandingCodShipments)} parcels · current balance`} />
                    <MoneyKpi emphasis label="Gross profit" value={s.grossProfit} definition={def.grossProfit} basis={["profit"]} sub={`margin ${pctText(s.grossMarginPct)}`} signed />
                    <MoneyKpi
                      emphasis
                      label="Est. net profit"
                      value={s.estimatedNetProfit}
                      definition={def.estimatedNetProfit}
                      basis={["profit", "estimate"]}
                      sub={s.estimatedNetProfit == null ? "not available with filters" : `margin ${pctText(s.netMarginPct)}`}
                      signed
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
                    <MoneyKpi label="Product cost (COGS)" value={s.productCost} definition={def.productCost} basis={["cost"]} />
                    <MoneyKpi label="Courier expenses" value={s.courierExpenses} definition={def.courierExpenses} basis={["cost"]} />
                    <MoneyKpi label="Advertising" value={s.advertisingSpend} definition={def.advertisingSpend} basis={["cost"]} sub="expenses, company-wide" />
                    <MoneyKpi label="Return costs" value={s.returnCosts} definition={def.returnCosts} basis={["cost"]} />
                    <MoneyKpi label="Refunds paid" value={s.refundsPaid} definition={def.refundsPaid ?? "Refunds paid out to customers in the range."} basis={["cost"]} />
                  </div>
                  {def.filters && v.channel && <p className="text-xs text-muted-foreground">{def.filters}</p>}
                </div>
              )}
            </section>
          )}
        </>
      )}

      {charts.isError ? (
        <ErrorState error={charts.error} onRetry={() => charts.refetch()} />
      ) : (
        <div className={cn("grid gap-4 lg:grid-cols-3", charts.isFetching && !chartsLoading && "opacity-70")}>
          {/* Orders over time */}
          <ChartCard
            className="lg:col-span-2"
            title="Orders over time"
            definition={cdef.ordersOverTime}
            actions={granularity}
            loading={chartsLoading}
            empty={!series?.ordersOverTime.some((b) => b.placed || b.delivered)}
            basis={<Legend items={[{ label: "Placed (by order date)", color: MEASURE_COLOR.placed }, { label: "Delivered (by delivery date)", color: MEASURE_COLOR.delivered }]} />}
          >
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={series?.ordersOverTime} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid {...GRID} />
                <XAxis dataKey="start" {...AXIS} tickFormatter={(x) => bucketText(x, g)} minTickGap={16} />
                <YAxis {...AXIS} allowDecimals={false} />
                <RTooltip content={<ChartTooltip labelFormatter={(l) => bucketText(l, g, true)} />} cursor={{ stroke: "#cbd5e1" }} />
                <Line isAnimationActive={false} type="monotone" dataKey="placed" name="Placed" stroke={MEASURE_COLOR.placed} strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "#fff" }} />
                <Line isAnimationActive={false} type="monotone" dataKey="delivered" name="Delivered" stroke={MEASURE_COLOR.delivered} strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "#fff" }} />
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>

          {/* Orders by status */}
          <ChartCard title="Orders by status" definition={cdef.ordersByStatus} loading={chartsLoading} empty={!series?.ordersByStatus.some((x) => x.count)} basis={<BasisTag basis="placed" />} height={260}>
            <StatusBars data={series?.ordersByStatus ?? []} />
          </ChartCard>

          {/* Sales over time */}
          {finance && (
            <ChartCard
              className="lg:col-span-2"
              title="Sales over time"
              definition={cdef.salesOverTime}
              actions={granularity}
              loading={chartsLoading}
              empty={!series?.salesOverTime?.some((b) => Number(b.placedValue) || Number(b.deliveredRevenue))}
              basis={<Legend items={[{ label: "Placed order value (not revenue)", color: MEASURE_COLOR.placed }, { label: "Delivered revenue (recognised)", color: MEASURE_COLOR.delivered }]} />}
            >
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={series?.salesOverTime?.map((b) => ({ ...b, placedValue: Number(b.placedValue), deliveredRevenue: Number(b.deliveredRevenue) }))} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid {...GRID} />
                  <XAxis dataKey="start" {...AXIS} tickFormatter={(x) => bucketText(x, g)} minTickGap={16} />
                  <YAxis {...AXIS} tickFormatter={compactBdt} width={52} />
                  <RTooltip content={<ChartTooltip money labelFormatter={(l) => bucketText(l, g, true)} />} cursor={{ stroke: "#cbd5e1" }} />
                  <Line isAnimationActive={false} type="monotone" dataKey="placedValue" name="Placed value" stroke={MEASURE_COLOR.placed} strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "#fff" }} />
                  <Line isAnimationActive={false} type="monotone" dataKey="deliveredRevenue" name="Delivered revenue" stroke={MEASURE_COLOR.delivered} strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "#fff" }} />
                </LineChart>
              </ResponsiveContainer>
            </ChartCard>
          )}

          {/* Unit economics */}
          {finance && (
            <section className="grid content-start gap-3 rounded-xl border bg-white p-4">
              <h2 className="text-sm font-semibold">Unit economics</h2>
              {chartsLoading || !series ? (
                <KpiSkeleton count={3} className="grid gap-3" />
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <MoneyKpi label="AOV · placed" value={series.averageOrderValue?.placed} definition={cdef.averageOrderValue} basis={["placed"]} />
                    <MoneyKpi label="AOV · delivered" value={series.averageOrderValue?.delivered} definition={cdef.averageOrderValue} basis={["delivered"]} />
                  </div>
                  <MoneyKpi
                    label="Ad cost per delivered order"
                    value={series.adCostPerDeliveredOrder?.value}
                    definition={cdef.adCostPerDeliveredOrder}
                    sub={`${bdt(series.adCostPerDeliveredOrder?.adSpend)} ÷ ${num(series.adCostPerDeliveredOrder?.deliveredOrders)} delivered`}
                  />
                  <MoneyKpi
                    label="Customer acquisition cost"
                    value={series.customerAcquisitionCost?.value}
                    definition={cdef.customerAcquisitionCost}
                    sub={`${bdt(series.customerAcquisitionCost?.adSpend)} ÷ ${num(series.customerAcquisitionCost?.newCustomers)} new customers`}
                  />
                </>
              )}
            </section>
          )}

          {/* Rates */}
          <div className="grid gap-3 sm:grid-cols-3 lg:col-span-3">
            {chartsLoading || !series ? (
              <KpiSkeleton count={3} className="contents" />
            ) : (
              <>
                <RateTile
                  label="Delivery success rate"
                  pct={series.deliverySuccess.successRatePct}
                  definition={cdef.deliverySuccess}
                  detail={
                    <>
                      {num(series.deliverySuccess.delivered)} delivered · {num(series.deliverySuccess.returned)} returned
                      {series.deliverySuccess.byCourier.length > 1 &&
                        series.deliverySuccess.byCourier.map((b) => (
                          <span key={b.providerId} className="block">
                            {b.courier}: {pctText(b.successRatePct)}
                          </span>
                        ))}
                    </>
                  }
                />
                <RateTile label="Return rate" good="low" pct={series.returnRate.ratePct} definition={cdef.returnRate} detail={`${num(series.returnRate.returned)} returned of ${num(series.returnRate.returned + series.returnRate.delivered)} shipped (placed in range)`} />
                <RateTile label="Cancellation rate" good="low" pct={series.cancellationRate.ratePct} definition={cdef.cancellationRate} detail={`${num(series.cancellationRate.cancelled)} of ${num(series.cancellationRate.placed)} placed`} />
              </>
            )}
          </div>

          {/* Sales vs expenses */}
          {finance && (
            <ChartCard
              className="lg:col-span-2"
              title="Sales vs expenses"
              definition={cdef.salesVsExpenses}
              actions={granularity}
              loading={chartsLoading}
              empty={!series?.salesVsExpenses?.some((b) => Number(b.revenue) || Number(b.expenses))}
              basis={<Legend items={[{ label: "Revenue (delivered, ledger)", color: MEASURE_COLOR.delivered }, { label: "Costs & expenses", color: MEASURE_COLOR.cost }]} />}
            >
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={series?.salesVsExpenses?.map((b) => ({ ...b, revenue: Number(b.revenue), expenses: Number(b.expenses), net: Number(b.net) }))} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={2}>
                  <CartesianGrid {...GRID} />
                  <XAxis dataKey="start" {...AXIS} tickFormatter={(x) => bucketText(x, g)} minTickGap={16} />
                  <YAxis {...AXIS} tickFormatter={compactBdt} width={52} />
                  <RTooltip
                    cursor={{ fill: "#f1f5f9" }}
                    content={
                      <ChartTooltip
                        money
                        labelFormatter={(l) => bucketText(l, g, true)}
                        extra={(row) => (
                          <span className="flex justify-between gap-4">
                            <span className="text-slate-600">Net</span>
                            <span className={cn("font-semibold tabular-nums", Number(row.net) < 0 ? "text-red-700" : "text-emerald-700")}>{bdt(row.net as number)}</span>
                          </span>
                        )}
                      />
                    }
                  />
                  <Bar isAnimationActive={false} dataKey="revenue" name="Revenue" fill={MEASURE_COLOR.delivered} radius={[4, 4, 0, 0]} maxBarSize={28} />
                  <Bar isAnimationActive={false} dataKey="expenses" name="Costs" fill={MEASURE_COLOR.cost} radius={[4, 4, 0, 0]} maxBarSize={28} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          )}

          {/* Channel */}
          {finance ? (
            <ChartCard title="Revenue by channel" definition={cdef.revenueByChannel} loading={chartsLoading} empty={!series?.revenueByChannel?.length} basis={<BasisTag basis="delivered" />}>
              <HBars data={(series?.revenueByChannel ?? []).map((r) => ({ name: titleCase(r.channel), value: Number(r.revenue), sub: `${r.orders} orders` }))} money color={MEASURE_COLOR.delivered} />
            </ChartCard>
          ) : (
            <ChartCard title="Orders by channel" definition={cdef.ordersByChannel} loading={chartsLoading} empty={!series?.ordersByChannel.length} basis={<BasisTag basis="placed" />}>
              <HBars data={(series?.ordersByChannel ?? []).map((r) => ({ name: titleCase(r.channel), value: r.orders }))} color={MEASURE_COLOR.placed} />
            </ChartCard>
          )}

          {finance && (
            <>
              <ChartCard className="lg:col-span-2" title="Revenue by product · top 10" definition={cdef.revenueByProduct} loading={chartsLoading} empty={!series?.revenueByProduct?.length} basis={<BasisTag basis="delivered" />} height={Math.max(220, (series?.revenueByProduct?.length ?? 6) * 34)}>
                <HBars data={(series?.revenueByProduct ?? []).map((r) => ({ name: r.name, value: Number(r.revenue), sub: `${r.units} units` }))} money color={MEASURE_COLOR.delivered} labelWidth={180} />
              </ChartCard>
              <ChartCard title="Revenue by courier" definition={cdef.revenueByCourier} loading={chartsLoading} empty={!series?.revenueByCourier?.length} basis={<BasisTag basis="delivered" />} height={Math.max(120, (series?.revenueByCourier?.length ?? 3) * 44)}>
                <HBars data={(series?.revenueByCourier ?? []).map((r) => ({ name: r.courier, value: Number(r.revenue), sub: `${r.orders} orders` }))} money color={MEASURE_COLOR.delivered} />
              </ChartCard>
              <TableCard className="lg:col-span-3" title="Product profitability" definition={cdef.productProfitability} loading={chartsLoading} empty={!series?.productProfitability?.length} basis={<><BasisTag basis="delivered" /><BasisTag basis="profit" /></>}>
                <table className="w-full min-w-[560px] text-sm">
                  <thead className="text-left text-xs text-muted-foreground">
                    <tr className="border-b">
                      <th className="py-2 pr-3 font-medium">Product</th>
                      <th className="py-2 pr-3 text-right font-medium">Units</th>
                      <th className="py-2 pr-3 text-right font-medium">Revenue</th>
                      <th className="py-2 pr-3 text-right font-medium">Product cost</th>
                      <th className="py-2 pr-3 text-right font-medium">Profit</th>
                      <th className="w-40 py-2 font-medium">Margin</th>
                    </tr>
                  </thead>
                  <tbody>
                    {series?.productProfitability?.map((p) => (
                      <tr key={p.productId} className="border-b last:border-0">
                        <td className="py-2 pr-3">
                          <Link href={`/admin/products/${p.productId}`} className="hover:underline">{p.name}</Link>
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums">{num(p.units)}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{bdt(p.revenue)}</td>
                        <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">{bdt(p.cost)}</td>
                        <td className={cn("py-2 pr-3 text-right font-medium tabular-nums", Number(p.profit) < 0 && "text-red-700")}>{bdt(p.profit)}</td>
                        <td className="py-2">
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                              <div className="h-full rounded-full bg-[#6250d6]" style={{ width: `${Math.max(0, Math.min(100, Number(p.marginPct ?? 0)))}%` }} />
                            </div>
                            <span className="w-12 text-right text-xs tabular-nums">{pctText(p.marginPct)}</span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableCard>
            </>
          )}

          <TableCard className="lg:col-span-2" title="Best-selling products" definition={cdef.bestSelling} loading={chartsLoading} empty={!series?.bestSelling.length} basis={<BasisTag basis="placed" />}>
            <table className="w-full min-w-[420px] text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr className="border-b">
                  <th className="py-2 pr-3 font-medium">#</th>
                  <th className="py-2 pr-3 font-medium">Product</th>
                  <th className="py-2 pr-3 text-right font-medium">Units</th>
                  {finance && <th className="py-2 text-right font-medium">Order value</th>}
                </tr>
              </thead>
              <tbody>
                {series?.bestSelling.map((p, i) => (
                  <tr key={p.productId ?? p.name} className="border-b last:border-0">
                    <td className="py-2 pr-3 text-muted-foreground">{i + 1}</td>
                    <td className="py-2 pr-3">{p.productId ? <Link href={`/admin/products/${p.productId}`} className="hover:underline">{p.name}</Link> : p.name}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{num(p.units)}</td>
                    {finance && <td className="py-2 text-right tabular-nums">{bdt(p.revenue)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </TableCard>

          <TableCard title="Slow-moving stock" definition={cdef.slowMoving} loading={chartsLoading} empty={!series?.slowMoving.length} emptyText="Every in-stock variant sold 2+ units in this range">
            <ul className="max-h-[320px] divide-y overflow-y-auto text-sm">
              {series?.slowMoving.map((x) => (
                <li key={x.variantId} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate">{x.product}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {x.variant} · {x.sku}
                    </p>
                  </div>
                  <div className="shrink-0 text-right text-xs">
                    <p className="font-medium tabular-nums">{num(x.available)} in stock</p>
                    <p className="text-muted-foreground">{x.unitsSold} sold</p>
                  </div>
                </li>
              ))}
            </ul>
          </TableCard>
        </div>
      )}
    </div>
  );
}

function MoneyKpi({ value, signed, ...rest }: { label: string; value: string | null | undefined; definition?: string; basis?: Basis[]; sub?: React.ReactNode; emphasis?: boolean; signed?: boolean }) {
  const n = value == null ? null : Number(value);
  return <KpiCard {...rest} value={n === null ? "—" : bdt(value)} tone={signed && n !== null ? (n < 0 ? "negative" : undefined) : undefined} />;
}

const ORDER_TAB: Partial<Record<OrderStatus, string>> = {
  PENDING: "pending", CONFIRMATION_REQUIRED: "confirm", CONFIRMED: "confirmed", PROCESSING: "processing", COURIER_BOOKED: "booked", SHIPPED: "shipped", DELIVERED: "delivered", ON_HOLD: "hold",
};

function PipelineTile({ label, value, definition, status }: { label: string; value: number; definition?: string; status: OrderStatus }) {
  const tone = ORDER_STATUS[status].tone;
  return (
    <Link
      href={`/admin/orders?tab=${ORDER_TAB[status] ?? ""}`}
      className="flex min-w-0 items-center justify-between gap-2 rounded-lg border bg-white px-3 py-2 text-sm hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      title={definition}
    >
      <span className="flex min-w-0 items-center gap-1.5 text-slate-600">
        <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: STATUS_FILL[tone] }} />
        <span className="truncate">{label}</span>
      </span>
      <span className="font-semibold tabular-nums">{num(value)}</span>
    </Link>
  );
}

function TableCard({ title, definition, basis, loading, empty, emptyText, className, children }: { title: string; definition?: string; basis?: React.ReactNode; loading?: boolean; empty?: boolean; emptyText?: string; className?: string; children: React.ReactNode }) {
  return (
    <ChartCard title={title} definition={definition} basis={basis} loading={loading} empty={empty} emptyText={emptyText} className={className} height={200} autoHeight>
      <div className="overflow-x-auto">{children}</div>
    </ChartCard>
  );
}

const STATUS_FILL: Record<string, string> = {
  sky: "#38bdf8", amber: "#f59e0b", emerald: "#10b981", indigo: "#6366f1", violet: "#8b5cf6", purple: "#a855f7", blue: "#3b82f6",
  green: "#22c55e", red: "#ef4444", orange: "#f97316", rose: "#f43f5e", cyan: "#06b6d4", teal: "#14b8a6", gray: "#94a3b8",
};

/** Status uses the app-wide status tones (a status is a state, not a series) + always a text label. */
function StatusBars({ data }: { data: { status: string; count: number }[] }) {
  const rows = data.filter((d) => d.count > 0).map((d) => ({ ...d, label: ORDER_STATUS[d.status as OrderStatus]?.en ?? titleCase(d.status), fill: STATUS_FILL[ORDER_STATUS[d.status as OrderStatus]?.tone ?? "gray"] }));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 32, left: 0, bottom: 0 }} barCategoryGap={4}>
        <XAxis type="number" hide allowDecimals={false} />
        <YAxis type="category" dataKey="label" {...AXIS} width={118} tick={{ fill: "#475569", fontSize: 12 }} interval={0} />
        <RTooltip cursor={{ fill: "#f1f5f9" }} content={<ChartTooltip />} />
        <Bar isAnimationActive={false} dataKey="count" name="Orders" radius={[0, 4, 4, 0]} maxBarSize={22}>
          {rows.map((r) => <Cell key={r.status} fill={r.fill} />)}
          <LabelList dataKey="count" position="right" className="fill-slate-700 text-xs" />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Single-measure horizontal bars with direct value labels. */
export function HBars({ data, money, color, labelWidth = 110 }: { data: { name: string; value: number; sub?: string }[]; money?: boolean; color: string; labelWidth?: number }) {
  const short = (s: string) => (s.length > labelWidth / 6.5 ? `${s.slice(0, Math.floor(labelWidth / 6.5) - 1)}…` : s);
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: money ? 56 : 32, left: 0, bottom: 0 }} barCategoryGap={4}>
        <XAxis type="number" hide />
        <YAxis type="category" dataKey="name" {...AXIS} width={labelWidth} tick={{ fill: "#475569", fontSize: 12 }} tickFormatter={short} interval={0} />
        <RTooltip
          cursor={{ fill: "#f1f5f9" }}
          content={<ChartTooltip money={money} extra={(row) => (row.sub ? <span className="text-slate-600">{String(row.sub)}</span> : null)} />}
        />
        <Bar isAnimationActive={false} dataKey="value" name={money ? "Revenue" : "Orders"} fill={color} radius={[0, 4, 4, 0]} maxBarSize={22}>
          <LabelList dataKey="value" position="right" className="fill-slate-700 text-xs" formatter={(x: unknown) => (money ? compactBdt(Number(x)) : num(Number(x)))} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
