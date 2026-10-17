import { z } from "zod";
import ExcelJS from "exceljs";
import { createModule, csvList, dateRangeQuery, pageMeta, pageQuery, withMeta } from "../../http/route.js";
import { prisma } from "../../lib/prisma.js";
import { audit } from "../../lib/audit.js";
import { resolveRange } from "./common.js";
import { dashboardCharts, dashboardSummary } from "./dashboard.service.js";
import { REPORT_TYPES, REPORTS, runReport, type ReportFilters } from "./reports.service.js";

export const dashboardModule = createModule("/dashboard", "Dashboard");
export const reportsModule = createModule("/reports", "Reports");

const channelEnum = z.enum(["WEBSITE", "FACEBOOK", "INSTAGRAM", "WHATSAPP", "PHONE", "MANUAL", "OTHER"]);
const channelList = csvList.pipe(z.array(channelEnum).optional());

const dashboardQuery = dateRangeQuery.extend({ channel: channelList, productId: z.string().min(1).optional() });

dashboardModule.route({
  method: "get",
  path: "/summary",
  summary: "KPI summary (orders placed / confirmed / delivered, revenue, collected cash, profit)",
  description:
    "All dates are Asia/Dhaka business days; default range is the last 30 days. Status counts are orders placed in the range by current status. " +
    "Money fields (grossSales, deliveredSales, collectedPayments, outstandingCod, advertisingSpend, productCost, courierExpenses, returnCosts, grossProfit, estimatedNetProfit) " +
    "are only returned with finance.view. `definitions` explains every figure.",
  access: "dashboard.view",
  query: dashboardQuery,
  handler: ({ query, user }) => dashboardSummary(resolveRange(query.from, query.to), { channel: query.channel, productId: query.productId }, user),
});

dashboardModule.route({
  method: "get",
  path: "/charts",
  summary: "Chart series (Dhaka-bucketed sales/orders, status, product/channel/courier revenue, rates, profitability, best/slow sellers)",
  description: "Financial series (salesOverTime, salesVsExpenses, revenueBy*, averageOrderValue, adCostPerDeliveredOrder, customerAcquisitionCost, productProfitability) require finance.view.",
  access: "dashboard.view",
  query: dashboardQuery.extend({ granularity: z.enum(["day", "week", "month", "year"]).default("day") }),
  handler: ({ query, user }) =>
    dashboardCharts(resolveRange(query.from, query.to), query.granularity, { channel: query.channel, productId: query.productId }, user),
});

// ───────────── reports ─────────────

const typeParam = z.object({ type: z.enum(REPORT_TYPES) });
const reportFilters = dateRangeQuery.extend({
  status: csvList,
  channel: channelList,
  productId: z.string().min(1).optional(),
  providerId: z.string().min(1).optional(),
});
const filtersOf = (q: z.infer<typeof reportFilters>): ReportFilters => ({ status: q.status, channel: q.channel, productId: q.productId, providerId: q.providerId });

reportsModule.route({
  method: "get",
  path: "/",
  summary: "Available report types",
  access: "reports.view",
  handler: ({ user }) =>
    Object.entries(REPORTS).map(([type, d]) => ({
      type, title: d.title, description: d.description, paginated: d.paginated, requires: d.requires ?? [],
      available: (d.requires ?? []).every((p) => user.permissions.has(p)),
    })),
});

reportsModule.route({
  method: "get",
  path: "/:type",
  summary: "Run a report (JSON rows + totals for a Dhaka date range)",
  description:
    `Types: ${REPORT_TYPES.join(", ")}. Money columns are removed without finance.view; cod-settlement, expenses and profit-and-loss require finance.view; staff-activity requires audit.view. ` +
    "Filters: status, channel, productId, providerId (where applicable).",
  access: "reports.view",
  params: typeParam,
  query: reportFilters.merge(pageQuery),
  handler: async ({ params, query, user }) => {
    const report = await runReport(params.type, { r: resolveRange(query.from, query.to), page: query.page, pageSize: query.pageSize, f: filtersOf(query), user });
    const { rows, total, paginated, ...rest } = report;
    return withMeta({ ...rest, rows }, { ...(paginated ? pageMeta(query.page, query.pageSize, total) : { total }) });
  },
});

const EXPORT_LIMIT = 50_000;

/** Neutralise spreadsheet formula injection (=, +, -, @, tab, CR); plain numbers are left alone. */
export function safeCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = typeof v === "object" ? JSON.stringify(v) : String(v);
  if (/^-?\d+(\.\d+)?$/.test(s)) return s;
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}
const csvField = (v: unknown) => {
  const s = safeCell(v);
  return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};

reportsModule.route({
  method: "get",
  path: "/:type/export",
  summary: "Export a report as CSV (UTF-8 with BOM) or XLSX",
  description: "Same data and permission rules as GET /reports/{type}; up to 50,000 rows. Every export is written to the audit log.",
  access: ["reports.view", "reports.export"],
  raw: true,
  params: typeParam,
  query: reportFilters.extend({ format: z.enum(["csv", "xlsx"]).default("csv") }),
  handler: async ({ params, query, user, res, ip }) => {
    const r = resolveRange(query.from, query.to);
    const report = await runReport(params.type, { r, page: 1, pageSize: EXPORT_LIMIT, f: filtersOf(query), user });
    await audit(prisma, {
      userId: user.id, action: "report.exported", entityType: "Report", entityId: params.type,
      after: { type: params.type, format: query.format, from: r.from, to: r.to, rows: report.rows.length, financeVisible: report.financeVisible, filters: filtersOf(query) },
      ip,
    });

    const header = report.columns.map((c) => c.label);
    const data = report.rows.map((row) => report.columns.map((c) => row[c.key] ?? ""));
    const totals = Object.entries(report.totals).map(([k, v]) => [k, v]);
    const filename = `${params.type}-${r.from}-to-${r.to}.${query.format}`;

    if (query.format === "csv") {
      const lines = [header, ...data].map((row) => row.map(csvField).join(","));
      if (totals.length) lines.push("", "Totals", ...totals.map((t) => t.map(csvField).join(",")));
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send("﻿" + lines.join("\n"));
      return;
    }

    const wb = new ExcelJS.Workbook();
    wb.creator = "Bent & Bound";
    const ws = wb.addWorksheet(report.title.slice(0, 31));
    ws.addRow([`${report.title} – ${r.from} to ${r.to} (Asia/Dhaka)`]).font = { bold: true };
    ws.addRow(header).font = { bold: true };
    const moneyCols = report.columns.map((c, i) => (c.money ? i : -1)).filter((i) => i >= 0);
    for (const row of data) {
      ws.addRow(row.map((v, i) => (moneyCols.includes(i) && v !== "" && v !== null && /^-?\d+(\.\d+)?$/.test(String(v)) ? Number(v) : safeCell(v))));
    }
    for (const i of moneyCols) ws.getColumn(i + 1).numFmt = "#,##0.00";
    if (totals.length) {
      const sheet = wb.addWorksheet("Totals");
      sheet.addRow(["Metric", "Value"]).font = { bold: true };
      totals.forEach((t) => sheet.addRow(t.map(safeCell)));
    }
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    await wb.xlsx.write(res);
    res.end();
  },
});
