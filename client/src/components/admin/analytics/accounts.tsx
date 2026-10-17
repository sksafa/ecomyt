"use client";

import { useState } from "react";
import Link from "next/link";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { ArrowLeftRight, Banknote, Building2, FileText, Landmark, Loader2, Plus, RefreshCw, Scale, Smartphone, Wallet } from "lucide-react";
import { api, request, type PageMeta } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { bdt, dhakaDateTime, dhakaToday, titleCase } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { EmptyState, ErrorState, Field, LoadingRows, NativeSelect, PageHeader, Pagination, Pill } from "@/components/admin/ui";
import { ACCOUNT_TYPES, ENTRY_TYPE_LABEL, useAccounts, type Account } from "./finance-common";
import { DATE_RE, handleFormError, MONEY_RE } from "./forms";

const TYPE_ICON = { CASH: Banknote, BANK: Landmark, MOBILE_WALLET: Smartphone, OTHER: Building2 } as const;

interface StatementEntry {
  id: string; type: string; amount: string; date: string; description: string; orderId: string | null; createdAt: string;
  createdBy: { name: string } | null; order: { orderNumber: string } | null;
}

export function AccountsScreen() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const accounts = useAccounts();
  const [statementOf, setStatementOf] = useState<Account | null>(null);
  const [dialog, setDialog] = useState<"create" | "transfer" | "adjust" | null>(null);
  const reconcile = can("accounts.reconcile");
  const total = accounts.data?.reduce((s, a) => s + Number(a.balance), 0) ?? 0;
  const refresh = () => qc.invalidateQueries({ queryKey: ["finance"] });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Accounts"
        description="Cash, bank and mobile-wallet balances from recorded cash movements (opening balance + ledger)."
        actions={
          <>
            {reconcile && (
              <>
                <Button variant="outline" size="sm" onClick={() => setDialog("transfer")} disabled={(accounts.data?.length ?? 0) < 2}><ArrowLeftRight className="size-4" /> Transfer</Button>
                <Button variant="outline" size="sm" onClick={() => setDialog("adjust")}><Scale className="size-4" /> Adjustment</Button>
                <Button size="sm" onClick={() => setDialog("create")}><Plus className="size-4" /> New account</Button>
              </>
            )}
            <Button variant="outline" size="icon" className="size-9" aria-label="Refresh" onClick={() => accounts.refetch()}>
              <RefreshCw className={cn("size-4", accounts.isFetching && "animate-spin")} />
            </Button>
          </>
        }
      />
      {accounts.isError ? (
        <ErrorState error={accounts.error} onRetry={() => accounts.refetch()} />
      ) : accounts.isLoading ? (
        <LoadingRows rows={3} />
      ) : !accounts.data?.length ? (
        <EmptyState title="No accounts yet" description="Create your cash, bank and bKash / Nagad accounts to track balances." action={reconcile ? <Button size="sm" onClick={() => setDialog("create")}>New account</Button> : undefined} />
      ) : (
        <>
          <div className="flex flex-wrap items-baseline gap-2 rounded-xl border bg-white p-4">
            <Wallet className="size-5 self-center text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Total across {accounts.data.length} accounts</span>
            <span className={cn("text-2xl font-semibold tabular-nums", total < 0 && "text-red-700")}>{bdt(total)}</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {accounts.data.map((a) => {
              const Icon = TYPE_ICON[a.type] ?? Building2;
              return (
                <div key={a.id} className={cn("flex flex-col gap-3 rounded-xl border bg-white p-4", !a.isActive && "opacity-60")}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-slate-100"><Icon className="size-4.5 text-slate-600" /></span>
                      <div className="min-w-0">
                        <p className="truncate font-medium">{a.name}</p>
                        <p className="truncate text-xs text-muted-foreground">{titleCase(a.type)}{a.accountNumber ? ` · ${a.accountNumber}` : ""}</p>
                      </div>
                    </div>
                    {!a.isActive && <Pill tone="gray">inactive</Pill>}
                  </div>
                  <div>
                    <p className={cn("text-2xl font-semibold tabular-nums", Number(a.balance) < 0 && "text-red-700")}>{bdt(a.balance)}</p>
                    <p className="text-xs text-muted-foreground">opening {bdt(a.openingBalance)}</p>
                  </div>
                  <Button variant="outline" size="sm" className="self-start" onClick={() => setStatementOf(a)}><FileText className="size-4" /> Statement</Button>
                </div>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground">
            COD held by couriers is not in these balances until a settlement is recorded{can("finance.view") ? <> — see <Link href="/admin/shipments/settlements" className="text-blue-700 hover:underline">COD settlements</Link></> : null}.
          </p>
        </>
      )}

      <StatementSheet key={statementOf?.id ?? "none"} account={statementOf} onClose={() => setStatementOf(null)} />
      <CreateAccountDialog open={dialog === "create"} onClose={() => setDialog(null)} onSaved={refresh} />
      <TransferDialog open={dialog === "transfer"} accounts={accounts.data ?? []} onClose={() => setDialog(null)} onSaved={refresh} />
      <AdjustmentDialog open={dialog === "adjust"} accounts={accounts.data ?? []} onClose={() => setDialog(null)} onSaved={refresh} />
    </div>
  );
}

function StatementSheet({ account, onClose }: { account: Account | null; onClose: () => void }) {
  const [page, setPage] = useState(1);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const query = { page, pageSize: 25, from: from || undefined, to: to || undefined };
  const q = useQuery({
    queryKey: ["finance", "statement", account?.id, query],
    queryFn: () => request<StatementEntry[]>(`/finance/accounts/${account!.id}/statement`, { query }),
    enabled: !!account,
    placeholderData: keepPreviousData,
  });
  return (
    <Sheet open={!!account} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>{account?.name} · statement</SheetTitle>
          <SheetDescription>Current balance {bdt(account?.balance)} · newest first · Asia/Dhaka</SheetDescription>
        </SheetHeader>
        <div className="space-y-3 px-4 pb-6">
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col text-xs text-muted-foreground">From<Input type="date" className="h-9 w-40" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} /></label>
            <label className="flex flex-col text-xs text-muted-foreground">To<Input type="date" className="h-9 w-40" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} /></label>
            {(from || to) && <Button variant="ghost" size="sm" onClick={() => { setFrom(""); setTo(""); }}>Clear</Button>}
          </div>
          {q.isError ? (
            <ErrorState error={q.error} onRetry={() => q.refetch()} />
          ) : q.isLoading ? (
            <LoadingRows rows={5} className="[&>*]:h-12" />
          ) : !q.data?.data.length ? (
            <EmptyState title="No movements" description="Payments, expenses, refunds, settlements and transfers that use this account appear here." />
          ) : (
            <div className={cn("overflow-x-auto rounded-lg border", q.isFetching && "opacity-70")}>
              <table className="w-full min-w-[520px] text-sm">
                <thead className="border-b bg-muted/50 text-left text-xs text-slate-600">
                  <tr><th className="px-3 py-2 font-medium">Date</th><th className="px-3 py-2 font-medium">Type</th><th className="px-3 py-2 font-medium">Description</th><th className="px-3 py-2 text-right font-medium">Amount</th></tr>
                </thead>
                <tbody>
                  {q.data.data.map((e) => (
                    <tr key={e.id} className="border-b last:border-0">
                      <td className="whitespace-nowrap px-3 py-2 text-xs">{dhakaDateTime(e.date)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-xs">{ENTRY_TYPE_LABEL[e.type] ?? titleCase(e.type)}</td>
                      <td className="px-3 py-2">
                        {e.description}
                        <span className="block text-xs text-muted-foreground">{[e.order?.orderNumber, e.createdBy?.name].filter(Boolean).join(" · ")}</span>
                      </td>
                      <td className={cn("whitespace-nowrap px-3 py-2 text-right font-medium tabular-nums", Number(e.amount) < 0 ? "text-red-700" : "text-emerald-700")}>
                        {Number(e.amount) > 0 ? "+" : ""}{bdt(e.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Pagination meta={q.data?.meta as PageMeta | undefined} onPage={setPage} />
        </div>
      </SheetContent>
    </Sheet>
  );
}

const accountSchema = z.object({
  name: z.string().trim().min(2, "At least 2 characters").max(60),
  type: z.enum(ACCOUNT_TYPES),
  accountNumber: z.string().trim().max(60).optional(),
  openingBalance: z.string().trim().regex(/^-?\d+(\.\d{1,2})?$/, "Enter an amount").or(z.literal("")),
});
type AccountForm = z.infer<typeof accountSchema>;

function CreateAccountDialog({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const { register, handleSubmit, reset, setError, formState: { errors, isSubmitting } } = useForm<AccountForm>({ resolver: zodResolver(accountSchema), defaultValues: { name: "", type: "BANK", accountNumber: "", openingBalance: "0" } });
  const submit = handleSubmit(async (v) => {
    try {
      await api("/finance/accounts", { method: "POST", body: { name: v.name, type: v.type, accountNumber: v.accountNumber || null, openingBalance: v.openingBalance || "0" } });
      toast.success(`Account "${v.name}" created`);
      reset();
      onSaved();
      onClose();
    } catch (e) {
      handleFormError(e, setError);
    }
  });
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New account</DialogTitle>
          <DialogDescription>A place money is kept: cash box, bank account, bKash / Nagad merchant wallet.</DialogDescription>
        </DialogHeader>
        <form id="account-form" onSubmit={submit} className="space-y-3" noValidate>
          <Field label="Name" htmlFor="ac-name" error={errors.name?.message}><Input id="ac-name" {...register("name")} placeholder="e.g. Nagad Merchant" /></Field>
          <Field label="Type" htmlFor="ac-type" error={errors.type?.message}>
            <NativeSelect id="ac-type" {...register("type")}>{ACCOUNT_TYPES.map((t) => <option key={t} value={t}>{titleCase(t)}</option>)}</NativeSelect>
          </Field>
          <Field label="Account / wallet number (optional)" htmlFor="ac-num" error={errors.accountNumber?.message}><Input id="ac-num" {...register("accountNumber")} /></Field>
          <Field label="Opening balance (BDT)" htmlFor="ac-open" error={errors.openingBalance?.message} hint="Balance on the day you start tracking it here"><Input id="ac-open" inputMode="decimal" {...register("openingBalance")} /></Field>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="account-form" disabled={isSubmitting}>{isSubmitting && <Loader2 className="size-4 animate-spin" />} Create account</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const transferSchema = z
  .object({
    fromAccountId: z.string().min(1, "Choose an account"),
    toAccountId: z.string().min(1, "Choose an account"),
    amount: z.string().trim().regex(MONEY_RE, "Enter an amount").refine((v) => Number(v) > 0, "Must be more than 0"),
    date: z.string().regex(DATE_RE, "Pick a date"),
    note: z.string().trim().max(300).optional(),
  })
  .refine((v) => v.fromAccountId !== v.toAccountId, { message: "Choose two different accounts", path: ["toAccountId"] });
type TransferForm = z.infer<typeof transferSchema>;

function TransferDialog({ open, accounts, onClose, onSaved }: { open: boolean; accounts: Account[]; onClose: () => void; onSaved: () => void }) {
  const [pending, setPending] = useState<TransferForm | null>(null);
  const [busy, setBusy] = useState(false);
  const { register, handleSubmit, reset, setError, formState: { errors, isSubmitting } } = useForm<TransferForm>({ resolver: zodResolver(transferSchema), defaultValues: { fromAccountId: "", toAccountId: "", amount: "", date: dhakaToday(), note: "" } });
  const close = () => { setPending(null); onClose(); };
  const name = (id?: string) => accounts.find((a) => a.id === id)?.name;
  const confirm = async () => {
    setBusy(true);
    try {
      await api("/finance/transfers", { method: "POST", body: { ...pending, note: pending!.note || undefined } });
      toast.success(`Moved ${bdt(pending!.amount)} from ${name(pending!.fromAccountId)} to ${name(pending!.toAccountId)}`);
      reset({ fromAccountId: "", toAccountId: "", amount: "", date: dhakaToday(), note: "" });
      onSaved();
      close();
    } catch (e) {
      setPending(null);
      handleFormError(e, setError);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Transfer between accounts</DialogTitle>
          <DialogDescription>For example bKash → bank. Moves cash only; it does not change profit.</DialogDescription>
        </DialogHeader>
        {pending ? (
          <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            Move <b>{bdt(pending.amount)}</b> from <b>{name(pending.fromAccountId)}</b> to <b>{name(pending.toAccountId)}</b> on {pending.date}?
          </p>
        ) : (
          <form id="transfer-form" onSubmit={handleSubmit(setPending)} className="space-y-3" noValidate>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="From" htmlFor="tr-from" error={errors.fromAccountId?.message}>
                <NativeSelect id="tr-from" {...register("fromAccountId")}>
                  <option value="">Choose…</option>
                  {accounts.filter((a) => a.isActive).map((a) => <option key={a.id} value={a.id}>{a.name} ({bdt(a.balance)})</option>)}
                </NativeSelect>
              </Field>
              <Field label="To" htmlFor="tr-to" error={errors.toAccountId?.message}>
                <NativeSelect id="tr-to" {...register("toAccountId")}>
                  <option value="">Choose…</option>
                  {accounts.filter((a) => a.isActive).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </NativeSelect>
              </Field>
              <Field label="Amount (BDT)" htmlFor="tr-amount" error={errors.amount?.message}><Input id="tr-amount" inputMode="decimal" {...register("amount")} /></Field>
              <Field label="Date" htmlFor="tr-date" error={errors.date?.message}><Input id="tr-date" type="date" max={dhakaToday()} {...register("date")} /></Field>
            </div>
            <Field label="Note (optional)" htmlFor="tr-note" error={errors.note?.message}><Input id="tr-note" {...register("note")} placeholder="e.g. Weekly bKash cash-out" /></Field>
          </form>
        )}
        <DialogFooter>
          {pending ? (
            <>
              <Button variant="outline" onClick={() => setPending(null)} disabled={busy}>Back</Button>
              <Button onClick={confirm} disabled={busy}>{busy && <Loader2 className="size-4 animate-spin" />} Confirm transfer</Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={close}>Cancel</Button>
              <Button type="submit" form="transfer-form" disabled={isSubmitting}>Continue</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const adjustSchema = z.object({
  direction: z.enum(["in", "out"]),
  amount: z.string().trim().regex(MONEY_RE, "Enter an amount").refine((v) => Number(v) > 0, "Must be more than 0"),
  date: z.string().regex(DATE_RE, "Pick a date"),
  accountId: z.string().optional(),
  reason: z.string().trim().min(5, "Explain the adjustment (min 5 characters)").max(500),
});
type AdjustForm = z.infer<typeof adjustSchema>;

function AdjustmentDialog({ open, accounts, onClose, onSaved }: { open: boolean; accounts: Account[]; onClose: () => void; onSaved: () => void }) {
  const [pending, setPending] = useState<AdjustForm | null>(null);
  const [busy, setBusy] = useState(false);
  const { register, handleSubmit, reset, setError, formState: { errors } } = useForm<AdjustForm>({ resolver: zodResolver(adjustSchema), defaultValues: { direction: "in", amount: "", date: dhakaToday(), accountId: "", reason: "" } });
  const close = () => { setPending(null); onClose(); };
  const signed = pending ? (pending.direction === "out" ? `-${pending.amount}` : pending.amount) : "0";
  const acct = accounts.find((a) => a.id === pending?.accountId);
  const confirm = async () => {
    setBusy(true);
    try {
      await api("/finance/adjustments", { method: "POST", body: { amount: signed, date: pending!.date, accountId: pending!.accountId || null, reason: pending!.reason } });
      toast.success("Adjustment posted");
      reset({ direction: "in", amount: "", date: dhakaToday(), accountId: "", reason: "" });
      onSaved();
      close();
    } catch (e) {
      setPending(null);
      handleFormError(e, setError);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Manual adjustment</DialogTitle>
          <DialogDescription>Corrects the books (e.g. counted cash differs). It affects profit and, if an account is chosen, that account&apos;s balance. Audited.</DialogDescription>
        </DialogHeader>
        {pending ? (
          <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <p>
              Post an adjustment of <b className={cn(Number(signed) < 0 && "text-red-700")}>{bdt(signed)}</b> on {pending.date}
              {acct ? <> to <b>{acct.name}</b> (balance {bdt(acct.balance)} → {bdt(Number(acct.balance) + Number(signed))})</> : " (no cash movement)"}?
            </p>
            <p className="text-xs">Reason: {pending.reason}</p>
          </div>
        ) : (
          <form id="adjust-form" onSubmit={handleSubmit(setPending)} className="space-y-3" noValidate>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Direction" htmlFor="adj-dir">
                <NativeSelect id="adj-dir" {...register("direction")}>
                  <option value="in">Increase (+)</option>
                  <option value="out">Decrease (−)</option>
                </NativeSelect>
              </Field>
              <Field label="Amount (BDT)" htmlFor="adj-amount" error={errors.amount?.message}><Input id="adj-amount" inputMode="decimal" {...register("amount")} /></Field>
              <Field label="Date" htmlFor="adj-date" error={errors.date?.message}><Input id="adj-date" type="date" max={dhakaToday()} {...register("date")} /></Field>
              <Field label="Account" htmlFor="adj-account" error={errors.accountId?.message}>
                <NativeSelect id="adj-account" {...register("accountId")}>
                  <option value="">None (books only)</option>
                  {accounts.filter((a) => a.isActive).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </NativeSelect>
              </Field>
            </div>
            <Field label="Reason" htmlFor="adj-reason" error={errors.reason?.message}><Textarea id="adj-reason" rows={3} {...register("reason")} /></Field>
          </form>
        )}
        <DialogFooter>
          {pending ? (
            <>
              <Button variant="outline" onClick={() => setPending(null)} disabled={busy}>Back</Button>
              <Button onClick={confirm} disabled={busy}>{busy && <Loader2 className="size-4 animate-spin" />} Post adjustment</Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={close}>Cancel</Button>
              <Button type="submit" form="adjust-form">Review</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
