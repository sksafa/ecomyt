"use client";

import { useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Info, Loader2, Megaphone, Pencil, Plus, RefreshCw, Search, Tags, Trash2 } from "lucide-react";
import { api, newIdempotencyKey, request, type PageMeta } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { bdt, dhakaDay, dhakaToday, titleCase } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ConfirmDialog, EmptyState, ErrorState, Field, IconAction, LoadingRows, NativeSelect, PageHeader, Pagination, Pill } from "@/components/admin/ui";
import { DateRangeControl, useDateRange } from "./date-range";
import { useUrlState } from "./url-state";
import { useAccounts } from "./finance-common";
import { DATE_RE, handleFormError, MONEY_RE } from "./forms";

interface Category { id: string; name: string; type: string; isActive: boolean }
interface Expense {
  id: string; categoryId: string; amount: string; date: string; description: string; accountId: string | null; orderId: string | null; supplierId: string | null;
  reference: string | null; attachmentUrl: string | null; createdAt: string;
  category: Category; account: { id: string; name: string } | null; supplier: { id: string; name: string } | null; createdBy: { id: string; name: string } | null; order: { id: string; orderNumber: string } | null;
}
const EXPENSE_TYPES = ["ADVERTISING", "COURIER", "PACKAGING", "PRODUCTION", "SALARY", "RENT", "UTILITIES", "SOFTWARE", "OTHER"] as const;
const KEYS = ["categoryId", "type", "q", "page"] as const;

function useCategories() {
  return useQuery({ queryKey: ["finance", "expense-categories"], queryFn: () => api<Category[]>("/finance/expense-categories"), staleTime: 5 * 60_000 });
}

export function ExpensesScreen() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const range = useDateRange();
  const [f, set] = useUrlState(KEYS);
  const [search, setSearch] = useState(f.q ?? "");
  const [editing, setEditing] = useState<Expense | "new" | null>(null);
  const [deleting, setDeleting] = useState<Expense | null>(null);
  const [showCategories, setShowCategories] = useState(false);
  const categories = useCategories();
  const manage = can("expenses.manage");
  const query = { from: range.from, to: range.to, categoryId: f.categoryId, type: f.type, q: f.q, page: f.page ?? 1, pageSize: 25 };
  const list = useQuery({ queryKey: ["finance", "expenses", query], queryFn: () => request<Expense[]>("/finance/expenses", { query }), placeholderData: keepPreviousData });
  const total = list.data?.meta?.totalAmount as string | undefined;
  const refresh = () => qc.invalidateQueries({ queryKey: ["finance"] });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Expenses"
        description="Operating costs that feed the profit & loss. Edits and deletions reverse the earlier ledger entry and are audited."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => setShowCategories(true)}><Tags className="size-4" /> Categories</Button>
            {manage && <Button size="sm" onClick={() => setEditing("new")}><Plus className="size-4" /> Record expense</Button>}
          </>
        }
      />
      <div className="flex items-start gap-2 rounded-xl border border-orange-200 bg-orange-50 p-3 text-sm text-orange-900">
        <Megaphone className="mt-0.5 size-4 shrink-0" />
        <p>
          <b>Advertising-category expenses are the advertising cost in the P&amp;L.</b> Record each Meta / Google ad bill here. Spend imported in Marketing is for ROAS analytics only and never reaches the P&amp;L.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-white p-3">
        <DateRangeControl range={range} />
        <div className="flex flex-1 flex-wrap justify-end gap-2">
          <NativeSelect aria-label="Category" className="w-44" value={f.categoryId ?? ""} onChange={(e) => set({ categoryId: e.target.value || undefined })}>
            <option value="">All categories</option>
            {categories.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </NativeSelect>
          <NativeSelect aria-label="Type" className="w-36" value={f.type ?? ""} onChange={(e) => set({ type: e.target.value || undefined })}>
            <option value="">All types</option>
            {EXPENSE_TYPES.map((t) => <option key={t} value={t}>{titleCase(t)}</option>)}
          </NativeSelect>
          <form className="relative min-w-48 flex-1 sm:max-w-64" onSubmit={(e) => { e.preventDefault(); set({ q: search.trim() || undefined }); }}>
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Description or reference" className="h-9 pl-9" aria-label="Search expenses" />
          </form>
          <Button variant="outline" size="icon" className="size-9" aria-label="Refresh" onClick={() => list.refetch()}>
            <RefreshCw className={cn("size-4", list.isFetching && "animate-spin")} />
          </Button>
        </div>
      </div>

      {list.isError ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : list.isLoading ? (
        <LoadingRows rows={5} />
      ) : !list.data?.data.length ? (
        <EmptyState title="No expenses in this range" description="Try a wider date range or clear the filters." action={manage ? <Button size="sm" onClick={() => setEditing("new")}>Record an expense</Button> : undefined} />
      ) : (
        <div className={cn("overflow-x-auto rounded-xl border bg-white", list.isFetching && "opacity-70")}>
          <table className="w-full min-w-[860px] text-sm">
            <thead className="border-b bg-muted/50 text-left text-xs text-slate-600">
              <tr>
                <th className="px-3 py-2 font-medium">Date</th>
                <th className="px-3 py-2 font-medium">Category</th>
                <th className="px-3 py-2 font-medium">Description</th>
                <th className="px-3 py-2 font-medium">Paid from</th>
                <th className="px-3 py-2 text-right font-medium">Amount</th>
                {manage && <th className="px-3 py-2"><span className="sr-only">Actions</span></th>}
              </tr>
            </thead>
            <tbody>
              {list.data.data.map((e) => (
                <tr key={e.id} className="border-b last:border-0">
                  <td className="whitespace-nowrap px-3 py-2">{dhakaDay(e.date)}</td>
                  <td className="px-3 py-2">
                    <span className="block">{e.category.name}</span>
                    <Pill tone={e.category.type === "ADVERTISING" ? "orange" : "gray"} className="mt-0.5">{titleCase(e.category.type)}</Pill>
                  </td>
                  <td className="max-w-[320px] px-3 py-2">
                    <span className="block">{e.description}</span>
                    <span className="block text-xs text-muted-foreground">
                      {[e.reference && `Ref ${e.reference}`, e.supplier?.name, e.order?.orderNumber, e.createdBy && `by ${e.createdBy.name}`].filter(Boolean).join(" · ")}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{e.account?.name ?? "Not paid from an account"}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right font-medium tabular-nums">{bdt(e.amount)}</td>
                  {manage && (
                    <td className="whitespace-nowrap px-1 py-1 text-right">
                      <IconAction label="Edit expense" onClick={() => setEditing(e)}><Pencil className="size-4" /></IconAction>
                      <IconAction label="Delete expense" onClick={() => setDeleting(e)} className="hover:text-red-700"><Trash2 className="size-4" /></IconAction>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t bg-muted/40 font-semibold">
              <tr>
                <td className="px-3 py-2" colSpan={4}>Total ({list.data.meta?.total ?? 0} expenses, all pages)</td>
                <td className="px-3 py-2 text-right tabular-nums">{bdt(total)}</td>
                {manage && <td />}
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      <Pagination meta={list.data?.meta as PageMeta | undefined} onPage={(p) => set({ page: String(p) })} />

      <ExpenseDialog key={editing === null ? "closed" : editing === "new" ? "new" : editing.id} expense={editing} categories={categories.data ?? []} onClose={() => setEditing(null)} onSaved={refresh} />
      <CategoriesDialog open={showCategories} onClose={() => setShowCategories(false)} categories={categories.data} canManage={manage} />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete expense of ${deleting ? bdt(deleting.amount) : ""}?`}
        description={deleting && <>{deleting.category.name}: {deleting.description} ({dhakaDay(deleting.date)}). The ledger entry is reversed; the record stays in the audit log.</>}
        destructive
        requireReason
        reasonLabel="Reason for deleting"
        confirmLabel="Delete expense"
        onConfirm={async (reason) => {
          await api(`/finance/expenses/${deleting!.id}`, { method: "DELETE", body: { reason } });
          toast.success("Expense deleted and reversed");
          refresh();
        }}
      />
    </div>
  );
}

const expenseSchema = z.object({
  categoryId: z.string().min(1, "Choose a category"),
  amount: z.string().trim().regex(MONEY_RE, "Enter an amount like 1500 or 1500.50").refine((v) => Number(v) > 0, "Amount must be more than 0"),
  date: z.string().regex(DATE_RE, "Pick a date"),
  description: z.string().trim().min(2, "Describe the expense").max(500),
  accountId: z.string().optional(),
  reference: z.string().trim().max(100).optional(),
  reason: z.string().trim().max(300).optional(),
});
type ExpenseForm = z.infer<typeof expenseSchema>;

function ExpenseDialog({ expense, categories, onClose, onSaved }: { expense: Expense | "new" | null; categories: Category[]; onClose: () => void; onSaved: () => void }) {
  const accounts = useAccounts();
  const editing = expense && expense !== "new" ? expense : null;
  const [idem] = useState(newIdempotencyKey);
  const form = useForm<ExpenseForm>({
    resolver: zodResolver(expenseSchema),
    defaultValues: editing
      ? { categoryId: editing.categoryId, amount: String(Number(editing.amount)), date: editing.date.slice(0, 10), description: editing.description, accountId: editing.accountId ?? "", reference: editing.reference ?? "", reason: "" }
      : { categoryId: "", amount: "", date: dhakaToday(), description: "", accountId: "", reference: "", reason: "" },
  });
  const { register, handleSubmit, setError, control, formState: { errors, isSubmitting } } = form;
  const categoryId = useWatch({ control, name: "categoryId" });
  const category = categories.find((c) => c.id === categoryId);

  const submit = handleSubmit(async (v) => {
    if (editing && (v.reason ?? "").length < 3) {
      setError("reason", { message: "Say why this expense is being changed (min 3 characters)" });
      return;
    }
    const body = {
      categoryId: v.categoryId, amount: v.amount, date: v.date, description: v.description, accountId: v.accountId || null, reference: v.reference || null,
      orderId: editing?.orderId ?? null, supplierId: editing?.supplierId ?? null, attachmentUrl: editing?.attachmentUrl ?? null,
    };
    try {
      if (editing) await api(`/finance/expenses/${editing.id}`, { method: "PUT", body: { ...body, reason: v.reason } });
      else await api("/finance/expenses", { method: "POST", body, idempotencyKey: idem });
      toast.success(editing ? "Expense updated" : "Expense recorded");
      onSaved();
      onClose();
    } catch (e) {
      handleFormError(e, setError);
    }
  });

  return (
    <Dialog open={!!expense} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit expense" : "Record expense"}</DialogTitle>
          <DialogDescription>{editing ? "The previous ledger posting is reversed and the new one posted." : "Posted to the ledger on the expense date (Asia/Dhaka)."}</DialogDescription>
        </DialogHeader>
        <form id="expense-form" onSubmit={submit} className="grid gap-3 sm:grid-cols-2" noValidate>
          <Field label="Category" htmlFor="ex-cat" error={errors.categoryId?.message} hint={category?.type === "ADVERTISING" ? "Counts as advertising in the P&L" : undefined}>
            <NativeSelect id="ex-cat" {...register("categoryId")}>
              <option value="">Choose…</option>
              {categories.filter((c) => c.isActive || c.id === editing?.categoryId).map((c) => <option key={c.id} value={c.id}>{c.name} ({titleCase(c.type)})</option>)}
            </NativeSelect>
          </Field>
          <Field label="Amount (BDT)" htmlFor="ex-amount" error={errors.amount?.message}>
            <Input id="ex-amount" inputMode="decimal" {...register("amount")} />
          </Field>
          <Field label="Date" htmlFor="ex-date" error={errors.date?.message}>
            <Input id="ex-date" type="date" max={dhakaToday()} {...register("date")} />
          </Field>
          <Field label="Paid from account" htmlFor="ex-account" error={errors.accountId?.message} hint="Leave empty if not paid yet / paid personally">
            <NativeSelect id="ex-account" {...register("accountId")} disabled={!accounts.data}>
              <option value="">Not from an account</option>
              {accounts.data?.filter((a) => a.isActive).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </NativeSelect>
          </Field>
          <div className="sm:col-span-2">
            <Field label="Description" htmlFor="ex-desc" error={errors.description?.message}>
              <Textarea id="ex-desc" rows={2} {...register("description")} />
            </Field>
          </div>
          <Field label="Reference (optional)" htmlFor="ex-ref" error={errors.reference?.message} hint="Invoice / bill / transaction no.">
            <Input id="ex-ref" {...register("reference")} />
          </Field>
          {editing && (
            <div className="sm:col-span-2">
              <Field label="Reason for the change" htmlFor="ex-reason" error={errors.reason?.message}>
                <Textarea id="ex-reason" rows={2} {...register("reason")} placeholder="e.g. Wrong amount entered, bill corrected" />
              </Field>
            </div>
          )}
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="expense-form" disabled={isSubmitting}>{isSubmitting && <Loader2 className="size-4 animate-spin" />} {editing ? "Save changes" : "Record expense"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const categorySchema = z.object({ name: z.string().trim().min(2, "At least 2 characters").max(60), type: z.enum(EXPENSE_TYPES) });
type CategoryForm = z.infer<typeof categorySchema>;

function CategoriesDialog({ open, onClose, categories, canManage }: { open: boolean; onClose: () => void; categories?: Category[]; canManage: boolean }) {
  const qc = useQueryClient();
  const { register, handleSubmit, reset, setError, formState: { errors, isSubmitting } } = useForm<CategoryForm>({ resolver: zodResolver(categorySchema), defaultValues: { name: "", type: "OTHER" } });
  const submit = handleSubmit(async (v) => {
    try {
      await api("/finance/expense-categories", { method: "POST", body: v });
      toast.success(`Category "${v.name}" created`);
      reset({ name: "", type: v.type });
      qc.invalidateQueries({ queryKey: ["finance", "expense-categories"] });
    } catch (e) {
      handleFormError(e, setError);
    }
  });
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Expense categories</DialogTitle>
          <DialogDescription>The type decides where the expense lands in the P&amp;L. Advertising type = P&amp;L advertising cost.</DialogDescription>
        </DialogHeader>
        <ul className="max-h-64 divide-y overflow-y-auto rounded-lg border text-sm">
          {categories?.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-2 px-3 py-2">
              <span className={cn(!c.isActive && "text-muted-foreground line-through")}>{c.name}</span>
              <Pill tone={c.type === "ADVERTISING" ? "orange" : "gray"}>{titleCase(c.type)}</Pill>
            </li>
          ))}
        </ul>
        {canManage ? (
          <form onSubmit={submit} className="grid gap-2 sm:grid-cols-[1fr_140px_auto] sm:items-end" noValidate>
            <Field label="New category" htmlFor="cat-name" error={errors.name?.message}>
              <Input id="cat-name" {...register("name")} placeholder="e.g. TikTok Ads" />
            </Field>
            <Field label="Type" htmlFor="cat-type" error={errors.type?.message}>
              <NativeSelect id="cat-type" {...register("type")}>{EXPENSE_TYPES.map((t) => <option key={t} value={t}>{titleCase(t)}</option>)}</NativeSelect>
            </Field>
            <Button type="submit" disabled={isSubmitting} className={cn((errors.name || errors.type) && "sm:mb-5")}>{isSubmitting ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />} Add</Button>
          </form>
        ) : (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Info className="size-3.5" /> Creating categories needs expenses.manage.</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
