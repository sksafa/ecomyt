import { prisma } from "../../lib/prisma.js";
import { money, sum } from "../../lib/money.js";
import { dhakaRange } from "../../lib/time.js";
import type { EntryType } from "../../generated/prisma/enums.js";

/** Entry types that affect profit. Cash-only movements (payments, settlements, refunds paid, supplier payments) do not. */
export const PNL_TYPES: EntryType[] = [
  "SALES_REVENUE", "SHIPPING_REVENUE", "COGS", "COURIER_FEE", "COD_FEE", "RETURN_FEE", "PACKAGING_COST",
  "RETURN_REVERSAL", "RESTOCK_RECOVERY", "EXPENSE", "AD_SPEND", "ADJUSTMENT",
];

const fixed = (v: unknown) => money(v as string).toFixed(2);

/**
 * P&L for an inclusive Dhaka date range, computed only from ledger entries:
 *   Revenue = sales + shipping revenue − returns (refunds)
 *   Gross profit = revenue − COGS + restock recovery
 *   Net profit = gross profit − courier − packaging − advertising − operating expenses ± adjustments
 * Transfers are cash-only ADJUSTMENT pairs that net to zero.
 */
export async function profitAndLoss(from: string, to: string) {
  const range = dhakaRange(from, to);
  const grouped = await prisma.financialEntry.groupBy({ by: ["type"], where: { date: range, type: { in: PNL_TYPES } }, _sum: { amount: true } });
  const t = (type: EntryType) => money(grouped.find((g) => g.type === type)?._sum.amount);

  const expensesByCategory = await prisma.$queryRaw<{ name: string; type: string; total: string }[]>`
    SELECT c.name, c.type::text AS type, SUM(e.amount)::text AS total
    FROM "Expense" e JOIN "ExpenseCategory" c ON c.id = e."categoryId"
    WHERE e."deletedAt" IS NULL AND e.date >= ${from}::date AND e.date <= ${to}::date
    GROUP BY c.name, c.type ORDER BY SUM(e.amount) DESC`;

  const salesRevenue = t("SALES_REVENUE");
  const shippingRevenue = t("SHIPPING_REVENUE");
  const returns = t("RETURN_REVERSAL"); // negative
  const revenue = sum([salesRevenue, shippingRevenue, returns]);
  const cogs = t("COGS"); // negative
  const restock = t("RESTOCK_RECOVERY");
  const grossProfit = revenue.plus(cogs).plus(restock);
  const courier = sum([t("COURIER_FEE"), t("COD_FEE"), t("RETURN_FEE")]);
  const packaging = t("PACKAGING_COST");
  const advertising = t("AD_SPEND");
  const operating = t("EXPENSE");
  const adjustments = t("ADJUSTMENT");
  const netProfit = sum([grossProfit, courier, packaging, advertising, operating, adjustments]);

  const cash = await prisma.financialEntry.groupBy({ by: ["type"], where: { date: range, isCash: true }, _sum: { amount: true } });
  const cashIn = sum(cash.filter((c) => money(c._sum.amount).greaterThan(0)).map((c) => c._sum.amount));
  const cashOut = sum(cash.filter((c) => money(c._sum.amount).isNegative()).map((c) => c._sum.amount));

  return {
    period: { from, to, timezone: "Asia/Dhaka" },
    revenue: {
      productSales: fixed(salesRevenue),
      shippingCharges: fixed(shippingRevenue),
      returnsAndRefunds: fixed(returns),
      total: fixed(revenue),
    },
    costOfGoods: { cogs: fixed(cogs), restockRecovery: fixed(restock) },
    grossProfit: fixed(grossProfit),
    grossMarginPct: revenue.greaterThan(0) ? grossProfit.dividedBy(revenue).times(100).toFixed(1) : null,
    operatingCosts: {
      courierDelivery: fixed(t("COURIER_FEE")),
      courierCod: fixed(t("COD_FEE")),
      returnShipping: fixed(t("RETURN_FEE")),
      courierTotal: fixed(courier),
      packaging: fixed(packaging),
      advertising: fixed(advertising),
      otherExpenses: fixed(operating),
      adjustments: fixed(adjustments),
    },
    expensesByCategory: expensesByCategory.map((e) => ({ ...e, total: fixed(e.total) })),
    netProfit: fixed(netProfit),
    netMarginPct: revenue.greaterThan(0) ? netProfit.dividedBy(revenue).times(100).toFixed(1) : null,
    cash: { in: fixed(cashIn), out: fixed(cashOut), net: fixed(cashIn.plus(cashOut)) },
    notes: [
      "Revenue is recognised when an order is delivered; placed or in-transit orders are not revenue yet.",
      "Customer-paid delivery charges are shown as shipping revenue; courier charges are a separate cost.",
      "Courier fees are booked when the courier reports them and corrected by settlements.",
      "Advertising is the sum of advertising-category expenses; platform-reported spend is in Marketing.",
    ],
  };
}
