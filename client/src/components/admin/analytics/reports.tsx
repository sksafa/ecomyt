"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Download, FileSpreadsheet, Info, Lock, RefreshCw } from "lucide-react";
import { api, ApiError, download, request, type PageMeta } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { bdt, num, titleCase } from "@/lib/format";
import { CHANNELS, ORDER_STATUS, ORDER_STATUSES, PAYMENT_TONE, SHIPMENT_TONE, type OrderStatus } from "@/lib/status";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, ErrorState, LoadingRows, NativeSelect, PageHeader, Pagination, Pill } from "@/components/admin/ui";
import { useCourierProviders } from "@/components/admin/orders/order-dialogs";
import { DateRangeControl, fmtDay, useDateRange } from "./date-range";
import { useUrlState } from "./url-state";

interface ReportType { type: string; title: string; description: string; paginated: boolean; requires: string[]; available: boolean }
interface ReportColumn { key: string; label: string; money?: boolean }
interface ReportResult {
  type: string;
  title: string;
  description: string;
  range: { from: string; to: string; timezone: string };
  financeVisible: boolean;
  columns: ReportColumn[];
  totals: Record<string, unknown>;
  notes: string[];
  rows: Record<string, unknown>[];
}

type FilterKind = "status" | "channel" | "provider";
/** Which filters each report honours on the server (see reports.service.ts). */
const REPORT_FILTERS: Record<string, FilterKind[]> = {
  orders: ["status", "channel"],
  "delivered-sales": ["status", "channel"],
  returns: ["status", "channel"],
  "courier-performance": ["channel", "provider"],
  "cod-settlement": ["provider"],
  customers: ["channel"],
  "product-sales": ["channel"],
  purchases: ["status"],
  marketing: ["channel"],
};
const STATUS_OPTIONS: Record<string, readonly string[]> = {
  orders: ORDER_STATUSES,
  "delivered-sales": ORDER_STATUSES,
  returns: ["REQUESTED", "APPROVED", "REJECTED", "PICKUP_BOOKED", "IN_TRANSIT", "RECEIVED", "INSPECTED", "COMPLETED", "CANCELLED"],
  purchases: ["DRAFT", "ORDERED", "PARTIALLY_RECEIVED", "RECEIVED", "CANCELLED"],
};

const KEYS = ["type", "status", "channel", "providerId", "page", "pageSize"] as const;
const isMoneyString = (v: unknown) => typeof v === "string" && /^-?\d+\.\d{2}$/.test(v);
const label = (k: string) => titleCase(k.replace(/([a-z])([A-Z])/g, "$1_$2")).replace(/\bPct\b/, "%").replace(/\bCod\b/, "COD").replace(/\bRoas\b/, "ROAS");

function Cell({ col, value }: { col: ReportColumn; value: unknown }) {
  if (value === null || value === undefined || value === "") return <span className="text-muted-foreground">—</span>;
  if (/roas/i.test(col.key)) return <span className="tabular-nums">{Number(value).toFixed(2)}×</span>;
  if (col.money) return <span className={cn("tabular-nums", Number(value) < 0 && "text-red-700")}>{bdt(value as string)}</span>;
  if (typeof value === "boolean") return <>{value ? "Yes" : "No"}</>;
  if (typeof value === "number") return <span className="tabular-nums">{/pct/i.test(col.key) ? `${value}%` : num(value)}</span>;
  if (typeof value === "string") {
    if (/status/i.test(col.key)) {
      if (value in ORDER_STATUS) return <Pill tone={ORDER_STATUS[value as OrderStatus].tone}>{ORDER_STATUS[value as OrderStatus].en}</Pill>;
      if (value in PAYMENT_TONE) return <Pill tone={PAYMENT_TONE[value]}>{titleCase(value)}</Pill>;
      if (value in SHIPMENT_TONE) return <Pill tone={SHIPMENT_TONE[value]}>{titleCase(value)}</Pill>;
      return <Pill tone="gray">{titleCase(value)}</Pill>;
    }
    if (/pct/i.test(col.key) && /^-?\d+(\.\d+)?$/.test(value)) return <span className="tabular-nums">{value}%</span>;
    return <>{value}</>;
  }
  return <>{JSON.stringify(value)}</>;
}

function TotalValue({ k, v }: { k: string; v: unknown }) {
  if (v === null || v === undefined) return <>—</>;
  if (/roas/i.test(k) && v !== "") return <>{String(v)}×</>;
  if (isMoneyString(v)) return <>{bdt(v as string)}</>;
  if (typeof v === "number") return <>{/pct/i.test(k) ? `${v}%` : num(v)}</>;
  if (typeof v === "string") return <>{/pct/i.test(k) ? `${v}%` : v}</>;
  return null;
}

/** Totals that are not plain column sums (nested breakdowns, cash, rates). */
function TotalsPanel({ totals, columnKeys }: { totals: Record<string, unknown>; columnKeys: Set<string> }) {
  const scalars = Object.entries(totals).filter(([k, v]) => !columnKeys.has(k) && (v === null || typeof v !== "object"));
  const nested = Object.entries(totals).filter(([, v]) => v !== null && typeof v === "object");
  if (!scalars.length && !nested.length) return null;
  return (
    <div className="space-y-3 rounded-xl border bg-white p-4">
      <h3 className="text-sm font-semibold">Summary</h3>
      {scalars.length > 0 && (
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3 lg:grid-cols-5">
          {scalars.map(([k, v]) => (
            <div key={k}>
              <dt className="text-xs text-muted-foreground">{label(k)}</dt>
              <dd className="font-semibold tabular-nums"><TotalValue k={k} v={v} /></dd>
            </div>
          ))}
        </dl>
      )}
      {nested.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {nested.map(([k, v]) => (
            <div key={k} className="min-w-0">
              <p className="mb-1 text-xs font-medium text-muted-foreground">{label(k)}</p>
              {Array.isArray(v) ? (
                <ul className="space-y-0.5 text-sm">
                  {v.length === 0 && <li className="text-muted-foreground">None</li>}
                  {v.map((item, i) => {
                    const o = item as Record<string, unknown>;
                    const name = String(o.name ?? o.type ?? o.label ?? o.status ?? i + 1);
                    const rest = Object.entries(o).filter(([kk]) => !["name", "label"].includes(kk) && !(kk === "type" && o.name) && !(kk === "status" && !o.name && !o.type));
                    return (
                      <li key={i} className="flex justify-between gap-3">
                        <span className="truncate">{ORDER_STATUS[name as OrderStatus]?.en ?? titleCase(name)}{o.type && o.name ? <span className="text-muted-foreground"> · {titleCase(String(o.type))}</span> : null}</span>
                        <span className="shrink-0 tabular-nums">
                          {rest.filter(([kk]) => kk !== "type").map(([kk, vv]) => (
                            <span key={kk} className="ml-2"><TotalValue k={kk} v={vv} /></span>
                          ))}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <ul className="space-y-0.5 text-sm">
                  {Object.entries(v as Record<string, unknown>).map(([kk, vv]) => (
                    <li key={kk} className="flex justify-between gap-3">
                      <span>{ORDER_STATUS[kk as OrderStatus]?.en ?? label(kk)}</span>
                      <span className="tabular-nums"><TotalValue k={kk} v={vv} /></span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function ReportsScreen() {
  const { can } = useAuth();
  const range = useDateRange();
  const [v, set] = useUrlState(KEYS);
  const providers = useCourierProviders();
  const types = useQuery({ queryKey: ["reports", "types"], queryFn: () => api<ReportType[]>("/reports"), staleTime: 5 * 60_000 });
  const available = types.data?.filter((t) => t.available) ?? [];
  const type = types.data?.find((t) => t.type === v.type && t.available)?.type ?? available[0]?.type;
  const meta = types.data?.find((t) => t.type === type);
  const filters = REPORT_FILTERS[type ?? ""] ?? [];
  const query = {
    from: range.from,
    to: range.to,
    status: filters.includes("status") ? v.status : undefined,
    channel: filters.includes("channel") ? v.channel : undefined,
    providerId: filters.includes("provider") ? v.providerId : undefined,
    page: meta?.paginated ? (v.page ?? 1) : undefined,
    pageSize: meta?.paginated ? (v.pageSize ?? 50) : undefined,
  };
  const report = useQuery({
    queryKey: ["reports", type, query],
    queryFn: () => request<ReportResult>(`/reports/${type}`, { query }),
    enabled: !!type,
    placeholderData: keepPreviousData,
  });
  const r = report.data?.data;
  const pageMeta = report.data?.meta as (PageMeta & { total: number }) | undefined;
  const columnKeys = new Set(r?.columns.map((c) => c.key) ?? []);
  const hasFooter = !!r && r.columns.some((c) => c.key in r.totals && (typeof r.totals[c.key] !== "object" || r.totals[c.key] === null));
  const exportQuery = { ...query, page: undefined, pageSize: undefined };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Reports"
        description="Every report uses Asia/Dhaka business days. Money columns are hidden unless you have finance access."
        actions={
          can("reports.export") && type ? (
            <>
              <Button variant="outline" size="sm" onClick={() => download(`/reports/${type}/export`, { ...exportQuery, format: "csv" })}>
                <Download className="size-4" /> Export CSV
              </Button>
              <Button variant="outline" size="sm" onClick={() => download(`/reports/${type}/export`, { ...exportQuery, format: "xlsx" })}>
                <FileSpreadsheet className="size-4" /> Export Excel
              </Button>
            </>
          ) : undefined
        }
      />
      {types.isError ? (
        <ErrorState error={types.error} onRetry={() => types.refetch()} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
          {/* picker */}
          <nav aria-label="Report types" className="hidden lg:block">
            {types.isLoading ? (
              <LoadingRows rows={8} className="[&>*]:h-10" />
            ) : (
              <ul className="space-y-1 rounded-xl border bg-white p-2">
                {types.data?.map((t) => (
                  <li key={t.type}>
                    <button
                      type="button"
                      disabled={!t.available}
                      aria-current={t.type === type ? "page" : undefined}
                      onClick={() => set({ type: t.type, status: undefined, providerId: undefined })}
                      title={t.available ? t.description : `Requires ${t.requires.join(", ")}`}
                      className={cn(
                        "flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        t.type === type ? "bg-slate-900 font-medium text-white" : "text-slate-700 hover:bg-muted",
                        !t.available && "cursor-not-allowed opacity-50 hover:bg-transparent",
                      )}
                    >
                      {t.title}
                      {!t.available && <Lock className="size-3.5" aria-label="No access" />}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </nav>

          <div className="min-w-0 space-y-4">
            <div className="flex flex-wrap items-end gap-2 rounded-xl border bg-white p-3">
              <label className="flex w-full flex-col gap-1 text-xs text-muted-foreground lg:hidden">
                Report
                <NativeSelect value={type ?? ""} onChange={(e) => set({ type: e.target.value, status: undefined, providerId: undefined })}>
                  {types.data?.map((t) => (
                    <option key={t.type} value={t.type} disabled={!t.available}>
                      {t.title}{t.available ? "" : " (no access)"}
                    </option>
                  ))}
                </NativeSelect>
              </label>
              <DateRangeControl range={range} />
              <div className="ml-auto flex flex-wrap gap-2">
                {filters.includes("status") && (
                  <NativeSelect aria-label="Status" className="w-44" value={v.status ?? ""} onChange={(e) => set({ status: e.target.value || undefined })}>
                    <option value="">Any status</option>
                    {(STATUS_OPTIONS[type ?? ""] ?? []).map((s) => (
                      <option key={s} value={s}>{ORDER_STATUS[s as OrderStatus]?.en ?? titleCase(s)}</option>
                    ))}
                  </NativeSelect>
                )}
                {filters.includes("channel") && (
                  <NativeSelect aria-label="Channel" className="w-40" value={v.channel ?? ""} onChange={(e) => set({ channel: e.target.value || undefined })}>
                    <option value="">All channels</option>
                    {CHANNELS.map((c) => <option key={c} value={c}>{titleCase(c)}</option>)}
                  </NativeSelect>
                )}
                {filters.includes("provider") && (
                  <NativeSelect aria-label="Courier" className="w-48" value={v.providerId ?? ""} onChange={(e) => set({ providerId: e.target.value || undefined })}>
                    <option value="">All couriers</option>
                    {providers.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </NativeSelect>
                )}
                {meta?.paginated && (
                  <NativeSelect aria-label="Rows per page" className="w-24" value={v.pageSize ?? "50"} onChange={(e) => set({ pageSize: e.target.value })}>
                    {[25, 50, 100, 200].map((n) => <option key={n} value={n}>{n} rows</option>)}
                  </NativeSelect>
                )}
                <Button variant="outline" size="icon" className="size-9" aria-label="Refresh" onClick={() => report.refetch()}>
                  <RefreshCw className={cn("size-4", report.isFetching && "animate-spin")} />
                </Button>
              </div>
            </div>

            {meta && (
              <div>
                <h2 className="text-lg font-semibold">{meta.title}</h2>
                <p className="text-sm text-muted-foreground">
                  {meta.description} · {fmtDay(range.from)} – {fmtDay(range.to)}
                </p>
              </div>
            )}

            {report.isError ? (
              report.error instanceof ApiError && report.error.status === 403 ? (
                <EmptyState icon={<Lock className="size-8" />} title="You don't have access to this report" description={report.error.message} />
              ) : (
                <ErrorState error={report.error} onRetry={() => report.refetch()} />
              )
            ) : !r ? (
              <LoadingRows rows={6} />
            ) : (
              <>
                {r.notes.length > 0 && (
                  <div className="flex gap-2 rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">
                    <Info className="mt-0.5 size-4 shrink-0" />
                    <ul className="space-y-0.5">
                      {r.notes.map((n) => <li key={n}>{n}</li>)}
                    </ul>
                  </div>
                )}
                {!r.financeVisible && <p className="text-xs text-muted-foreground">Money columns are hidden for your role.</p>}
                <TotalsPanel totals={r.totals} columnKeys={columnKeys} />
                <div className={cn("overflow-hidden rounded-xl border bg-white", report.isFetching && "opacity-70")}>
                  {r.rows.length === 0 ? (
                    <div className="p-4"><EmptyState title="No rows for this range" description="Try a wider date range or clear the filters." /></div>
                  ) : (
                    <Table>
                      <TableHeader className="bg-muted/50">
                        <TableRow>
                          {r.columns.map((c) => (
                            <TableHead key={c.key} className={cn("whitespace-nowrap", c.money && "text-right")}>{c.label}</TableHead>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {r.rows.map((row, i) => (
                          <TableRow key={i}>
                            {r.columns.map((c) => (
                              <TableCell key={c.key} className={cn("whitespace-nowrap", c.money && "text-right")}>
                                <Cell col={c} value={row[c.key]} />
                              </TableCell>
                            ))}
                          </TableRow>
                        ))}
                      </TableBody>
                      {hasFooter && (
                        <TableFooter>
                          <TableRow className="font-semibold">
                            {r.columns.map((c, i) => {
                              const t = r.totals[c.key];
                              return (
                                <TableCell key={c.key} className={cn("whitespace-nowrap", c.money && "text-right")}>
                                  {c.key in r.totals && (t === null || typeof t !== "object") ? (
                                    /roas/i.test(c.key) ? `${t}×` : c.money ? bdt(t as string) : <TotalValue k={c.key} v={t} />
                                  ) : i === 0 ? (
                                    meta?.paginated ? "Total (all pages)" : "Total"
                                  ) : null}
                                </TableCell>
                              );
                            })}
                          </TableRow>
                        </TableFooter>
                      )}
                    </Table>
                  )}
                </div>
                {meta?.paginated ? (
                  <Pagination meta={pageMeta} onPage={(p) => set({ page: String(p) })} />
                ) : (
                  <p className="text-sm text-muted-foreground">{num(r.rows.length)} rows</p>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
