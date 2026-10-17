"use client";

import { useState, type ReactNode } from "react";
import { AlertTriangle, ChevronLeft, ChevronRight, Inbox, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { errorMessage, type PageMeta } from "@/lib/api";
import { TONE_CLASS, type Tone } from "@/lib/status";
import { bdt } from "@/lib/format";

export function PageHeader({ title, description, actions, children }: { title: string; description?: ReactNode; actions?: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight md:text-2xl">{title}</h1>
        {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
        {children}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Pill({ tone, children, className }: { tone: Tone; children: ReactNode; className?: string }) {
  return <span className={cn("inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium", TONE_CLASS[tone], className)}>{children}</span>;
}

export function Money({ value, className, muted }: { value: string | number | null | undefined; className?: string; muted?: boolean }) {
  return <span className={cn("tabular-nums", muted && "text-muted-foreground", className)}>{bdt(value)}</span>;
}

export function EmptyState({ title = "Nothing here yet", description, action, icon }: { title?: string; description?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed bg-white px-6 py-12 text-center">
      <div className="text-muted-foreground">{icon ?? <Inbox className="size-8" />}</div>
      <p className="font-medium">{title}</p>
      {description && <p className="max-w-md text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-6 py-8 text-center text-red-800">
      <AlertTriangle className="size-6" />
      <p className="font-medium">Couldn&apos;t load this</p>
      <p className="text-sm">{errorMessage(error)}</p>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry} className="mt-1">
          <RefreshCw className="size-4" /> Try again
        </Button>
      )}
    </div>
  );
}

export function LoadingRows({ rows = 5, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("space-y-3", className)} aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-16 w-full" />
      ))}
    </div>
  );
}

export function Pagination({ meta, onPage }: { meta?: PageMeta; onPage: (page: number) => void }) {
  if (!meta || meta.totalPages <= 1) return meta ? <p className="mt-3 text-sm text-muted-foreground">{meta.total} result{meta.total === 1 ? "" : "s"}</p> : null;
  return (
    <div className="mt-4 flex items-center justify-between gap-2 text-sm">
      <span className="text-muted-foreground">
        Page {meta.page} of {meta.totalPages} · {meta.total.toLocaleString("en-IN")} results
      </span>
      <div className="flex gap-1">
        <Button variant="outline" size="sm" disabled={meta.page <= 1} onClick={() => onPage(meta.page - 1)} aria-label="Previous page">
          <ChevronLeft className="size-4" />
        </Button>
        <Button variant="outline" size="sm" disabled={meta.page >= meta.totalPages} onClick={() => onPage(meta.page + 1)} aria-label="Next page">
          <ChevronRight className="size-4" />
        </Button>
      </div>
    </div>
  );
}

export function IconAction({ label, onClick, children, disabled, className, href }: { label: string; onClick?: () => void; children: ReactNode; disabled?: boolean; className?: string; href?: string }) {
  const btn = href ? (
    <Button variant="ghost" size="icon" className={cn("size-9 text-muted-foreground hover:text-foreground", className)} asChild aria-label={label}>
      <a href={href} target={href.startsWith("http") ? "_blank" : undefined} rel="noreferrer">
        {children}
      </a>
    </Button>
  ) : (
    <Button variant="ghost" size="icon" className={cn("size-9 text-muted-foreground hover:text-foreground", className)} onClick={onClick} disabled={disabled} aria-label={label}>
      {children}
    </Button>
  );
  return (
    <Tooltip>
      <TooltipTrigger asChild>{btn}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/** Confirmation for destructive / financially significant actions; optional required reason. */
export function ConfirmDialog({
  open, onOpenChange, title, description, confirmLabel = "Confirm", destructive, requireReason, reasonLabel = "Reason", onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  destructive?: boolean;
  requireReason?: boolean;
  reasonLabel?: string;
  onConfirm: (reason: string) => Promise<unknown> | void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <AlertDialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setReason("");
          setErr(null);
        }
        onOpenChange(o);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description && <AlertDialogDescription asChild><div>{description}</div></AlertDialogDescription>}
        </AlertDialogHeader>
        {requireReason && (
          <div className="space-y-1.5">
            <Label htmlFor="confirm-reason">{reasonLabel}</Label>
            <Textarea id="confirm-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} autoFocus />
          </div>
        )}
        {err && <p className="text-sm text-red-600">{err}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={busy || (requireReason && reason.trim().length < 3)}
            className={cn(destructive && "bg-destructive text-white hover:bg-destructive/90")}
            onClick={async (e) => {
              e.preventDefault();
              setBusy(true);
              setErr(null);
              try {
                await onConfirm(reason.trim());
                setReason("");
                onOpenChange(false);
              } catch (error) {
                setErr(errorMessage(error));
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy && <Loader2 className="size-4 animate-spin" />}
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function Section({ title, actions, children, className }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-xl border bg-card p-4 md:p-5", className)}>
      {(title || actions) && (
        <div className="mb-3 flex items-center justify-between gap-2">
          {title && <h2 className="font-semibold">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function Field({ label, error, children, hint, htmlFor }: { label: string; error?: string; children: ReactNode; hint?: ReactNode; htmlFor?: string }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && !error && <p className="text-xs text-muted-foreground">{hint}</p>}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

export function NativeSelect({ className, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={cn(
        "h-9 w-full rounded-md border border-input bg-white px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50",
        className,
      )}
    />
  );
}
