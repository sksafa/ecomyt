"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { AlertCircle, Check, CheckCircle2, Copy, Loader2, Package, PartyPopper, Truck, XCircle } from "lucide-react";
import { toast } from "sonner";
import { api, ApiError, errorMessage } from "@/lib/api";
import { bdt, dhakaDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useHydrated } from "./cart";
import { LAST_ORDER_STORE, normalizePhone } from "./checkout-form";
import type { OrderLookup } from "./types";
import { Container, Img } from "./ui";

const FRIENDLY: Record<string, { en: string; bn: string }> = {
  PENDING: { en: "We’ve received your order and will call you shortly to confirm it.", bn: "আপনার অর্ডার পেয়েছি, কনফার্ম করতে শীঘ্রই কল করব।" },
  CONFIRMATION_REQUIRED: { en: "We’ll call you to confirm your order.", bn: "অর্ডার কনফার্ম করতে আমরা আপনাকে কল করব।" },
  CONFIRMED: { en: "Your order is confirmed and will be packed soon.", bn: "আপনার অর্ডার কনফার্ম হয়েছে, শীঘ্রই প্যাক করা হবে।" },
  PROCESSING: { en: "Your orna is being prepared and packed.", bn: "আপনার ওড়না প্যাক করা হচ্ছে।" },
  READY_TO_SHIP: { en: "Packed and ready to hand over to the courier.", bn: "প্যাক সম্পন্ন, কুরিয়ারে দেওয়ার জন্য প্রস্তুত।" },
  COURIER_BOOKED: { en: "A courier has been booked for your parcel.", bn: "আপনার পার্সেলের জন্য কুরিয়ার বুক করা হয়েছে।" },
  SHIPPED: { en: "Your parcel is on the way.", bn: "আপনার পার্সেল পথে আছে।" },
  DELIVERED: { en: "Delivered. We hope you love it!", bn: "ডেলিভারি সম্পন্ন। ধন্যবাদ!" },
  CANCELLED: { en: "This order was cancelled.", bn: "এই অর্ডারটি বাতিল করা হয়েছে।" },
  ON_HOLD: { en: "Your order is on hold – we’ll contact you.", bn: "অর্ডারটি হোল্ডে আছে – আমরা যোগাযোগ করব।" },
  RETURN_REQUESTED: { en: "Return requested.", bn: "ফেরতের অনুরোধ করা হয়েছে।" },
  RETURN_IN_TRANSIT: { en: "Your return is on its way back to us.", bn: "ফেরত পণ্য আমাদের কাছে আসছে।" },
  RETURNED: { en: "The parcel has been returned.", bn: "পার্সেল ফেরত এসেছে।" },
  EXCHANGE_REQUESTED: { en: "Exchange requested – we’ll be in touch.", bn: "এক্সচেঞ্জের অনুরোধ করা হয়েছে।" },
  EXCHANGED: { en: "Exchange completed.", bn: "এক্সচেঞ্জ সম্পন্ন।" },
};

const PAYMENT_LABEL: Record<string, { en: string; bn: string }> = {
  UNPAID: { en: "Unpaid", bn: "পরিশোধ হয়নি" },
  PARTIALLY_PAID: { en: "Partially paid", bn: "আংশিক পরিশোধিত" },
  PAID: { en: "Paid", bn: "পরিশোধিত" },
  PARTIALLY_REFUNDED: { en: "Partially refunded", bn: "আংশিক ফেরত" },
  REFUNDED: { en: "Refunded", bn: "টাকা ফেরত" },
};
const METHOD_LABEL: Record<string, string> = { COD: "Cash on delivery · ক্যাশ অন ডেলিভারি", SSLCOMMERZ: "Online (SSLCommerz)", BKASH: "bKash", NAGAD: "Nagad", ROCKET: "Rocket", CARD: "Card", BANK_TRANSFER: "Bank transfer", CASH: "Cash" };

function storedLast(): { order: string; phone: string } | null {
  try {
    return JSON.parse(sessionStorage.getItem(LAST_ORDER_STORE) ?? "null");
  } catch {
    return null;
  }
}

export function OrderStatusView() {
  // the lookup may use this tab's sessionStorage, so render after hydration to avoid SSR mismatches
  const hydrated = useHydrated();
  if (!hydrated) {
    return (
      <Container className="max-w-3xl py-10">
        <div className="h-9 w-64 animate-pulse rounded bg-secondary" />
        <div className="mt-5 h-28 animate-pulse rounded-xl bg-secondary/70" />
      </Container>
    );
  }
  return <OrderStatusInner />;
}

function OrderStatusInner() {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const urlOrder = sp.get("order") ?? "";
  // phone may be missing when returning from the payment gateway – fall back to this tab's last order
  const last = storedLast();
  const urlPhone = sp.get("phone") ?? (last && last.order === urlOrder ? last.phone : "");
  const payment = sp.get("payment");
  const placed = sp.get("placed") === "1";

  const [order, setOrder] = useState(urlOrder);
  const [phone, setPhone] = useState(urlPhone);
  const [formErr, setFormErr] = useState<string | null>(null);

  const enabled = !!urlOrder && !!normalizePhone(urlPhone);
  const q = useQuery({
    queryKey: ["store", "order", urlOrder, urlPhone],
    queryFn: () => api<OrderLookup>(`/storefront/orders/${encodeURIComponent(urlOrder.trim())}`, { query: { phone: urlPhone } }),
    enabled,
    retry: false,
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const p = normalizePhone(phone);
    if (order.trim().length < 3) return setFormErr("Enter your order number · অর্ডার নম্বর দিন");
    if (!p) return setFormErr("Enter the mobile number used for the order · সঠিক মোবাইল নম্বর দিন");
    setFormErr(null);
    const next = new URLSearchParams({ order: order.trim().toUpperCase(), phone: p });
    if (payment) next.set("payment", payment);
    router.replace(`${pathname}?${next}`, { scroll: false });
  };

  return (
    <Container className="max-w-3xl py-8 sm:py-10">
      {placed && q.data && (
        <div className="mb-6 rounded-xl border border-emerald-300 bg-emerald-50 p-5 text-emerald-900" role="status">
          <p className="flex items-center gap-2 font-display text-2xl font-semibold">
            <PartyPopper className="size-6" aria-hidden /> Thank you! Order placed.
          </p>
          <p className="mt-1 font-bengali text-sm">ধন্যবাদ! আপনার অর্ডারটি গ্রহণ করা হয়েছে। কনফার্ম করতে আমরা শীঘ্রই কল করব।</p>
        </div>
      )}
      {payment === "success" && (
        <Banner tone="ok" title="Payment successful · পেমেন্ট সফল হয়েছে" text="Thank you – your online payment was received." />
      )}
      {payment === "failed" && (
        <Banner tone="bad" title="Payment failed · পেমেন্ট ব্যর্থ হয়েছে" text="Your order is saved. You can pay cash on delivery, or contact us to try again." />
      )}
      {payment === "cancelled" && <Banner tone="warn" title="Payment cancelled · পেমেন্ট বাতিল" text="Your order is saved and unpaid. You can pay cash on delivery." />}

      <h1 className="font-display text-3xl font-semibold sm:text-4xl">
        Track your order <span className="font-bengali text-xl text-muted-foreground">· অর্ডার ট্র্যাক</span>
      </h1>

      <form onSubmit={submit} className="mt-5 grid gap-3 rounded-xl border border-border bg-card p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end sm:p-5" noValidate>
        <div>
          <label htmlFor="os-order" className="mb-1.5 block text-sm font-medium">
            Order number · <span className="font-bengali">অর্ডার নম্বর</span>
          </label>
          <input id="os-order" value={order} onChange={(e) => setOrder(e.target.value)} placeholder="e.g. BB-1001" autoCapitalize="characters" className="h-12 w-full rounded-md border border-input bg-background px-3 text-base uppercase outline-none focus:border-primary" />
        </div>
        <div>
          <label htmlFor="os-phone" className="mb-1.5 block text-sm font-medium">
            Mobile · <span className="font-bengali">মোবাইল</span>
          </label>
          <input id="os-phone" type="tel" inputMode="numeric" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="01XXXXXXXXX" className="h-12 w-full rounded-md border border-input bg-background px-3 text-base outline-none focus:border-primary" />
        </div>
        <button type="submit" className="h-12 rounded-md bg-primary px-6 text-sm font-medium text-primary-foreground hover:bg-primary/90">
          Track
        </button>
        {formErr && (
          <p className="flex items-center gap-1 text-sm text-destructive sm:col-span-3" role="alert">
            <AlertCircle className="size-4" aria-hidden /> {formErr}
          </p>
        )}
      </form>

      <div className="mt-6">
        {q.isLoading && enabled ? (
          <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
            <Loader2 className="size-5 animate-spin" aria-hidden /> Looking up your order…
          </div>
        ) : q.isError ? (
          q.error instanceof ApiError && q.error.status === 404 ? (
            <Banner tone="warn" title="Order not found · অর্ডার পাওয়া যায়নি" text="Please check the order number and the mobile number used when ordering." />
          ) : (
            <div className="rounded-xl border border-border bg-card p-6 text-center">
              <p className="text-sm text-destructive">{errorMessage(q.error)}</p>
              <button type="button" onClick={() => q.refetch()} className="mt-3 h-10 rounded-md border border-border px-4 text-sm hover:border-primary">
                Try again
              </button>
            </div>
          )
        ) : q.data ? (
          <OrderResult o={q.data} />
        ) : null}
      </div>
    </Container>
  );
}

function Banner({ tone, title, text }: { tone: "ok" | "bad" | "warn"; title: string; text: string }) {
  const Icon = tone === "ok" ? CheckCircle2 : tone === "bad" ? XCircle : AlertCircle;
  return (
    <div
      role="status"
      className={cn(
        "mb-6 flex gap-3 rounded-xl border p-4",
        tone === "ok" && "border-emerald-300 bg-emerald-50 text-emerald-900",
        tone === "bad" && "border-red-300 bg-red-50 text-red-900",
        tone === "warn" && "border-amber-300 bg-amber-50 text-amber-900",
      )}
    >
      <Icon className="mt-0.5 size-5 shrink-0" aria-hidden />
      <div>
        <p className="font-medium">{title}</p>
        <p className="mt-0.5 text-sm opacity-90">{text}</p>
      </div>
    </div>
  );
}

function OrderResult({ o }: { o: OrderLookup }) {
  const cancelled = o.status === "CANCELLED";
  const steps = [
    { key: "placed", en: "Order placed", bn: "অর্ডার করা হয়েছে", at: o.createdAt, icon: Package },
    { key: "confirmed", en: "Confirmed", bn: "কনফার্ম", at: o.confirmedAt, icon: Check },
    { key: "shipped", en: "On the way", bn: "পথে আছে", at: o.shippedAt, icon: Truck },
    { key: "delivered", en: "Delivered", bn: "ডেলিভারি সম্পন্ন", at: o.deliveredAt, icon: CheckCircle2 },
  ];
  const reached = steps.reduce((n, s, i) => (s.at ? i : n), 0);
  const friendly = FRIENDLY[o.status];
  const pay = PAYMENT_LABEL[o.payment.status] ?? { en: o.payment.status, bn: "" };
  const copy = (t: string) => navigator.clipboard?.writeText(t).then(() => toast.success("Copied"));

  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-widest text-muted-foreground">Order</p>
            <p className="text-2xl font-semibold tracking-wide tabular-nums">{o.orderNumber}</p>
            <p className="text-xs text-muted-foreground">Placed {dhakaDateTime(o.createdAt)}</p>
          </div>
          <span className={cn("rounded-full px-3 py-1 text-sm font-medium", cancelled ? "bg-red-100 text-red-800" : o.status === "DELIVERED" ? "bg-emerald-100 text-emerald-800" : "bg-primary/10 text-primary")}>
            {o.statusLabel.en} · <span className="font-bengali">{o.statusLabel.bn}</span>
          </span>
        </div>
        {friendly && (
          <p className="mt-3 text-sm">
            {friendly.en} <span className="block font-bengali text-muted-foreground">{friendly.bn}</span>
          </p>
        )}

        {cancelled ? (
          <p className="mt-4 text-sm text-red-800">Cancelled {dhakaDateTime(o.cancelledAt)}</p>
        ) : (
          <ol className="mt-6 grid grid-cols-4 gap-1" aria-label="Order progress">
            {steps.map((s, i) => {
              const done = i <= reached && (i === 0 || !!s.at);
              return (
                <li key={s.key} className="relative flex flex-col items-center text-center">
                  {i > 0 && <span aria-hidden className={cn("absolute right-1/2 top-4 h-0.5 w-full -translate-y-1/2", done ? "bg-primary" : "bg-border")} />}
                  <span className={cn("relative grid size-8 place-items-center rounded-full border-2", done ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground")}>
                    <s.icon className="size-4" aria-hidden />
                  </span>
                  <span className={cn("mt-2 text-xs font-medium", !done && "text-muted-foreground")}>{s.en}</span>
                  <span className="font-bengali text-[11px] text-muted-foreground">{s.bn}</span>
                  {s.at && <span className="mt-0.5 hidden text-[11px] text-muted-foreground sm:block">{dhakaDateTime(s.at)}</span>}
                  <span className="sr-only">{done ? "done" : "pending"}</span>
                </li>
              );
            })}
          </ol>
        )}

        {o.shipment && (
          <div className="mt-6 rounded-lg bg-secondary/60 p-4 text-sm">
            <p className="font-medium">
              <Truck className="mr-1.5 inline size-4 text-primary" aria-hidden /> Courier: {o.shipment.courier}
            </p>
            {o.shipment.trackingCode && (
              <p className="mt-1 flex items-center gap-2">
                Tracking code: <span className="font-mono font-medium">{o.shipment.trackingCode}</span>
                <button type="button" onClick={() => copy(o.shipment!.trackingCode!)} className="grid size-8 place-items-center rounded hover:bg-card" aria-label="Copy tracking code">
                  <Copy className="size-3.5" />
                </button>
              </p>
            )}
          </div>
        )}
      </section>

      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="font-display text-xl font-semibold">Items</h2>
        <ul className="mt-2 divide-y divide-border">
          {o.items.map((it, i) => (
            <li key={i} className="flex gap-3 py-3">
              <Img src={it.imageUrl} alt={it.productName} className="h-16 w-14 shrink-0 rounded-md" />
              <div className="min-w-0 flex-1">
                <p className="text-sm">{it.productName}</p>
                <p className="text-xs text-muted-foreground">
                  {[it.variantName ?? [it.color, it.size].filter(Boolean).join(" / "), `× ${it.quantity}`].filter(Boolean).join(" · ")}
                </p>
              </div>
              <span className="text-sm font-medium">{bdt(it.lineTotal)}</span>
            </li>
          ))}
        </ul>
        <dl className="mt-3 space-y-1.5 border-t border-border pt-3 text-sm">
          <Row k="Subtotal" v={bdt(o.totals.subtotal)} />
          {Number(o.totals.discount) > 0 && <Row k="Discount" v={`-${bdt(o.totals.discount)}`} />}
          <Row k="Delivery charge" v={bdt(o.totals.deliveryCharge)} />
          <Row k="Total · মোট" v={bdt(o.totals.total)} strong />
          {Number(o.totals.paid) > 0 && <Row k="Paid" v={bdt(o.totals.paid)} />}
          {Number(o.totals.due) > 0 && !cancelled && <Row k={o.payment.method === "COD" ? "Pay on delivery" : "Due"} v={bdt(o.totals.due)} strong />}
        </dl>
      </section>

      <section className="grid gap-3 rounded-xl border border-border bg-card p-5 text-sm sm:grid-cols-2">
        <div>
          <p className="text-xs uppercase tracking-widest text-muted-foreground">Payment method</p>
          <p className="mt-1">{METHOD_LABEL[o.payment.method] ?? o.payment.method}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-widest text-muted-foreground">Payment status</p>
          <p className="mt-1">
            {pay.en} {pay.bn && <span className="font-bengali text-muted-foreground">· {pay.bn}</span>}
          </p>
        </div>
      </section>

      <p className="text-center text-sm">
        <Link href="/shop" className="text-primary underline-offset-4 hover:underline">
          Continue shopping
        </Link>
      </p>
    </div>
  );
}

function Row({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className={cn("flex justify-between", strong && "text-base font-semibold")}>
      <dt>{k}</dt>
      <dd>{v}</dd>
    </div>
  );
}
