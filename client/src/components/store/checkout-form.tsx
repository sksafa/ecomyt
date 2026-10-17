"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { AlertCircle, CreditCard, Loader2, Lock, Wallet } from "lucide-react";
import { toast } from "sonner";
import { api, ApiError, errorMessage, newIdempotencyKey, request } from "@/lib/api";
import { bdt } from "@/lib/format";
import { cn } from "@/lib/utils";
import { cart } from "./cart";
import { attributionPayload, contentData, track } from "./tracking";
import type { CheckoutResult, LocDivision, OnlineOptions, ShippingQuote } from "./types";

export interface CheckoutLine {
  variantId: string;
  sku: string;
  name: string;
  variantName: string | null;
  price: string;
  quantity: number;
  imageUrl: string | null;
  weightGrams?: number | null;
}

const KEY_STORE = "bb_checkout_key";
export const LAST_ORDER_STORE = "bb_last_order";

/** 01XXXXXXXXX, also accepting +880 / 880 prefixes, spaces and dashes. Returns null when invalid. */
export function normalizePhone(raw: string) {
  const m = raw.replace(/[\s-]/g, "").match(/^(?:\+?88)?(01[3-9]\d{8})$/);
  return m ? m[1] : null;
}

type Field = "name" | "phone" | "division" | "district" | "area" | "address" | "note" | "form";
const SERVER_FIELD: Record<string, Field> = {
  "customer.name": "name",
  "customer.phone": "phone",
  "shipping.addressLine": "address",
  "shipping.districtId": "district",
  "shipping.areaId": "area",
  "shipping.note": "note",
};

function FieldError({ id, msg }: { id: string; msg?: string }) {
  if (!msg) return null;
  return (
    <p id={id} className="mt-1 flex items-center gap-1 text-xs text-destructive" role="alert">
      <AlertCircle className="size-3.5 shrink-0" aria-hidden /> {msg}
    </p>
  );
}

const inputCls = (bad?: boolean) =>
  cn("h-12 w-full rounded-md border bg-card px-3 text-base outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/15", bad ? "border-destructive" : "border-input");

/** Reuse one Idempotency-Key per checkout attempt (survives retries, double clicks and reloads in this tab). */
function checkoutKey() {
  try {
    const k = sessionStorage.getItem(KEY_STORE);
    if (k) return k;
    const n = newIdempotencyKey();
    sessionStorage.setItem(KEY_STORE, n);
    return n;
  } catch {
    return newIdempotencyKey();
  }
}
function resetCheckoutKey() {
  try {
    sessionStorage.removeItem(KEY_STORE);
  } catch {
    // ignore
  }
}

export function CheckoutForm({
  lines,
  source,
  initiateOnMount = true,
  compact = false,
  submitLabel,
}: {
  lines: CheckoutLine[];
  source: "cart" | "landing";
  initiateOnMount?: boolean;
  compact?: boolean;
  submitLabel?: string;
}) {
  const router = useRouter();
  const uid = useId();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [divisionId, setDivisionId] = useState("");
  const [districtId, setDistrictId] = useState("");
  const [areaId, setAreaId] = useState("");
  const [address, setAddress] = useState("");
  const [note, setNote] = useState("");
  const [website, setWebsite] = useState(""); // honeypot
  const [pay, setPay] = useState<string>("COD"); // "COD" or a gateway code
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [submitting, setSubmitting] = useState(false);
  const inFlight = useRef(false);
  const initiated = useRef(false);

  const subtotal = lines.reduce((s, l) => s + Number(l.price) * l.quantity, 0);
  const knownWeight = lines.every((l) => l.weightGrams) ? lines.reduce((s, l) => s + (l.weightGrams ?? 0) * l.quantity, 0) : undefined;

  const fireInitiate = () => {
    if (initiated.current || !lines.length) return;
    initiated.current = true;
    track("InitiateCheckout", contentData(lines));
  };
  useEffect(() => {
    if (initiateOnMount) fireInitiate();
    // fire once when the form first has lines
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initiateOnMount, lines.length > 0]);

  const locations = useQuery({ queryKey: ["store", "locations"], queryFn: () => api<LocDivision[]>("/shipping/locations"), staleTime: Infinity });
  const online = useQuery({ queryKey: ["store", "online-options"], queryFn: () => api<OnlineOptions>("/payments/online/options"), staleTime: 5 * 60_000, retry: false });
  const gateways = online.data?.gateways ?? [];

  const division = locations.data?.find((d) => d.id === divisionId);
  const district = division?.districts.find((d) => d.id === districtId);
  const areas = district?.areas ?? [];

  const quote = useQuery({
    queryKey: ["store", "quote", districtId, areaId, knownWeight, subtotal.toFixed(2)],
    queryFn: () =>
      api<ShippingQuote>("/shipping/quote", {
        method: "POST",
        body: { districtId, areaId: areaId || null, ...(knownWeight ? { weightGrams: Math.min(100_000, Math.round(knownWeight)) } : {}), merchandiseTotal: subtotal.toFixed(2) },
      }),
    enabled: !!districtId && lines.length > 0,
    staleTime: 60_000,
  });
  const delivery = quote.data ? Number(quote.data.deliveryCharge) : null;
  const total = subtotal + (delivery ?? 0);

  const validate = () => {
    const e: Partial<Record<Field, string>> = {};
    if (name.trim().length < 2) e.name = "Please enter your full name · আপনার নাম লিখুন";
    if (!normalizePhone(phone)) e.phone = "Enter a valid mobile number, e.g. 01712345678 · সঠিক মোবাইল নম্বর দিন";
    if (!divisionId) e.division = "Select your division · বিভাগ নির্বাচন করুন";
    if (!districtId) e.district = "Select your district · জেলা নির্বাচন করুন";
    if (areas.length && !areaId) e.area = "Select your area / thana · এলাকা নির্বাচন করুন";
    if (address.trim().length < 5) e.address = "Enter your full address (house, road, area) · পূর্ণ ঠিকানা লিখুন";
    return e;
  };

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (inFlight.current) return; // double-click guard (the idempotency key covers the network side)
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length) {
      const first = Object.keys(e)[0];
      document.getElementById(`${uid}-${first}`)?.focus();
      return;
    }
    if (!lines.length) return;
    inFlight.current = true;
    setSubmitting(true);
    const mobile = normalizePhone(phone)!;
    const gateway = pay !== "COD" ? (gateways.find((g) => g.code === pay)?.code ?? null) : null;
    try {
      const { data: res } = await request<CheckoutResult>("/storefront/checkout", {
        method: "POST",
        idempotencyKey: checkoutKey(),
        body: {
          customer: { name: name.trim(), phone: mobile },
          shipping: { addressLine: address.trim(), districtId, areaId: areaId || null, note: note.trim() || null },
          items: lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity })),
          paymentMethod: gateway ? "SSLCOMMERZ" : "COD",
          attribution: attributionPayload(),
          website,
        },
      });
      resetCheckoutKey();
      // Purchase: eventID matches the server-side Conversions API event so Meta deduplicates them
      track("Purchase", contentData(lines, Number(res.total)), res.metaEventId);
      try {
        sessionStorage.setItem(LAST_ORDER_STORE, JSON.stringify({ order: res.orderNumber, phone: mobile }));
      } catch {
        // ignore
      }
      if (source === "cart") cart.clear();
      const statusUrl = `/order-status?order=${encodeURIComponent(res.orderNumber)}&phone=${mobile}`;

      if (gateway && res.paymentRequired) {
        try {
          const init = await api<{ redirectUrl: string }>("/payments/online/init", { method: "POST", body: { orderNumber: res.orderNumber, phone: mobile, gateway } });
          window.location.assign(init.redirectUrl);
          return; // keep the button disabled while the browser leaves
        } catch (err) {
          toast.error(`Your order ${res.orderNumber} is placed, but online payment could not start: ${errorMessage(err)}`);
          router.push(`${statusUrl}&payment=failed`);
          return;
        }
      }
      router.push(`${statusUrl}&placed=1`);
    } catch (err) {
      inFlight.current = false;
      setSubmitting(false);
      if (err instanceof ApiError) {
        const fe = err.fieldErrors;
        const mapped: Partial<Record<Field, string>> = {};
        for (const [path, msg] of Object.entries(fe)) mapped[SERVER_FIELD[path] ?? "form"] = msg;
        if (err.status === 400 && /mobile number/i.test(err.message)) mapped.phone = err.message;
        if (err.status === 409) resetCheckoutKey(); // key clash with another order – a fresh attempt gets a fresh key
        if (!Object.keys(mapped).length || mapped.form) mapped.form = mapped.form ?? (err.status === 429 ? "Too many attempts. Please wait a few minutes and try again." : err.message);
        setErrors(mapped);
        if (mapped.form) toast.error(mapped.form);
      } else {
        setErrors({ form: "Network problem – please check your connection and try again. Your order was not duplicated." });
      }
    }
  };

  const id = (f: Field) => `${uid}-${f}`;
  /** Clear a field's error (and the form-level one) as soon as the customer edits it. */
  const fix = (f: Field) => {
    if (errors[f] || errors.form) setErrors((p) => ({ ...p, [f]: undefined, form: undefined }));
  };
  const errProps = (f: Field) => ({ "aria-invalid": !!errors[f] || undefined, "aria-describedby": errors[f] ? `${id(f)}-err` : undefined });

  const summary = (
      <div className="space-y-2 text-sm">
        <div className="flex justify-between">
          <span>Subtotal</span>
          <span>{bdt(subtotal)}</span>
        </div>
        <div className="flex justify-between">
          <span>Delivery charge · ডেলিভারি চার্জ</span>
          <span>{!districtId ? <span className="text-muted-foreground">Select district</span> : quote.isFetching && !quote.data ? <Loader2 className="size-4 animate-spin" aria-label="Calculating" /> : quote.isError ? <span className="text-destructive">Unavailable</span> : bdt(delivery)}</span>
        </div>
        <div className="flex justify-between border-t border-border pt-2 text-base font-semibold">
          <span>Total · মোট</span>
          <span className="text-primary">{bdt(total)}</span>
        </div>
      </div>
  );

  return (
    <form onSubmit={submit} noValidate className="space-y-5" onFocus={fireInitiate}>
      <div className={cn("grid gap-4", !compact && "sm:grid-cols-2")}>
        <div>
          <label htmlFor={id("name")} className="mb-1.5 block text-sm font-medium">
            Full name · <span className="font-bengali">নাম</span>
          </label>
          <input id={id("name")} autoComplete="name" value={name} onChange={(e) => (setName(e.target.value), fix("name"))} maxLength={100} className={inputCls(!!errors.name)} {...errProps("name")} />
          <FieldError id={`${id("name")}-err`} msg={errors.name} />
        </div>
        <div>
          <label htmlFor={id("phone")} className="mb-1.5 block text-sm font-medium">
            Mobile number · <span className="font-bengali">মোবাইল নম্বর</span>
          </label>
          <input
            id={id("phone")}
            type="tel"
            inputMode="numeric"
            autoComplete="tel-national"
            placeholder="01XXXXXXXXX"
            value={phone}
            onChange={(e) => (setPhone(e.target.value), fix("phone"))}
            onBlur={() => phone && !normalizePhone(phone) && setErrors((p) => ({ ...p, phone: "Enter a valid mobile number, e.g. 01712345678 · সঠিক মোবাইল নম্বর দিন" }))}
            maxLength={20}
            className={inputCls(!!errors.phone)}
            {...errProps("phone")}
          />
          <FieldError id={`${id("phone")}-err`} msg={errors.phone} />
        </div>
      </div>

      <div className={cn("grid gap-4", !compact && "sm:grid-cols-3")}>
        <div>
          <label htmlFor={id("division")} className="mb-1.5 block text-sm font-medium">
            Division · <span className="font-bengali">বিভাগ</span>
          </label>
          <select
            id={id("division")}
            value={divisionId}
            onChange={(e) => {
              setDivisionId(e.target.value);
              fix("division");
              setDistrictId("");
              setAreaId("");
            }}
            disabled={locations.isLoading}
            className={inputCls(!!errors.division)}
            {...errProps("division")}
          >
            <option value="">{locations.isLoading ? "Loading…" : locations.isError ? "Could not load – refresh" : "Select division"}</option>
            {locations.data?.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
                {d.nameBn ? ` · ${d.nameBn}` : ""}
              </option>
            ))}
          </select>
          <FieldError id={`${id("division")}-err`} msg={errors.division} />
        </div>
        <div>
          <label htmlFor={id("district")} className="mb-1.5 block text-sm font-medium">
            District · <span className="font-bengali">জেলা</span>
          </label>
          <select
            id={id("district")}
            value={districtId}
            onChange={(e) => {
              setDistrictId(e.target.value);
              fix("district");
              setAreaId("");
            }}
            disabled={!division}
            className={inputCls(!!errors.district)}
            {...errProps("district")}
          >
            <option value="">Select district</option>
            {division?.districts.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
                {d.nameBn ? ` · ${d.nameBn}` : ""}
              </option>
            ))}
          </select>
          <FieldError id={`${id("district")}-err`} msg={errors.district} />
        </div>
        <div>
          <label htmlFor={id("area")} className="mb-1.5 block text-sm font-medium">
            Area / thana · <span className="font-bengali">এলাকা</span>
          </label>
          <select id={id("area")} value={areaId} onChange={(e) => (setAreaId(e.target.value), fix("area"))} disabled={!areas.length} className={inputCls(!!errors.area)} {...errProps("area")}>
            <option value="">{district && !areas.length ? "Not needed" : "Select area"}</option>
            {areas.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
                {a.nameBn ? ` · ${a.nameBn}` : ""}
              </option>
            ))}
          </select>
          <FieldError id={`${id("area")}-err`} msg={errors.area} />
        </div>
      </div>

      <div>
        <label htmlFor={id("address")} className="mb-1.5 block text-sm font-medium">
          Full address · <span className="font-bengali">সম্পূর্ণ ঠিকানা</span>
        </label>
        <textarea
          id={id("address")}
          autoComplete="street-address"
          rows={2}
          placeholder="House, road, area / বাসা, রোড, এলাকা"
          value={address}
          onChange={(e) => (setAddress(e.target.value), fix("address"))}
          maxLength={500}
          className={cn(inputCls(!!errors.address), "h-auto py-2.5")}
          {...errProps("address")}
        />
        <FieldError id={`${id("address")}-err`} msg={errors.address} />
      </div>

      <div>
        <label htmlFor={id("note")} className="mb-1.5 block text-sm font-medium">
          Note <span className="font-normal text-muted-foreground">(optional · ঐচ্ছিক)</span>
        </label>
        <input id={id("note")} value={note} onChange={(e) => (setNote(e.target.value), fix("note"))} maxLength={500} placeholder="Delivery instructions" className={inputCls(!!errors.note)} {...errProps("note")} />
        <FieldError id={`${id("note")}-err`} msg={errors.note} />
      </div>

      {/* honeypot: hidden from people and assistive tech; bots that fill it are rejected by the server */}
      <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label htmlFor={id("form") + "-w"}>Website</label>
        <input id={id("form") + "-w"} name="website" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
      </div>

      <fieldset>
        <legend className="mb-2 text-sm font-medium">Payment · পেমেন্ট</legend>
        <div className="space-y-2">
          <PayOption checked={pay === "COD"} onSelect={() => setPay("COD")} icon={<Wallet className="size-5" />} title="Cash on delivery" sub="ক্যাশ অন ডেলিভারি — পণ্য হাতে পেয়ে টাকা দিন" name={`${uid}-pay`} />
          {gateways.map((g) => (
            <PayOption
              key={g.code}
              checked={pay === g.code}
              onSelect={() => setPay(g.code)}
              icon={<CreditCard className="size-5" />}
              title={g.code === "sandbox" ? "Pay online (test gateway)" : "Pay online – bKash, Nagad, card"}
              sub={g.code === "sandbox" ? "Development only – no real money" : "অনলাইনে পেমেন্ট (SSLCommerz)"}
              name={`${uid}-pay`}
            />
          ))}
        </div>
      </fieldset>

      <div className="rounded-lg border border-border bg-secondary/50 p-4">{summary}</div>

      {errors.form && (
        <p className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive" role="alert">
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden /> {errors.form}
        </p>
      )}

      <button type="submit" disabled={submitting || !lines.length} className="flex h-14 w-full items-center justify-center gap-2 rounded-md bg-primary text-base font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 disabled:opacity-60">
        {submitting ? <Loader2 className="size-5 animate-spin" aria-hidden /> : <Lock className="size-4" aria-hidden />}
        {submitting ? "Placing order…" : (submitLabel ?? `Confirm order · ${bdt(total)}`)}
      </button>
      <p className="text-center font-bengali text-xs text-muted-foreground">অর্ডার কনফার্ম করতে আমরা আপনাকে কল করতে পারি।</p>
    </form>
  );
}

function PayOption({ checked, onSelect, icon, title, sub, name }: { checked: boolean; onSelect: () => void; icon: React.ReactNode; title: string; sub: string; name: string }) {
  return (
    <label className={cn("flex min-h-14 cursor-pointer items-center gap-3 rounded-lg border bg-card p-3", checked ? "border-primary ring-1 ring-primary" : "border-input")}>
      <input type="radio" name={name} checked={checked} onChange={onSelect} className="size-4 accent-[var(--bb-maroon)]" />
      <span className="text-primary">{icon}</span>
      <span>
        <span className="block text-sm font-medium">{title}</span>
        <span className="block font-bengali text-xs text-muted-foreground">{sub}</span>
      </span>
    </label>
  );
}
