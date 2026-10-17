"use client";

import { useRef, useState, type ReactNode } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle, CheckCircle2, CircleSlash, FileUp, Loader2, Plus, RefreshCw, Search, Send, ShieldCheck, Trash2, XCircle } from "lucide-react";
import { api, ApiError, errorMessage, request, type PageMeta } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { bdt, dhakaDateTime, dhakaToday, num } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ConfirmDialog, EmptyState, ErrorState, Field, IconAction, LoadingRows, NativeSelect, PageHeader, Pagination, Pill } from "@/components/admin/ui";
import { DateRangeControl, useDateRange } from "./date-range";
import { useUrlState } from "./url-state";
import { BasisTag, Definition, KpiCard } from "./kpi";
import { AXIS, ChartCard, ChartTooltip, compactBdt, GRID, Legend, MEASURE_COLOR } from "./chart";
import { DATE_RE, handleFormError, MONEY_RE } from "./forms";

// ───────────── types ─────────────

interface PlatformFigures { spend: string; impressions: number; clicks: number; reportedPurchases: number; reportedRevenue: string; note: string }
interface AttributionRow {
  source: string; medium: string | null; campaign: string | null; campaignIds: string[];
  placed: number; confirmed: number; delivered: number; cancelled: number; returned: number;
  deliveredRevenue: string; returnRate: string | null; platform: PlatformFigures; cpa: string | null; roas: string | null;
  estimatedNetProfit: { amount: string; estimated: boolean; components: Record<string, string | boolean> };
}
interface Attribution {
  from: string; to: string; model: "first" | "last"; rows: AttributionRow[]; totals: AttributionRow;
  unattributedSpend: { spend: string; records: number; campaigns: string[]; reportedPurchases: number; reportedRevenue: string; note: string };
  definitions: Record<string, string>;
}
interface CampaignRow {
  campaign: string; placed: number; deliveredOfPlaced: number; cancelled: number; returned: number; deliveryRate: string | null; cancellationRate: string | null;
  returnRate: string | null; avgOrderValue: string | null; deliveredInRange: number; deliveredRevenue: string; spend: string; cpa: string | null; roas: string | null;
}
interface Campaigns { rows: CampaignRow[]; unattributedSpend: string; definitions: Record<string, string> }
interface Reconciliation {
  campaigns: {
    platform: string; campaignId: string; campaignName: string | null; spend: string;
    platformReported: { purchases: number; revenue: string };
    verified: { placedOrders: number; placedValue: string; cancelledOrders: number; deliveredOrders: number; deliveredRevenue: string };
    reportedVsPlaced: number; reportedVsDelivered: number; deliveredRoas: string | null; reportedRoas: string | null;
  }[];
  totals: { spend: string; reportedPurchases: number; reportedRevenue: string; verifiedPlacedOrders: number; verifiedDeliveredOrders: number; verifiedDeliveredRevenue: string; attributedOrdersWithoutSpendRecord: number };
  expenses: { recordedAdvertisingExpenses: string; byCategory: Record<string, string>; importedSpend: string; importedSpendByPlatform: Record<string, string>; difference: string; status: string; message: string; note: string };
}
interface AdSpend {
  id: string; platform: string; date: string; campaignId: string; campaignName: string | null; adsetId: string; adId: string; spend: string;
  impressions: number; clicks: number; reportedPurchases: number; reportedRevenue: string; source: string; importBatch: string | null; createdAt: string;
}
interface ImportResult { importBatch: string; totalRows: number; created: number; updated: number; failed: number; errors: { row: number; messages: string[] }[]; totalSpend: string }
interface MetaStatus {
  pixelId: string | null; pixelConfigured: boolean; capiEnabled: boolean; accessTokenConfigured: boolean; testEventCodeConfigured: boolean; capiActive: boolean;
  inactiveReason: string | null; graphApiVersion: string; purchaseEventIdFormat: string; last7Days: Record<string, number>;
  recentEvents: { id: string; eventName: string; eventId: string; orderId: string | null; status: string; error: string | null; createdAt: string }[];
}

const TABS = [
  { key: "attribution", label: "Attribution" },
  { key: "campaigns", label: "Campaign quality" },
  { key: "reconciliation", label: "Reconciliation" },
  { key: "spend", label: "Ad spend" },
  { key: "meta", label: "Meta pixel & CAPI" },
] as const;
const KEYS = ["tab", "model", "platform", "campaign", "page"] as const;
const PLATFORMS = ["META", "GOOGLE", "TIKTOK", "OTHER"] as const;
const pct = (v: string | number | null | undefined) => (v === null || v === undefined ? "—" : `${Number(v).toFixed(1).replace(/\.0$/, "")}%`);
const roas = (v: string | null | undefined) => (v == null ? "—" : `${Number(v).toFixed(2)}×`);

/** Column header cell; verified / platform columns are tinted so they can never be confused. */
function Th({ children, kind, def, className }: { children: ReactNode; kind?: "verified" | "platform" | "estimate"; def?: string; className?: string }) {
  return (
    <th
      scope="col"
      className={cn(
        "whitespace-nowrap px-3 py-2 text-right text-xs font-medium text-slate-600 first:text-left",
        kind === "verified" && "bg-emerald-50 text-emerald-900",
        kind === "platform" && "bg-slate-100 italic text-slate-500",
        kind === "estimate" && "bg-amber-50 text-amber-900",
        className,
      )}
    >
      <span className="inline-flex items-center gap-1">
        {children}
        <Definition text={def} />
      </span>
    </th>
  );
}
function Td({ children, kind, className }: { children: ReactNode; kind?: "verified" | "platform" | "estimate"; className?: string }) {
  return (
    <td
      className={cn(
        "whitespace-nowrap px-3 py-2 text-right tabular-nums first:text-left",
        kind === "verified" && "bg-emerald-50/50 font-medium",
        kind === "platform" && "bg-slate-50 italic text-slate-500",
        kind === "estimate" && "bg-amber-50/50",
        className,
      )}
    >
      {children}
    </td>
  );
}

function VerifiedVsPlatformLegend() {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
        <ShieldCheck className="mt-0.5 size-4 shrink-0" />
        <div>
          <p className="font-semibold">Verified delivered revenue</p>
          <p className="text-xs">From our own orders: only parcels actually delivered and kept by the customer. ROAS and CPA here use these figures.</p>
        </div>
      </div>
      <div className="flex items-start gap-2 rounded-lg border border-slate-300 bg-slate-100 p-3 text-sm text-slate-700">
        <CircleSlash className="mt-0.5 size-4 shrink-0" />
        <div>
          <p className="font-semibold">Platform-reported (not verified)</p>
          <p className="text-xs">What Meta / Google say happened. Includes cancelled, returned and duplicate &quot;purchases&quot; — shown for comparison only.</p>
        </div>
      </div>
    </div>
  );
}

// ───────────── screen ─────────────

export function MarketingScreen() {
  const range = useDateRange();
  const [v, set] = useUrlState(KEYS);
  const tab = TABS.find((t) => t.key === v.tab)?.key ?? "attribution";
  const model = v.model === "first" ? "first" : "last";
  return (
    <div className="space-y-4">
      <PageHeader title="Marketing" description="Which campaigns bring orders that are actually delivered — and what they really cost." />
      <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-white p-2.5">
        <DateRangeControl range={range} />
        {(tab === "attribution" || tab === "campaigns") && (
          <div role="radiogroup" aria-label="Attribution model" className="ml-auto inline-flex rounded-lg border p-0.5 text-sm">
            {(["first", "last"] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={model === m}
                onClick={() => set({ model: m === "last" ? undefined : m })}
                className={cn("rounded-md px-3 py-1.5 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", model === m ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-muted")}
              >
                {m === "first" ? "First touch" : "Last touch"}
              </button>
            ))}
          </div>
        )}
      </div>
      <div role="tablist" aria-label="Marketing views" className="flex gap-1 overflow-x-auto border-b">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            type="button"
            aria-selected={tab === t.key}
            onClick={() => set({ tab: t.key === "attribution" ? undefined : t.key, platform: undefined, campaign: undefined })}
            className={cn(
              "-mb-px shrink-0 border-b-2 px-3 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              tab === t.key ? "border-slate-900 text-slate-900" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === "attribution" && <AttributionTab from={range.from} to={range.to} model={model} />}
      {tab === "campaigns" && <CampaignsTab from={range.from} to={range.to} model={model} />}
      {tab === "reconciliation" && <ReconciliationTab from={range.from} to={range.to} />}
      {tab === "spend" && <AdSpendTab from={range.from} to={range.to} filters={v} set={set} />}
      {tab === "meta" && <MetaTab />}
    </div>
  );
}

// ───────────── attribution ─────────────

function AttributionTab({ from, to, model }: { from: string; to: string; model: "first" | "last" }) {
  const q = useQuery({
    queryKey: ["marketing", "attribution", from, to, model],
    queryFn: () => api<Attribution>("/marketing/attribution", { query: { from, to, model } }),
    placeholderData: keepPreviousData,
  });
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data) return <LoadingRows rows={5} />;
  const d = q.data;
  const t = d.totals;
  const rows = [...d.rows];
  return (
    <div className={cn("space-y-4", q.isFetching && "opacity-70")}>
      <VerifiedVsPlatformLegend />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <KpiCard label="Orders placed" value={num(t.placed)} definition={d.definitions.cohort} basis={["placed"]} />
        <KpiCard label="Delivered orders" value={num(t.delivered)} definition={d.definitions.delivered} basis={["verified"]} />
        <KpiCard emphasis label="Delivered revenue" value={bdt(t.deliveredRevenue)} definition={d.definitions.delivered} basis={["verified"]} />
        <KpiCard label="Ad spend" value={bdt(t.platform.spend)} definition="Imported / recorded ad-platform spend (analytics only)." sub="imported records" />
        <KpiCard label="Delivered-order ROAS" value={roas(t.roas)} definition={d.definitions.roas} sub={`CPA ${t.cpa == null ? "—" : bdt(t.cpa)}`} />
        <KpiCard
          emphasis
          label="Est. net after ads"
          value={bdt(t.estimatedNetProfit.amount)}
          tone={Number(t.estimatedNetProfit.amount) < 0 ? "negative" : "positive"}
          definition={d.definitions.estimatedNetProfit}
          basis={["estimate"]}
        />
      </div>
      <div className="overflow-x-auto rounded-xl border bg-white">
        <table className="w-full min-w-[1100px] text-sm">
          <thead className="border-b">
            <tr>
              <Th className="text-left">Source / medium · campaign ({model} touch)</Th>
              <Th def={d.definitions.cohort}>Placed</Th>
              <Th kind="verified" def={d.definitions.delivered}>Delivered</Th>
              <Th def={d.definitions.cohort}>Returned</Th>
              <Th def={d.definitions.returnRate}>Return rate</Th>
              <Th kind="verified" def={d.definitions.delivered}>Delivered revenue</Th>
              <Th>Ad spend</Th>
              <Th def={d.definitions.cpa}>CPA</Th>
              <Th kind="verified" def={d.definitions.roas}>Delivered ROAS</Th>
              <Th kind="estimate" def={d.definitions.estimatedNetProfit}>Est. net after ads</Th>
              <Th kind="platform" def={t.platform.note}>Reported purchases</Th>
              <Th kind="platform" def={t.platform.note}>Reported revenue</Th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={12} className="p-6 text-center text-muted-foreground">No orders in this range.</td>
              </tr>
            )}
            {rows.map((r, i) => (
              <tr key={`${r.source}-${r.medium}-${r.campaign}-${i}`} className="border-b last:border-0">
                <Td className="max-w-[260px] whitespace-normal">
                  <span className="font-medium">{r.source}</span>
                  {r.medium && <span className="text-muted-foreground"> / {r.medium}</span>}
                  <span className="block text-xs text-muted-foreground">{r.campaign ?? "no campaign"}</span>
                </Td>
                <Td>{num(r.placed)}</Td>
                <Td kind="verified">{num(r.delivered)}</Td>
                <Td>{num(r.returned)}</Td>
                <Td>{pct(r.returnRate)}</Td>
                <Td kind="verified">{bdt(r.deliveredRevenue)}</Td>
                <Td>{Number(r.platform.spend) ? bdt(r.platform.spend) : <span className="text-muted-foreground">—</span>}</Td>
                <Td>{r.cpa && Number(r.cpa) ? bdt(r.cpa) : "—"}</Td>
                <Td kind="verified">{roas(r.roas)}</Td>
                <Td kind="estimate" className={cn(Number(r.estimatedNetProfit.amount) < 0 && "text-red-700")}>
                  <EstimateCell value={r.estimatedNetProfit} />
                </Td>
                <Td kind="platform">{r.platform.reportedPurchases ? num(r.platform.reportedPurchases) : "—"}</Td>
                <Td kind="platform">{Number(r.platform.reportedRevenue) ? bdt(r.platform.reportedRevenue) : "—"}</Td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t bg-muted/40 font-semibold">
            <tr>
              <Td>Total</Td>
              <Td>{num(t.placed)}</Td>
              <Td kind="verified">{num(t.delivered)}</Td>
              <Td>{num(t.returned)}</Td>
              <Td>{pct(t.returnRate)}</Td>
              <Td kind="verified">{bdt(t.deliveredRevenue)}</Td>
              <Td>{bdt(t.platform.spend)}</Td>
              <Td>{t.cpa ? bdt(t.cpa) : "—"}</Td>
              <Td kind="verified">{roas(t.roas)}</Td>
              <Td kind="estimate" className={cn(Number(t.estimatedNetProfit.amount) < 0 && "text-red-700")}>~{bdt(t.estimatedNetProfit.amount)}</Td>
              <Td kind="platform">{num(t.platform.reportedPurchases)}</Td>
              <Td kind="platform">{bdt(t.platform.reportedRevenue)}</Td>
            </tr>
          </tfoot>
        </table>
      </div>
      {Number(d.unattributedSpend.spend) > 0 && (
        <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>
            {bdt(d.unattributedSpend.spend)} of spend ({d.unattributedSpend.records} records) matched no attributed order: {d.unattributedSpend.campaigns.join(", ")}. {d.unattributedSpend.note}.
          </span>
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        Est. net after ads = {d.definitions.estimatedNetProfit}. Figures marked ~ are estimates until courier settlements reconcile fees.
      </p>
    </div>
  );
}

function EstimateCell({ value }: { value: AttributionRow["estimatedNetProfit"] }) {
  const c = value.components;
  return (
    <span className="inline-flex items-center gap-1">
      ~{bdt(value.amount)}
      <Definition
        label="How this estimate is built"
        text={
          <span className="block space-y-0.5">
            <span className="block">Delivered revenue {bdt(c.deliveredRevenue as string)}</span>
            <span className="block">− product cost {bdt(c.productCost as string)}</span>
            <span className="block">− packaging {bdt(c.packaging as string)}</span>
            <span className="block">− courier {bdt(c.courier as string)}{c.courierEstimated ? " (estimated)" : ""}</span>
            <span className="block">− ad spend {bdt(c.adSpend as string)}</span>
          </span>
        }
      />
    </span>
  );
}

// ───────────── campaigns ─────────────

function CampaignsTab({ from, to, model }: { from: string; to: string; model: "first" | "last" }) {
  const q = useQuery({
    queryKey: ["marketing", "campaigns", from, to, model],
    queryFn: () => api<Campaigns>("/marketing/campaigns", { query: { from, to, model } }),
    placeholderData: keepPreviousData,
  });
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data) return <LoadingRows rows={5} />;
  const d = q.data;
  return (
    <div className={cn("space-y-3", q.isFetching && "opacity-70")}>
      <p className="text-sm text-muted-foreground">Quality of the orders each campaign brings: how many get delivered, cancelled or returned. A cheap campaign with a high return rate is not cheap.</p>
      <div className="overflow-x-auto rounded-xl border bg-white">
        <table className="w-full min-w-[1000px] text-sm">
          <thead className="border-b">
            <tr>
              <Th className="text-left">Campaign ({model} touch)</Th>
              <Th>Placed</Th>
              <Th kind="verified" def={d.definitions.deliveryRate}>Delivery rate</Th>
              <Th>Cancel rate</Th>
              <Th def={d.definitions.returnRate}>Return rate</Th>
              <Th def={d.definitions.avgOrderValue}>Avg order value</Th>
              <Th kind="verified">Delivered in range</Th>
              <Th kind="verified">Delivered revenue</Th>
              <Th>Ad spend</Th>
              <Th>CPA</Th>
              <Th kind="verified">Delivered ROAS</Th>
            </tr>
          </thead>
          <tbody>
            {d.rows.length === 0 && (
              <tr>
                <td colSpan={11} className="p-6 text-center text-muted-foreground">No campaigns in this range.</td>
              </tr>
            )}
            {d.rows.map((r) => (
              <tr key={r.campaign} className="border-b last:border-0">
                <Td className="font-medium">{r.campaign}</Td>
                <Td>{num(r.placed)}</Td>
                <Td kind="verified"><RateBar value={r.deliveryRate} good /></Td>
                <Td><RateBar value={r.cancellationRate} /></Td>
                <Td><RateBar value={r.returnRate} /></Td>
                <Td>{r.avgOrderValue ? bdt(r.avgOrderValue) : "—"}</Td>
                <Td kind="verified">{num(r.deliveredInRange)}</Td>
                <Td kind="verified">{bdt(r.deliveredRevenue)}</Td>
                <Td>{Number(r.spend) ? bdt(r.spend) : "—"}</Td>
                <Td>{r.cpa && Number(r.cpa) ? bdt(r.cpa) : "—"}</Td>
                <Td kind="verified">{roas(r.roas)}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {Number(d.unattributedSpend) > 0 && <p className="text-sm text-amber-800">Unattributed spend: {bdt(d.unattributedSpend)}</p>}
    </div>
  );
}

function RateBar({ value, good }: { value: string | null; good?: boolean }) {
  const n = Number(value ?? 0);
  return (
    <span className="inline-flex items-center justify-end gap-2">
      <span className="hidden h-1.5 w-12 overflow-hidden rounded-full bg-slate-100 sm:inline-block">
        <span className="block h-full rounded-full" style={{ width: `${Math.min(100, n)}%`, backgroundColor: good ? MEASURE_COLOR.delivered : MEASURE_COLOR.cost }} />
      </span>
      <span className="w-12">{pct(value)}</span>
    </span>
  );
}

// ───────────── reconciliation ─────────────

function ReconciliationTab({ from, to }: { from: string; to: string }) {
  const q = useQuery({
    queryKey: ["marketing", "reconciliation", from, to],
    queryFn: () => api<Reconciliation>("/marketing/reconciliation", { query: { from, to } }),
    placeholderData: keepPreviousData,
  });
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data) return <LoadingRows rows={5} />;
  const d = q.data;
  const t = d.totals;
  const chart = d.campaigns.map((c) => ({ name: c.campaignName ?? c.campaignId, reported: Number(c.platformReported.revenue), verified: Number(c.verified.deliveredRevenue) }));
  const e = d.expenses;
  return (
    <div className={cn("space-y-4", q.isFetching && "opacity-70")}>
      <VerifiedVsPlatformLegend />
      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-xl border border-slate-300 bg-slate-50 p-4">
          <div className="mb-2 flex items-center justify-between"><BasisTag basis="platform" /><span className="text-xs text-muted-foreground">what the ad platform claims</span></div>
          <dl className="grid grid-cols-3 gap-3 text-slate-600">
            <div><dt className="text-xs">Purchases</dt><dd className="text-xl font-semibold italic tabular-nums">{num(t.reportedPurchases)}</dd></div>
            <div><dt className="text-xs">Revenue</dt><dd className="text-xl font-semibold italic tabular-nums">{bdt(t.reportedRevenue)}</dd></div>
            <div><dt className="text-xs">ROAS</dt><dd className="text-xl font-semibold italic tabular-nums">{Number(t.spend) ? `${(Number(t.reportedRevenue) / Number(t.spend)).toFixed(2)}×` : "—"}</dd></div>
          </dl>
        </div>
        <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-4">
          <div className="mb-2 flex items-center justify-between"><BasisTag basis="verified" /><span className="text-xs text-emerald-800">our delivered orders</span></div>
          <dl className="grid grid-cols-3 gap-3 text-emerald-950">
            <div><dt className="text-xs">Delivered orders</dt><dd className="text-xl font-semibold tabular-nums">{num(t.verifiedDeliveredOrders)} <span className="text-xs font-normal">of {num(t.verifiedPlacedOrders)} placed</span></dd></div>
            <div><dt className="text-xs">Delivered revenue</dt><dd className="text-xl font-semibold tabular-nums">{bdt(t.verifiedDeliveredRevenue)}</dd></div>
            <div><dt className="text-xs">ROAS</dt><dd className="text-xl font-semibold tabular-nums">{Number(t.spend) ? `${(Number(t.verifiedDeliveredRevenue) / Number(t.spend)).toFixed(2)}×` : "—"}</dd></div>
          </dl>
        </div>
      </div>

      <ChartCard
        title="Reported vs verified revenue per campaign"
        empty={!chart.length}
        emptyText="No ad spend records in this range"
        basis={<Legend items={[{ label: "Platform-reported revenue (not verified)", color: "#94a3b8" }, { label: "Verified delivered revenue", color: MEASURE_COLOR.delivered }]} />}
        height={Math.max(200, chart.length * 64)}
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chart} layout="vertical" margin={{ top: 0, right: 16, left: 0, bottom: 0 }} barGap={2} barCategoryGap={12}>
            <CartesianGrid {...GRID} horizontal={false} vertical />
            <XAxis type="number" {...AXIS} tickFormatter={compactBdt} />
            <YAxis type="category" dataKey="name" {...AXIS} width={130} tick={{ fill: "#475569", fontSize: 12 }} interval={0} />
            <RTooltip cursor={{ fill: "#f1f5f9" }} content={<ChartTooltip money />} />
            <Bar isAnimationActive={false} dataKey="reported" name="Platform-reported" fill="#94a3b8" radius={[0, 4, 4, 0]} maxBarSize={18} />
            <Bar isAnimationActive={false} dataKey="verified" name="Verified delivered" fill={MEASURE_COLOR.delivered} radius={[0, 4, 4, 0]} maxBarSize={18} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <div className="overflow-x-auto rounded-xl border bg-white">
        <table className="w-full min-w-[1000px] text-sm">
          <thead className="border-b">
            <tr>
              <Th className="text-left">Campaign</Th>
              <Th>Spend</Th>
              <Th kind="platform">Reported purchases</Th>
              <Th kind="platform">Reported revenue</Th>
              <Th kind="platform">Reported ROAS</Th>
              <Th kind="verified">Placed</Th>
              <Th kind="verified">Delivered</Th>
              <Th kind="verified">Delivered revenue</Th>
              <Th kind="verified">Delivered ROAS</Th>
              <Th def="Platform-reported purchases minus verified delivered orders.">Over-reported</Th>
            </tr>
          </thead>
          <tbody>
            {d.campaigns.length === 0 && (
              <tr><td colSpan={10} className="p-6 text-center text-muted-foreground">No ad spend records in this range. Import spend in the Ad spend tab.</td></tr>
            )}
            {d.campaigns.map((c) => (
              <tr key={`${c.platform}-${c.campaignId}`} className="border-b last:border-0">
                <Td>
                  <span className="font-medium">{c.campaignName ?? c.campaignId}</span>
                  <span className="block text-xs text-muted-foreground">{c.platform} · {c.campaignId || "no id"}</span>
                </Td>
                <Td>{bdt(c.spend)}</Td>
                <Td kind="platform">{num(c.platformReported.purchases)}</Td>
                <Td kind="platform">{bdt(c.platformReported.revenue)}</Td>
                <Td kind="platform">{roas(c.reportedRoas)}</Td>
                <Td kind="verified">{num(c.verified.placedOrders)}</Td>
                <Td kind="verified">{num(c.verified.deliveredOrders)}</Td>
                <Td kind="verified">{bdt(c.verified.deliveredRevenue)}</Td>
                <Td kind="verified">{roas(c.deliveredRoas)}</Td>
                <Td className={cn(c.reportedVsDelivered > 0 && "text-orange-700")}>{c.reportedVsDelivered > 0 ? `+${num(c.reportedVsDelivered)}` : num(c.reportedVsDelivered)}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {t.attributedOrdersWithoutSpendRecord > 0 && <p className="text-sm text-muted-foreground">{num(t.attributedOrdersWithoutSpendRecord)} attributed orders have no matching spend record.</p>}

      <section className="rounded-xl border bg-white p-4">
        <h2 className="mb-1 text-sm font-semibold">Recorded ad expenses vs imported spend</h2>
        <p className="mb-3 text-xs text-muted-foreground">{e.note}</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <KpiCard label="Advertising expenses (P&L)" value={bdt(e.recordedAdvertisingExpenses)} sub={Object.entries(e.byCategory).map(([k, v2]) => `${k} ${bdt(v2)}`).join(" · ") || "none recorded"} basis={["cost"]} />
          <KpiCard label="Imported platform spend" value={bdt(e.importedSpend)} sub={Object.entries(e.importedSpendByPlatform).map(([k, v2]) => `${k} ${bdt(v2)}`).join(" · ")} />
          <KpiCard label="Difference" value={bdt(e.difference)} tone={Number(e.difference) < 0 ? "negative" : undefined} sub={e.status.replaceAll("_", " ").toLowerCase()} />
        </div>
        {!["MATCHED", "NO_DATA"].includes(e.status) && e.message && (
          <p className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {e.message}
          </p>
        )}
      </section>
    </div>
  );
}

// ───────────── ad spend ─────────────

const CSV_COLUMNS = ["date", "platform", "campaign_id", "campaign_name", "adset_id", "ad_id", "spend", "impressions", "clicks", "reported_purchases", "reported_revenue"];

function AdSpendTab({ from, to, filters, set }: { from: string; to: string; filters: Partial<Record<(typeof KEYS)[number], string>>; set: (p: Partial<Record<(typeof KEYS)[number], string | undefined>>) => void }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const manage = can("marketing.manage");
  const [search, setSearch] = useState(filters.campaign ?? "");
  const [deleting, setDeleting] = useState<AdSpend | null>(null);
  const [adding, setAdding] = useState(false);
  const query = { from, to, platform: filters.platform, campaign: filters.campaign, page: filters.page ?? 1, pageSize: 25 };
  const list = useQuery({
    queryKey: ["marketing", "ad-spend", query],
    queryFn: () => request<AdSpend[]>("/marketing/ad-spend", { query }),
    placeholderData: keepPreviousData,
  });
  const totals = list.data?.meta?.totals as { spend: string; impressions: number; clicks: number; reportedPurchases: number; reportedRevenue: string } | undefined;
  const invalidate = () => qc.invalidateQueries({ queryKey: ["marketing"] });

  return (
    <div className="space-y-4">
      {manage && <ImportCard onDone={invalidate} />}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-white p-3">
        <NativeSelect aria-label="Platform" className="w-36" value={filters.platform ?? ""} onChange={(e) => set({ platform: e.target.value || undefined })}>
          <option value="">All platforms</option>
          {PLATFORMS.map((p) => <option key={p} value={p}>{p}</option>)}
        </NativeSelect>
        <form className="relative min-w-52 flex-1" onSubmit={(e) => { e.preventDefault(); set({ campaign: search.trim() || undefined }); }}>
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Campaign name or id" className="h-9 pl-9" aria-label="Search campaign" />
        </form>
        <Button variant="outline" size="icon" className="size-9" aria-label="Refresh" onClick={() => list.refetch()}>
          <RefreshCw className={cn("size-4", list.isFetching && "animate-spin")} />
        </Button>
        {manage && (
          <Button size="sm" className="h-9" onClick={() => setAdding(true)}>
            <Plus className="size-4" /> Add spend
          </Button>
        )}
      </div>
      {totals && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <KpiCard label="Spend" value={bdt(totals.spend)} />
          <KpiCard label="Impressions" value={num(totals.impressions)} />
          <KpiCard label="Clicks" value={num(totals.clicks)} />
          <KpiCard label="Reported purchases" value={num(totals.reportedPurchases)} basis={["platform"]} />
          <KpiCard label="Reported revenue" value={bdt(totals.reportedRevenue)} basis={["platform"]} />
        </div>
      )}
      <p className="text-xs text-muted-foreground">Imported spend is analytics only — it never posts to the ledger. Record ad bills as Advertising expenses for the P&amp;L.</p>
      {list.isError ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : list.isLoading ? (
        <LoadingRows rows={5} />
      ) : !list.data?.data.length ? (
        <EmptyState title="No ad spend records" description="Import a CSV export from Ads Manager or add spend manually." />
      ) : (
        <div className={cn("overflow-x-auto rounded-xl border bg-white", list.isFetching && "opacity-70")}>
          <table className="w-full min-w-[900px] text-sm">
            <thead className="border-b bg-muted/50">
              <tr>
                <Th className="text-left">Date</Th>
                <Th className="text-left">Platform</Th>
                <Th className="text-left">Campaign</Th>
                <Th>Spend</Th>
                <Th>Impressions</Th>
                <Th>Clicks</Th>
                <Th kind="platform">Reported purch.</Th>
                <Th kind="platform">Reported revenue</Th>
                <Th className="text-left">Source</Th>
                {manage && <Th><span className="sr-only">Actions</span></Th>}
              </tr>
            </thead>
            <tbody>
              {list.data.data.map((r) => (
                <tr key={r.id} className="border-b last:border-0">
                  <Td>{r.date.slice(0, 10).split("-").reverse().join("/")}</Td>
                  <td className="px-3 py-2"><Pill tone="blue">{r.platform}</Pill></td>
                  <td className="max-w-[260px] px-3 py-2">
                    <span className="block truncate font-medium">{r.campaignName ?? r.campaignId}</span>
                    <span className="block truncate text-xs text-muted-foreground">{[r.campaignId, r.adsetId, r.adId].filter(Boolean).join(" · ")}</span>
                  </td>
                  <Td>{bdt(r.spend)}</Td>
                  <Td>{num(r.impressions)}</Td>
                  <Td>{num(r.clicks)}</Td>
                  <Td kind="platform">{num(r.reportedPurchases)}</Td>
                  <Td kind="platform">{bdt(r.reportedRevenue)}</Td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{r.source}</td>
                  {manage && (
                    <td className="px-1 py-1 text-right">
                      <IconAction label="Delete record" onClick={() => setDeleting(r)}><Trash2 className="size-4" /></IconAction>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination meta={list.data?.meta as PageMeta | undefined} onPage={(p) => set({ page: String(p) })} />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete this ad spend record?"
        description={deleting ? `${deleting.campaignName ?? deleting.campaignId} · ${deleting.date.slice(0, 10)} · ${bdt(deleting.spend)}. ROAS and CPA reports will change.` : undefined}
        destructive
        confirmLabel="Delete"
        onConfirm={async () => {
          await api(`/marketing/ad-spend/${deleting!.id}`, { method: "DELETE" });
          toast.success("Ad spend record deleted");
          invalidate();
        }}
      />
      <ManualSpendDialog open={adding} onClose={() => setAdding(false)} onSaved={invalidate} />
    </div>
  );
}

function ImportCard({ onDone }: { onDone: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [platform, setPlatform] = useState("META");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [headerErrors, setHeaderErrors] = useState<string[] | null>(null);
  const upload = useMutation({
    mutationFn: () => {
      const form = new FormData();
      form.append("file", file!);
      form.append("platform", platform);
      return api<ImportResult>("/marketing/ad-spend/import", { method: "POST", body: form });
    },
    onMutate: () => { setResult(null); setHeaderErrors(null); },
    onSuccess: (r) => {
      setResult(r);
      toast[r.failed ? "warning" : "success"](`Imported ${r.created} new, ${r.updated} updated${r.failed ? `, ${r.failed} rows skipped` : ""}`);
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      onDone();
    },
    onError: (e) => {
      if (e instanceof ApiError && Array.isArray(e.details) && e.details.every((x) => typeof x === "string")) setHeaderErrors(e.details as string[]);
      toast.error(errorMessage(e));
    },
  });
  return (
    <section className="rounded-xl border bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Import ad spend CSV</h2>
          <p className="mt-0.5 max-w-2xl text-xs text-muted-foreground">
            Expected columns (case-insensitive): <code className="rounded bg-muted px-1">{CSV_COLUMNS.join(", ")}</code>. Required: date (YYYY-MM-DD), spend (BDT) and campaign_id or campaign_name. Meta Ads Manager exports (Day, Campaign name, Amount spent (BDT), Purchases…) work as-is. Re-importing the same file updates rows instead of duplicating them. Max 2 MB.
          </p>
        </div>
      </div>
      <form
        className="mt-3 flex flex-wrap items-end gap-2"
        onSubmit={(e) => { e.preventDefault(); if (file) upload.mutate(); }}
      >
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          CSV file
          <Input ref={fileRef} type="file" accept=".csv,text/csv" className="h-9 w-72" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Platform (if no column)
          <NativeSelect className="w-36" value={platform} onChange={(e) => setPlatform(e.target.value)}>
            {PLATFORMS.map((p) => <option key={p} value={p}>{p}</option>)}
          </NativeSelect>
        </label>
        <Button type="submit" size="sm" className="h-9" disabled={!file || upload.isPending}>
          {upload.isPending ? <Loader2 className="size-4 animate-spin" /> : <FileUp className="size-4" />} Import
        </Button>
      </form>
      {headerErrors && (
        <div role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <p className="font-medium">Nothing was imported — the header is not usable:</p>
          <ul className="ml-4 list-disc">{headerErrors.map((h) => <li key={h}>{h}</li>)}</ul>
        </div>
      )}
      {result && (
        <div className="mt-3 space-y-2 rounded-lg border bg-muted/30 p-3 text-sm">
          <div className="flex flex-wrap gap-x-5 gap-y-1">
            <span>Rows: <b>{num(result.totalRows)}</b></span>
            <span className="text-emerald-700">Created: <b>{num(result.created)}</b></span>
            <span className="text-blue-700">Updated: <b>{num(result.updated)}</b></span>
            <span className={cn(result.failed ? "text-red-700" : "text-muted-foreground")}>Skipped: <b>{num(result.failed)}</b></span>
            <span>Spend imported: <b>{bdt(result.totalSpend)}</b></span>
            <span className="text-xs text-muted-foreground">Batch {result.importBatch}</span>
          </div>
          {result.errors.length > 0 && (
            <div className="max-h-48 overflow-y-auto rounded border border-red-200 bg-white">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-red-50 text-left text-red-900"><tr><th className="px-2 py-1">Row</th><th className="px-2 py-1">Problem</th></tr></thead>
                <tbody>
                  {result.errors.map((er) => (
                    <tr key={er.row} className="border-t"><td className="px-2 py-1 tabular-nums">{er.row}</td><td className="px-2 py-1">{er.messages.join("; ")}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

const optionalInt = z.string().trim().regex(/^\d*$/, "Whole number").optional();
const spendSchema = z
  .object({
    platform: z.enum(PLATFORMS),
    date: z.string().regex(DATE_RE, "Pick a date"),
    campaignId: z.string().trim().max(100).optional(),
    campaignName: z.string().trim().max(300).optional(),
    adsetId: z.string().trim().max(100).optional(),
    adId: z.string().trim().max(100).optional(),
    spend: z.string().trim().regex(MONEY_RE, "Enter an amount like 1500 or 1500.50"),
    impressions: optionalInt,
    clicks: optionalInt,
    reportedPurchases: optionalInt,
    reportedRevenue: z.string().trim().regex(MONEY_RE, "Invalid amount").optional().or(z.literal("")),
  })
  .refine((v) => v.campaignId || v.campaignName, { message: "Campaign id or name is required", path: ["campaignName"] });
type SpendForm = z.infer<typeof spendSchema>;

function ManualSpendDialog({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const today = dhakaToday();
  const form = useForm<SpendForm>({ resolver: zodResolver(spendSchema), defaultValues: { platform: "META", date: today, spend: "" } });
  const { register, handleSubmit, formState: { errors, isSubmitting }, reset, setError } = form;
  const submit = handleSubmit(async (v) => {
    try {
      const int = (s?: string) => (s ? Number(s) : 0);
      const r = await api<{ created: boolean }>("/marketing/ad-spend", {
        method: "POST",
        body: {
          platform: v.platform, date: v.date, campaignId: v.campaignId ?? "", campaignName: v.campaignName || null, adsetId: v.adsetId ?? "", adId: v.adId ?? "",
          spend: v.spend, impressions: int(v.impressions), clicks: int(v.clicks), reportedPurchases: int(v.reportedPurchases), reportedRevenue: v.reportedRevenue || "0",
        },
      });
      toast.success(r.created ? "Ad spend recorded" : "Existing record for that day/campaign updated");
      reset({ platform: v.platform, date: v.date, spend: "" });
      onSaved();
      onClose();
    } catch (e) {
      handleFormError(e, setError);
    }
  });
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add ad spend</DialogTitle>
          <DialogDescription>One day of spend for a campaign (or ad set / ad). The same platform + date + campaign + ad set + ad replaces the earlier figure.</DialogDescription>
        </DialogHeader>
        <form id="spend-form" onSubmit={submit} className="grid gap-3 sm:grid-cols-2" noValidate>
          <Field label="Platform" htmlFor="sp-platform" error={errors.platform?.message}>
            <NativeSelect id="sp-platform" {...register("platform")}>{PLATFORMS.map((p) => <option key={p} value={p}>{p}</option>)}</NativeSelect>
          </Field>
          <Field label="Date" htmlFor="sp-date" error={errors.date?.message}>
            <Input id="sp-date" type="date" {...register("date")} />
          </Field>
          <Field label="Campaign name" htmlFor="sp-cname" error={errors.campaignName?.message}>
            <Input id="sp-cname" {...register("campaignName")} placeholder="must match utm_campaign" />
          </Field>
          <Field label="Campaign id" htmlFor="sp-cid" error={errors.campaignId?.message}>
            <Input id="sp-cid" {...register("campaignId")} />
          </Field>
          <Field label="Ad set id (optional)" htmlFor="sp-adset" error={errors.adsetId?.message}>
            <Input id="sp-adset" {...register("adsetId")} />
          </Field>
          <Field label="Ad id (optional)" htmlFor="sp-ad" error={errors.adId?.message}>
            <Input id="sp-ad" {...register("adId")} />
          </Field>
          <Field label="Spend (BDT)" htmlFor="sp-spend" error={errors.spend?.message}>
            <Input id="sp-spend" inputMode="decimal" {...register("spend")} />
          </Field>
          <Field label="Impressions" htmlFor="sp-imp" error={errors.impressions?.message}>
            <Input id="sp-imp" inputMode="numeric" {...register("impressions")} />
          </Field>
          <Field label="Clicks" htmlFor="sp-clicks" error={errors.clicks?.message}>
            <Input id="sp-clicks" inputMode="numeric" {...register("clicks")} />
          </Field>
          <Field label="Reported purchases" htmlFor="sp-rp" error={errors.reportedPurchases?.message} hint="platform-reported">
            <Input id="sp-rp" inputMode="numeric" {...register("reportedPurchases")} />
          </Field>
          <Field label="Reported revenue (BDT)" htmlFor="sp-rr" error={errors.reportedRevenue?.message} hint="platform-reported, not verified">
            <Input id="sp-rr" inputMode="decimal" {...register("reportedRevenue")} />
          </Field>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="spend-form" disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="size-4 animate-spin" />} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ───────────── Meta ─────────────

const EVENT_TONE: Record<string, "green" | "red" | "gray" | "amber" | "sky"> = { SENT: "green", FAILED: "red", SKIPPED: "gray", PENDING: "amber", DUPLICATE: "sky" };

function MetaTab() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [code, setCode] = useState("");
  const [confirm, setConfirm] = useState(false);
  const q = useQuery({ queryKey: ["marketing", "meta"], queryFn: () => api<MetaStatus>("/marketing/meta/status", { query: { limit: 25 } }) });
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data) return <LoadingRows rows={4} />;
  const m = q.data;
  const checks: [string, boolean, string?][] = [
    ["Pixel ID", m.pixelConfigured, m.pixelId ?? "not set"],
    ["Conversions API enabled in settings", m.capiEnabled],
    ["Access token configured", m.accessTokenConfigured, "server environment, never shown"],
    ["Test event code configured", m.testEventCodeConfigured],
  ];
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
      <section className="space-y-3 rounded-xl border bg-white p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Configuration</h2>
          {m.capiActive ? <Pill tone="green">CAPI active</Pill> : <Pill tone="gray">CAPI inactive</Pill>}
        </div>
        <ul className="space-y-2 text-sm">
          {checks.map(([label, ok, hint]) => (
            <li key={label} className="flex items-start gap-2">
              {ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-label="Yes" /> : <XCircle className="mt-0.5 size-4 shrink-0 text-slate-400" aria-label="No" />}
              <span>
                {label}
                {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
              </span>
            </li>
          ))}
        </ul>
        {m.inactiveReason && <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-900">{m.inactiveReason}</p>}
        <dl className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
          <div><dt>Graph API</dt><dd className="font-medium text-foreground">{m.graphApiVersion}</dd></div>
          <div><dt>Purchase event id</dt><dd className="font-mono text-foreground">{m.purchaseEventIdFormat}</dd></div>
        </dl>
        <div>
          <p className="mb-1 text-xs font-medium text-muted-foreground">Server events, last 7 days</p>
          <div className="flex flex-wrap gap-1.5">
            {Object.keys(m.last7Days).length === 0 ? <span className="text-sm text-muted-foreground">None</span> : Object.entries(m.last7Days).map(([k, n]) => <Pill key={k} tone={EVENT_TONE[k] ?? "gray"}>{k.toLowerCase()} · {n}</Pill>)}
          </div>
        </div>
        {can("marketing.manage") && (
          <div className="space-y-2 border-t pt-3">
            <Field label="Test event code (optional)" htmlFor="meta-test" hint="From Events Manager → Test events. Falls back to META_TEST_EVENT_CODE.">
              <Input id="meta-test" value={code} onChange={(e) => setCode(e.target.value)} placeholder="TEST12345" />
            </Field>
            <Button size="sm" variant="outline" disabled={!m.capiActive} onClick={() => setConfirm(true)} title={m.capiActive ? undefined : "Configure the Conversions API first"}>
              <Send className="size-4" /> Send test event
            </Button>
          </div>
        )}
      </section>
      <section className="min-w-0 rounded-xl border bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Recent server events</h2>
          <Button variant="outline" size="icon" className="size-8" aria-label="Refresh" onClick={() => q.refetch()}>
            <RefreshCw className={cn("size-4", q.isFetching && "animate-spin")} />
          </Button>
        </div>
        {m.recentEvents.length === 0 ? (
          <EmptyState title="No events sent yet" description="Purchase events are sent when orders are placed while the Conversions API is active." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="border-b text-left text-xs text-muted-foreground">
                <tr><th className="py-2 pr-3 font-medium">Time</th><th className="py-2 pr-3 font-medium">Event</th><th className="py-2 pr-3 font-medium">Event id</th><th className="py-2 pr-3 font-medium">Status</th><th className="py-2 font-medium">Error</th></tr>
              </thead>
              <tbody>
                {m.recentEvents.map((ev) => (
                  <tr key={ev.id} className="border-b last:border-0">
                    <td className="whitespace-nowrap py-2 pr-3">{dhakaDateTime(ev.createdAt)}</td>
                    <td className="py-2 pr-3">{ev.eventName}</td>
                    <td className="max-w-[200px] truncate py-2 pr-3 font-mono text-xs">{ev.eventId}</td>
                    <td className="py-2 pr-3"><Pill tone={EVENT_TONE[ev.status] ?? "gray"}>{ev.status.toLowerCase()}</Pill></td>
                    <td className="max-w-[240px] truncate py-2 text-xs text-red-700" title={ev.error ?? undefined}>{ev.error ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Send a test event to Meta?"
        description="Sends a PageView test event (no customer data) that appears under Events Manager → Test events."
        confirmLabel="Send"
        onConfirm={async () => {
          const r = await api<{ status: string; reason?: string }>("/marketing/meta/test", { method: "POST", body: { testEventCode: code || undefined } });
          toast[r.status === "SENT" ? "success" : "warning"](`Test event: ${r.status.toLowerCase()}${r.reason ? ` – ${r.reason}` : ""}`);
          qc.invalidateQueries({ queryKey: ["marketing", "meta"] });
        }}
      />
    </div>
  );
}
