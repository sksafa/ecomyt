import { prisma, Prisma } from "../../lib/prisma.js";
import { money } from "../../lib/money.js";
import { randomToken } from "../../lib/crypto.js";
import { dateOnly } from "../../lib/time.js";
import type { AdPlatform } from "../../generated/prisma/enums.js";

/**
 * Ad spend records are analytics only: they feed CPA / ROAS reports and the reconciliation view.
 * They never create FinancialEntry rows – advertising cost in the P&L comes from recorded expenses.
 */

export const AD_PLATFORMS: AdPlatform[] = ["META", "GOOGLE", "TIKTOK", "OTHER"];

/** Minimal RFC 4180 CSV parser (quoted fields, escaped quotes, CRLF/LF, BOM). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"' && field === "") quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((v) => v.trim() !== ""));
}

type Field =
  | "date" | "platform" | "campaignId" | "campaignName" | "adsetId" | "adId"
  | "spend" | "impressions" | "clicks" | "reportedPurchases" | "reportedRevenue";

/** Normalised header (lowercase alphanumerics) → field. Includes Meta Ads Manager export names. */
const HEADER_ALIASES: Record<string, Field> = {
  date: "date", day: "date", reportingstarts: "date",
  platform: "platform",
  campaignid: "campaignId",
  campaignname: "campaignName", campaign: "campaignName",
  adsetid: "adsetId", adgroupid: "adsetId",
  adid: "adId",
  spend: "spend", amountspent: "spend", amountspentbdt: "spend", cost: "spend",
  impressions: "impressions",
  clicks: "clicks", clicksall: "clicks", linkclicks: "clicks",
  reportedpurchases: "reportedPurchases", purchases: "reportedPurchases", websitepurchases: "reportedPurchases",
  reportedrevenue: "reportedRevenue", purchasesconversionvalue: "reportedRevenue", websitepurchasesconversionvalue: "reportedRevenue",
  purchaseconversionvalue: "reportedRevenue",
};

const normHeader = (h: string) => h.trim().toLowerCase().replace(/[^a-z0-9]/g, "");

export interface HeaderMap {
  columns: Partial<Record<Field, number>>;
  errors: string[];
}

export function mapHeaders(headers: string[]): HeaderMap {
  const columns: Partial<Record<Field, number>> = {};
  const errors: string[] = [];
  headers.forEach((h, idx) => {
    const n = normHeader(h);
    let field = HEADER_ALIASES[n];
    if (!field && n.startsWith("amountspent")) {
      errors.push(`Column "${h.trim()}": spend must be in BDT (export the report in BDT)`);
      return;
    }
    if (field && columns[field] === undefined) columns[field] = idx;
  });
  if (columns.date === undefined) errors.push("Missing column: date (or \"Day\" / \"Reporting starts\")");
  if (columns.spend === undefined) errors.push("Missing column: spend (or \"Amount spent (BDT)\")");
  if (columns.campaignId === undefined && columns.campaignName === undefined) errors.push("Missing column: campaign_id or campaign_name");
  return { columns, errors };
}

export interface AdSpendInput {
  platform: AdPlatform;
  date: string; // YYYY-MM-DD
  campaignId: string;
  campaignName: string | null;
  adsetId: string;
  adId: string;
  spend: Prisma.Decimal;
  impressions: number;
  clicks: number;
  reportedPurchases: number;
  reportedRevenue: Prisma.Decimal;
}

const cleanNumber = (v: string) => v.replace(/[,\s৳]/g, "").replace(/^BDT/i, "");

function parseDate(v: string): string | null {
  const s = v.trim();
  const m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(s);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

export function parseRow(cells: string[], columns: Partial<Record<Field, number>>, defaultPlatform: AdPlatform): { value?: AdSpendInput; errors: string[] } {
  const get = (f: Field) => (columns[f] === undefined ? "" : (cells[columns[f]!] ?? "").trim());
  const errors: string[] = [];

  const date = parseDate(get("date"));
  if (!date) errors.push(`Invalid date "${get("date")}" (use YYYY-MM-DD)`);

  let platform = defaultPlatform;
  const p = get("platform").toUpperCase();
  if (p) {
    const mapped = p === "FACEBOOK" || p === "INSTAGRAM" ? "META" : p;
    if (AD_PLATFORMS.includes(mapped as AdPlatform)) platform = mapped as AdPlatform;
    else errors.push(`Unknown platform "${get("platform")}" (META, GOOGLE, TIKTOK, OTHER)`);
  }

  const campaignId = get("campaignId").slice(0, 100);
  const campaignName = get("campaignName").slice(0, 300) || null;
  if (!campaignId && !campaignName) errors.push("campaign_id or campaign_name is required");

  const spendRaw = cleanNumber(get("spend"));
  let spend = money(0);
  if (!/^\d+(\.\d+)?$/.test(spendRaw)) errors.push(`Invalid spend "${get("spend")}"`);
  else spend = money(spendRaw);

  const int = (f: Field, label: string) => {
    const raw = cleanNumber(get(f));
    if (raw === "") return 0;
    if (!/^\d+$/.test(raw)) {
      errors.push(`Invalid ${label} "${get(f)}"`);
      return 0;
    }
    const n = Number(raw);
    if (n > 2_000_000_000) errors.push(`${label} too large`);
    return n;
  };
  const impressions = int("impressions", "impressions");
  const clicks = int("clicks", "clicks");
  const reportedPurchases = int("reportedPurchases", "reported_purchases");

  const revRaw = cleanNumber(get("reportedRevenue"));
  let reportedRevenue = money(0);
  if (revRaw !== "") {
    if (!/^\d+(\.\d+)?$/.test(revRaw)) errors.push(`Invalid reported_revenue "${get("reportedRevenue")}"`);
    else reportedRevenue = money(revRaw);
  }
  if (spend.greaterThan("9999999999.99") || reportedRevenue.greaterThan("9999999999.99")) errors.push("Amount too large");

  if (errors.length) return { errors };
  return {
    errors,
    value: {
      platform, date: date!, campaignId, campaignName,
      adsetId: get("adsetId").slice(0, 100), adId: get("adId").slice(0, 100),
      spend, impressions, clicks, reportedPurchases, reportedRevenue,
    },
  };
}

const keyOf = (r: AdSpendInput) => [r.platform, r.date, r.campaignId, r.adsetId, r.adId].join("|");

/** Upsert by (platform, date, campaignId, adsetId, adId). Returns whether the row was created. */
export async function upsertAdSpend(db: Prisma.TransactionClient | typeof prisma, r: AdSpendInput, source: string, importBatch: string | null) {
  const where = {
    platform_date_campaignId_adsetId_adId: { platform: r.platform, date: dateOnly(r.date), campaignId: r.campaignId, adsetId: r.adsetId, adId: r.adId },
  };
  const data = {
    campaignName: r.campaignName, spend: r.spend, impressions: r.impressions, clicks: r.clicks,
    reportedPurchases: r.reportedPurchases, reportedRevenue: r.reportedRevenue, source, importBatch,
  };
  const existing = await db.adSpendRecord.findUnique({ where, select: { id: true } });
  if (existing) {
    const row = await db.adSpendRecord.update({ where: { id: existing.id }, data });
    return { row, created: false };
  }
  const row = await db.adSpendRecord.create({
    data: { platform: r.platform, date: dateOnly(r.date), campaignId: r.campaignId, adsetId: r.adsetId, adId: r.adId, ...data },
  });
  return { row, created: true };
}

export interface ImportResult {
  importBatch: string;
  totalRows: number;
  created: number;
  updated: number;
  failed: number;
  errors: { row: number; messages: string[] }[];
  totalSpend: string;
}

/**
 * Import a CSV export. Valid rows are upserted (re-importing the same file never duplicates);
 * invalid rows are reported with their line number and skipped (partial success).
 * Returns `{ headerErrors }` (nothing imported) when the header itself is unusable.
 */
export async function importAdSpendCsv(text: string, defaultPlatform: AdPlatform): Promise<ImportResult | { headerErrors: string[] }> {
  const rows = parseCsv(text);
  if (!rows.length) return { headerErrors: ["The file is empty"] };
  const { columns, errors: headerErrors } = mapHeaders(rows[0]);
  if (headerErrors.length) return { headerErrors };

  const importBatch = `adimp_${new Date().toISOString().slice(0, 10).replaceAll("-", "")}_${randomToken(6)}`;
  const errors: ImportResult["errors"] = [];
  const valid: { line: number; value: AdSpendInput }[] = [];
  const seen = new Map<string, number>();

  rows.slice(1).forEach((cells, i) => {
    const line = i + 2; // 1-based, header is line 1
    const r = parseRow(cells, columns, defaultPlatform);
    if (!r.value) {
      errors.push({ row: line, messages: r.errors });
      return;
    }
    const k = keyOf(r.value);
    const prev = seen.get(k);
    if (prev) {
      errors.push({ row: line, messages: [`Duplicate of row ${prev} (same platform, date, campaign, ad set and ad)`] });
      return;
    }
    seen.set(k, line);
    valid.push({ line, value: r.value });
  });

  let created = 0;
  let updated = 0;
  // chunked transactions keep each one short for large exports
  for (let i = 0; i < valid.length; i += 200) {
    const chunk = valid.slice(i, i + 200);
    await prisma.$transaction(
      async (tx) => {
        for (const { value } of chunk) {
          const r = await upsertAdSpend(tx, value, "CSV", importBatch);
          if (r.created) created++;
          else updated++;
        }
      },
      { maxWait: 10_000, timeout: 60_000 },
    );
  }

  return {
    importBatch,
    totalRows: rows.length - 1,
    created,
    updated,
    failed: errors.length,
    errors: errors.sort((a, b) => a.row - b.row),
    totalSpend: valid.reduce((acc, v) => acc.plus(v.value.spend), money(0)).toFixed(2),
  };
}
