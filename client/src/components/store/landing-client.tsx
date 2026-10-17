"use client";

import { useEffect, useState } from "react";
import { MAX_QTY } from "./cart";
import { QtyStepper } from "./cart-drawer";
import { CheckoutForm } from "./checkout-form";
import { StockNote, useVariantPicker, VariantOptions } from "./product-detail";
import type { PublicProductDetail } from "./types";
import { Img, Price } from "./ui";

function parts(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return { d: Math.floor(s / 86400), h: Math.floor((s % 86400) / 3600), m: Math.floor((s % 3600) / 60), s: s % 60 };
}

export function Countdown({ title, endsAt }: { title: string; endsAt: string }) {
  const end = new Date(endsAt).getTime();
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const t = setInterval(tick, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, []);
  const left = now === null ? null : parts(end - now);
  const over = now !== null && end <= now;
  return (
    <div className="rounded-xl bg-[var(--bb-maroon)] px-4 py-6 text-center text-[#fbf1e6]">
      <p className="font-display text-2xl font-semibold sm:text-3xl">{title}</p>
      {over ? (
        <p className="mt-2 text-sm opacity-90">This offer has ended · অফার শেষ</p>
      ) : (
        <div className="mt-4 flex justify-center gap-2 sm:gap-4" role="timer" aria-live="off">
          {(["d", "h", "m", "s"] as const).map((k) => (
            <div key={k} className="w-16 rounded-lg bg-white/10 py-2 sm:w-20">
              <span className="block font-display text-3xl font-semibold tabular-nums">{left ? String(left[k]).padStart(2, "0") : "--"}</span>
              <span className="text-[11px] uppercase tracking-widest opacity-80">{{ d: "days", h: "hours", m: "mins", s: "secs" }[k]}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Compact direct-order form for one product on a landing page; places a real order through /storefront/checkout. */
export function OrderFormBlock({ title, product }: { title?: string | null; product: PublicProductDetail }) {
  const picker = useVariantPicker(product);
  const { variant } = picker;
  const [qty, setQty] = useState(1);
  const lines =
    variant && variant.inStock
      ? [{ variantId: variant.id, sku: variant.sku, name: product.name, variantName: variant.name, price: variant.price, quantity: qty, imageUrl: variant.imageUrl ?? product.imageUrl, weightGrams: product.weightGrams }]
      : [];
  return (
    <div id="order" className="scroll-mt-20 rounded-2xl border-2 border-primary/20 bg-card p-4 shadow-sm sm:p-6">
      <h2 className="text-center font-display text-2xl font-semibold text-[var(--bb-maroon)] sm:text-3xl">{title || "Order now · এখনই অর্ডার করুন"}</h2>
      <div className="mt-5 flex gap-4">
        <Img src={variant?.imageUrl ?? product.imageUrl} alt={product.name} className="h-28 w-24 shrink-0 rounded-lg" />
        <div className="min-w-0">
          <p className="font-medium">{product.name}</p>
          <Price className="mt-1" price={variant?.price ?? product.price} compareAt={product.compareAtPrice} />
          <div className="mt-2">
            <StockNote variant={variant} />
          </div>
        </div>
      </div>
      <div className="mt-4 space-y-4">
        <VariantOptions picker={picker} />
        <QtyStepper value={qty} onChange={(n) => setQty(Math.max(1, Math.min(MAX_QTY, n)))} label="Quantity" />
      </div>
      <div className="mt-6">
        <CheckoutForm lines={lines} source="landing" initiateOnMount={false} compact submitLabel={lines.length ? undefined : "Sold out"} />
      </div>
    </div>
  );
}
