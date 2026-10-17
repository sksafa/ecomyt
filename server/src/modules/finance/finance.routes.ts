import { z } from "zod";
import { createModule, dateRangeQuery, idParam, moneySchema, pageMeta, pageQuery, withMeta } from "../../http/route.js";
import { prisma, Prisma } from "../../lib/prisma.js";
import { assertFound, badRequest, conflict } from "../../lib/errors.js";
import { audit } from "../../lib/audit.js";
import { money, sum } from "../../lib/money.js";
import { dateOnly, dhakaDate, dhakaRange } from "../../lib/time.js";
import { postEntries } from "./ledger.service.js";
import { profitAndLoss } from "./reports.service.js";

export const financeModule = createModule("/finance", "Finance");
const { route } = financeModule;

// ───────────── expenses ─────────────

route({
  method: "get",
  path: "/expense-categories",
  summary: "Expense categories",
  access: "expenses.view",
  handler: () => prisma.expenseCategory.findMany({ orderBy: { name: "asc" } }),
});

route({
  method: "post",
  path: "/expense-categories",
  summary: "Create an expense category",
  access: "expenses.manage",
  status: 201,
  body: z.object({ name: z.string().trim().min(2).max(60), type: z.enum(["ADVERTISING", "COURIER", "PACKAGING", "PRODUCTION", "SALARY", "RENT", "UTILITIES", "SOFTWARE", "OTHER"]) }),
  handler: ({ body }) => prisma.expenseCategory.create({ data: body }),
});

const expenseQuery = pageQuery.merge(dateRangeQuery).extend({ categoryId: z.string().optional(), type: z.string().optional(), q: z.string().optional() });

route({
  method: "get",
  path: "/expenses",
  summary: "Expenses",
  access: "expenses.view",
  query: expenseQuery,
  handler: async ({ query }) => {
    const where: Prisma.ExpenseWhereInput = {
      deletedAt: null,
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.type ? { category: { type: query.type as never } } : {}),
      ...(query.from || query.to ? { date: { ...(query.from ? { gte: dateOnly(query.from) } : {}), ...(query.to ? { lte: dateOnly(query.to) } : {}) } } : {}),
      ...(query.q ? { OR: [{ description: { contains: query.q, mode: "insensitive" } }, { reference: query.q }] } : {}),
    };
    const [rows, total, agg] = await Promise.all([
      prisma.expense.findMany({ where, orderBy: [{ date: "desc" }, { createdAt: "desc" }], skip: (query.page - 1) * query.pageSize, take: query.pageSize, include: { category: true, account: { select: { id: true, name: true } }, supplier: { select: { id: true, name: true } }, createdBy: { select: { id: true, name: true } }, order: { select: { id: true, orderNumber: true } } } }),
      prisma.expense.count({ where }),
      prisma.expense.aggregate({ where, _sum: { amount: true } }),
    ]);
    return withMeta(rows, { ...pageMeta(query.page, query.pageSize, total), totalAmount: money(agg._sum.amount).toFixed(2) });
  },
});

const expenseBody = z.object({
  categoryId: z.string(),
  amount: moneySchema,
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  description: z.string().trim().min(2).max(500),
  accountId: z.string().nullish(),
  orderId: z.string().nullish(),
  supplierId: z.string().nullish(),
  reference: z.string().max(100).nullish(),
  attachmentUrl: z.string().max(500).nullish(),
});

/** Advertising categories post AD_SPEND; everything else EXPENSE. Paid from an account = also a cash movement. */
async function postExpense(tx: Prisma.TransactionClient, expense: { id: string; amount: Prisma.Decimal; date: Date; description: string; accountId: string | null; orderId: string | null; categoryId: string }, userId: string, version: number) {
  const category = await tx.expenseCategory.findUniqueOrThrow({ where: { id: expense.categoryId } });
  await postEntries(tx, [
    {
      type: category.type === "ADVERTISING" ? "AD_SPEND" : "EXPENSE",
      amount: money(expense.amount).negated(),
      date: expense.date,
      isCash: !!expense.accountId,
      accountId: expense.accountId,
      orderId: expense.orderId,
      expenseId: expense.id,
      description: `${category.name}: ${expense.description}`,
      key: `expense:${expense.id}:v${version}`,
      createdById: userId,
    },
  ]);
}

/** Editing or deleting an expense reverses the previous posting rather than rewriting history. */
async function reverseExpense(tx: Prisma.TransactionClient, expenseId: string, userId: string, version: number) {
  const prior = await tx.financialEntry.findMany({ where: { expenseId, idempotencyKey: { startsWith: `expense:${expenseId}:v` } } });
  const net = sum(prior.map((p) => p.amount));
  if (net.isZero()) return;
  const last = prior[prior.length - 1];
  await postEntries(tx, [{ type: last.type, amount: net.negated(), date: new Date(), isCash: last.isCash, accountId: last.accountId, orderId: last.orderId, expenseId, description: `Reversal: ${last.description}`, key: `expense:${expenseId}:rev${version}`, createdById: userId }]);
}

route({
  method: "post",
  path: "/expenses",
  summary: "Record an expense",
  description: "Advertising-category expenses are the single source of advertising cost in P&L. Imported ad-platform spend is analytics only.",
  access: "expenses.manage",
  status: 201,
  idempotent: true,
  body: expenseBody,
  handler: async ({ body, user, ip }) => {
    if (!money(body.amount).greaterThan(0)) throw badRequest("Amount must be positive");
    return prisma.$transaction(async (tx) => {
      const e = await tx.expense.create({ data: { ...body, amount: money(body.amount), date: dateOnly(body.date), createdById: user.id, accountId: body.accountId ?? null, orderId: body.orderId ?? null, supplierId: body.supplierId ?? null } });
      await postExpense(tx, e, user.id, 1);
      await audit(tx, { userId: user.id, action: "expense.created", entityType: "Expense", entityId: e.id, after: { ...body }, ip });
      return e;
    });
  },
});

route({
  method: "put",
  path: "/expenses/:id",
  summary: "Edit an expense (previous ledger posting is reversed, new one posted)",
  access: "expenses.manage",
  params: idParam,
  body: expenseBody.extend({ reason: z.string().trim().min(3).max(300) }),
  handler: async ({ params, body, user, ip }) =>
    prisma.$transaction(async (tx) => {
      const before = assertFound(await tx.expense.findUnique({ where: { id: params.id } }), "Expense");
      if (before.deletedAt) throw conflict("Expense was deleted");
      const versions = await tx.financialEntry.count({ where: { expenseId: params.id } });
      const { reason, ...data } = body;
      await reverseExpense(tx, params.id, user.id, versions + 1);
      const e = await tx.expense.update({ where: { id: params.id }, data: { ...data, amount: money(data.amount), date: dateOnly(data.date), accountId: data.accountId ?? null, orderId: data.orderId ?? null, supplierId: data.supplierId ?? null } });
      await postExpense(tx, e, user.id, versions + 2);
      await audit(tx, { userId: user.id, action: "expense.updated", entityType: "Expense", entityId: e.id, before, after: e, reason, ip });
      return e;
    }),
});

route({
  method: "delete",
  path: "/expenses/:id",
  summary: "Delete an expense (soft delete + ledger reversal)",
  access: "expenses.manage",
  params: idParam,
  body: z.object({ reason: z.string().trim().min(3).max(300) }),
  handler: async ({ params, body, user, ip }) =>
    prisma.$transaction(async (tx) => {
      const e = assertFound(await tx.expense.findUnique({ where: { id: params.id } }), "Expense");
      if (e.deletedAt) return { deleted: true };
      const versions = await tx.financialEntry.count({ where: { expenseId: params.id } });
      await reverseExpense(tx, e.id, user.id, versions + 1);
      await tx.expense.update({ where: { id: e.id }, data: { deletedAt: new Date() } });
      await audit(tx, { userId: user.id, action: "expense.deleted", entityType: "Expense", entityId: e.id, before: e, reason: body.reason, ip });
      return { deleted: true };
    }),
});

// ───────────── accounts ─────────────

async function balances() {
  const accounts = await prisma.account.findMany({ orderBy: { createdAt: "asc" } });
  const sums = await prisma.financialEntry.groupBy({ by: ["accountId"], where: { isCash: true, accountId: { not: null } }, _sum: { amount: true } });
  return accounts.map((a) => ({ ...a, balance: money(a.openingBalance).plus(money(sums.find((s) => s.accountId === a.id)?._sum.amount)).toFixed(2) }));
}

route({ method: "get", path: "/accounts", summary: "Cash, bank and wallet accounts with balances", access: "finance.view", handler: () => balances() });

route({
  method: "post",
  path: "/accounts",
  summary: "Create an account",
  access: "accounts.reconcile",
  status: 201,
  body: z.object({ name: z.string().trim().min(2).max(60), type: z.enum(["CASH", "BANK", "MOBILE_WALLET", "OTHER"]), accountNumber: z.string().max(60).nullish(), openingBalance: moneySchema.default("0") }),
  handler: async ({ body, user, ip }) => {
    const a = await prisma.account.create({ data: { ...body, openingBalance: money(body.openingBalance) } });
    await audit(prisma, { userId: user.id, action: "account.created", entityType: "Account", entityId: a.id, after: body, ip });
    return a;
  },
});

route({
  method: "get",
  path: "/accounts/:id/statement",
  summary: "Account statement (cash movements)",
  access: "finance.view",
  params: idParam,
  query: pageQuery.merge(dateRangeQuery),
  handler: async ({ params, query }) => {
    const range = dhakaRange(query.from, query.to);
    const where: Prisma.FinancialEntryWhereInput = { accountId: params.id, isCash: true, ...(range.gte || range.lt ? { date: range } : {}) };
    const [rows, total] = await Promise.all([
      prisma.financialEntry.findMany({ where, orderBy: { date: "desc" }, skip: (query.page - 1) * query.pageSize, take: query.pageSize, include: { createdBy: { select: { name: true } }, order: { select: { orderNumber: true } } } }),
      prisma.financialEntry.count({ where }),
    ]);
    return withMeta(rows, pageMeta(query.page, query.pageSize, total));
  },
});

route({
  method: "post",
  path: "/adjustments",
  summary: "Manual financial adjustment (audited; optional cash movement)",
  access: "accounts.reconcile",
  status: 201,
  body: z.object({
    amount: moneySchema,
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    accountId: z.string().nullish(),
    orderId: z.string().nullish(),
    reason: z.string().trim().min(5).max(500),
  }),
  handler: async ({ body, user, ip }) => {
    if (money(body.amount).isZero()) throw badRequest("Amount cannot be zero");
    const key = `adjustment:${user.id}:${Date.now()}`;
    await prisma.$transaction(async (tx) => {
      await postEntries(tx, [{ type: "ADJUSTMENT", amount: money(body.amount), date: dateOnly(body.date), isCash: !!body.accountId, accountId: body.accountId ?? null, orderId: body.orderId ?? null, description: body.reason, key, createdById: user.id }]);
      await audit(tx, { userId: user.id, action: "finance.adjustment", entityType: "FinancialEntry", entityId: key, after: body, reason: body.reason, ip });
    });
    return prisma.financialEntry.findUniqueOrThrow({ where: { idempotencyKey: key } });
  },
});

route({
  method: "post",
  path: "/transfers",
  summary: "Move money between accounts (e.g. bKash → bank)",
  access: "accounts.reconcile",
  status: 201,
  body: z.object({ fromAccountId: z.string(), toAccountId: z.string(), amount: moneySchema, date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), note: z.string().max(300).optional() }),
  handler: async ({ body, user, ip }) => {
    if (body.fromAccountId === body.toAccountId) throw badRequest("Choose two different accounts");
    const amt = money(body.amount);
    if (!amt.greaterThan(0)) throw badRequest("Amount must be positive");
    const key = `transfer:${user.id}:${Date.now()}`;
    await prisma.$transaction(async (tx) => {
      // transfers are cash-only adjustments that net to zero in P&L
      await postEntries(tx, [
        { type: "ADJUSTMENT", amount: amt.negated(), date: dateOnly(body.date), isCash: true, accountId: body.fromAccountId, description: `Transfer out${body.note ? `: ${body.note}` : ""}`, key: `${key}:out`, createdById: user.id },
        { type: "ADJUSTMENT", amount: amt, date: dateOnly(body.date), isCash: true, accountId: body.toAccountId, description: `Transfer in${body.note ? `: ${body.note}` : ""}`, key: `${key}:in`, createdById: user.id },
      ]);
      await audit(tx, { userId: user.id, action: "finance.transfer", entityType: "Account", entityId: body.fromAccountId, after: body, ip });
    });
    return { transferred: amt.toFixed(2) };
  },
});

// ───────────── reports ─────────────

route({
  method: "get",
  path: "/profit-and-loss",
  summary: "Profit & loss for a Dhaka date range (from the ledger)",
  description: "Revenue is recognised on delivery. Courier fees are booked when known. Advertising = advertising-category expenses.",
  access: "finance.view",
  query: dateRangeQuery,
  handler: ({ query }) => profitAndLoss(query.from ?? dhakaDate(new Date(Date.now() - 29 * 86_400_000)), query.to ?? dhakaDate()),
});

route({
  method: "get",
  path: "/ledger",
  summary: "Ledger entries (filterable)",
  access: "finance.view",
  query: pageQuery.merge(dateRangeQuery).extend({ type: z.string().optional(), orderId: z.string().optional() }),
  handler: async ({ query }) => {
    const range = dhakaRange(query.from, query.to);
    const where: Prisma.FinancialEntryWhereInput = {
      ...(query.type ? { type: { in: query.type.split(",") as never } } : {}),
      ...(query.orderId ? { orderId: query.orderId } : {}),
      ...(range.gte || range.lt ? { date: range } : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.financialEntry.findMany({ where, orderBy: { date: "desc" }, skip: (query.page - 1) * query.pageSize, take: query.pageSize, include: { account: { select: { name: true } }, order: { select: { id: true, orderNumber: true } } } }),
      prisma.financialEntry.count({ where }),
    ]);
    return withMeta(rows, pageMeta(query.page, query.pageSize, total));
  },
});
