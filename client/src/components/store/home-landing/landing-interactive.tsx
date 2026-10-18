"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, ShieldCheck, ShoppingBag } from "lucide-react";
import { bdt } from "@/lib/format";
import { cn } from "@/lib/utils";
import { MAX_QTY } from "../cart";
import { QtyStepper } from "../cart-drawer";
import { CheckoutForm } from "../checkout-form";
import { StockNote, useVariantPicker, VariantOptions } from "../product-detail";
import { trackWithServer } from "../tracking";
import type { PublicProductDetail } from "../types";
import { Img } from "../ui";

export const ORDER_ANCHOR = "order";

/** Smooth-scroll to the order form (plain #order link without JS). */
export function OrderButton({ className, children = "অর্ডার করুন" }: { className?: string; children?: React.ReactNode }) {
  return (
    <a
      href={`#${ORDER_ANCHOR}`}
      className={cn("lp-cta", className)}
      onClick={(e) => {
        const el = document.getElementById(ORDER_ANCHOR);
        if (!el) return;
        e.preventDefault();
        const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
        history.replaceState(null, "", `#${ORDER_ANCHOR}`);
      }}
    >
      <ShoppingBag className="size-5" aria-hidden />
      {children}
    </a>
  );
}

export interface Slide {
  url: string;
  alt: string;
  title?: string;
  text?: string;
}

/** Hero gallery: swipe on phones, arrows on larger screens. No autoplay. */
export function HeroGallery({ slides }: { slides: Slide[] }) {
  const [idx, setIdx] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);
  const go = (i: number) => {
    const el = scroller.current;
    if (!el) return;
    const n = (i + slides.length) % slides.length;
    el.scrollTo({ left: n * el.clientWidth, behavior: "smooth" });
  };
  if (!slides.length) return <div className="aspect-[4/5] w-full rounded-2xl bg-[var(--lp-cream)]" />;
  return (
    <div className="relative">
      <div
        ref={scroller}
        className="bb-scroll-x flex snap-x snap-mandatory overflow-x-auto rounded-2xl bg-[var(--lp-cream)] shadow-[0_30px_60px_-30px_rgb(69_19_29/0.45)]"
        onScroll={(e) => {
          const el = e.currentTarget;
          const i = Math.round(el.scrollLeft / el.clientWidth);
          if (i !== idx) setIdx(i);
        }}
        aria-roledescription="carousel"
        aria-label="Product photos"
      >
        {slides.map((s, i) => (
          <figure key={s.url + i} className="relative aspect-[4/5] w-full shrink-0 snap-center" aria-roledescription="slide" aria-label={`${i + 1} / ${slides.length}`}>
            <Img src={s.url} alt={s.alt} eager={i === 0} className="absolute inset-0 size-full bg-[var(--lp-cream)]" />
            {(s.title || s.text) && (
              <figcaption className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 via-black/25 to-transparent px-5 pb-9 pt-16 text-white sm:px-7">
                {s.title && <p className="lp-serif text-2xl leading-tight sm:text-3xl">{s.title}</p>}
                {s.text && <p className="mt-1 text-sm text-white/90">{s.text}</p>}
              </figcaption>
            )}
          </figure>
        ))}
      </div>
      {slides.length > 1 && (
        <>
          <button type="button" onClick={() => go(idx - 1)} aria-label="Previous photo" className="absolute left-3 top-1/2 hidden size-10 -translate-y-1/2 place-items-center rounded-full bg-white/80 text-[var(--lp-maroon)] shadow sm:grid">
            <ChevronLeft className="size-5" />
          </button>
          <button type="button" onClick={() => go(idx + 1)} aria-label="Next photo" className="absolute right-3 top-1/2 hidden size-10 -translate-y-1/2 place-items-center rounded-full bg-white/80 text-[var(--lp-maroon)] shadow sm:grid">
            <ChevronRight className="size-5" />
          </button>
          <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center gap-1.5" aria-hidden>
            {slides.map((s, i) => (
              <span key={s.url + i} className={cn("h-1.5 rounded-full transition-all", i === idx ? "w-6 bg-white" : "w-1.5 bg-white/60")} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** ViewContent once per page view (browser pixel + server Conversions API share one event id). */
export function LandingViewContent({ product }: { product: PublicProductDetail }) {
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    const v = product.variants.find((x) => x.inStock) ?? product.variants[0];
    if (v) trackWithServer("ViewContent", [{ sku: v.sku, quantity: 1, price: v.price ?? product.price, variantId: v.id }], { content_name: product.name });
  }, [product]);
  return null;
}

/**
 * Order card: choose colour / size / quantity, then the standard checkout form (name, mobile, address,
 * Inside / Outside Dhaka). Places a real order through /storefront/checkout – the server prices everything.
 */
export function LandingOrder({ product }: { product: PublicProductDetail }) {
  const picker = useVariantPicker(product);
  const { variant } = picker;
  const [qty, setQty] = useState(1);
  const lines =
    variant && variant.inStock
      ? [{ variantId: variant.id, sku: variant.sku, name: product.name, variantName: variant.name, price: variant.price, quantity: qty, imageUrl: variant.imageUrl ?? product.imageUrl, weightGrams: product.weightGrams }]
      : [];
  const price = variant?.price ?? product.price;
  const compareAt = product.compareAtPrice && Number(product.compareAtPrice) > Number(price) ? product.compareAtPrice : null;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-10">
      <div className="space-y-5">
        <div className="flex gap-4 rounded-2xl border border-[var(--lp-sand)] bg-white p-4 sm:p-5">
          <Img src={variant?.imageUrl ?? product.imageUrl} alt={product.name} className="h-32 w-24 shrink-0 rounded-xl sm:h-36 sm:w-28" />
          <div className="min-w-0 flex-1">
            <p className="lp-serif text-lg leading-snug text-[var(--lp-maroon-deep)] sm:text-xl">{product.name}</p>
            {variant && (variant.color || variant.size) && <p className="mt-0.5 text-sm text-[var(--lp-muted)]">{[variant.color, variant.size].filter(Boolean).join(" · ")}</p>}
            <p className="mt-2 flex flex-wrap items-baseline gap-x-2">
              <span className="text-xl font-semibold text-[var(--lp-maroon)]">{bdt(price)}</span>
              {compareAt && <span className="text-sm text-[var(--lp-muted)] line-through">{bdt(compareAt)}</span>}
            </p>
            <div className="mt-1.5">
              <StockNote variant={variant} />
            </div>
            <div className="mt-3 flex items-center gap-3">
              <span className="text-sm text-[var(--lp-muted)]">পরিমাণ</span>
              <QtyStepper value={qty} onChange={(n) => setQty(Math.max(1, Math.min(MAX_QTY, n)))} label="পরিমাণ · Quantity" />
            </div>
          </div>
        </div>
        {(picker.colors.length > 1 || picker.sizes.length > 1) && (
          <div className="rounded-2xl border border-[var(--lp-sand)] bg-white p-4 sm:p-5">
            <VariantOptions picker={picker} />
          </div>
        )}
        <ul className="hidden space-y-2.5 rounded-2xl bg-[var(--lp-cream)] p-5 text-sm text-[var(--lp-ink)] lg:block">
          {["পণ্য হাতে পেয়ে দেখে তারপর পেমেন্ট", "অগ্রিম টাকা লাগবে না — ক্যাশ অন ডেলিভারি", "অর্ডার নিশ্চিত করতে আমরা আপনাকে কল করব"].map((t) => (
            <li key={t} className="flex items-center gap-2.5">
              <ShieldCheck className="size-4 shrink-0 text-[var(--lp-gold)]" aria-hidden /> {t}
            </li>
          ))}
        </ul>
      </div>
      <div className="rounded-2xl border border-[var(--lp-sand)] bg-white p-4 shadow-[0_24px_50px_-30px_rgb(69_19_29/0.35)] sm:p-6">
        <p className="lp-serif mb-4 text-xl text-[var(--lp-maroon-deep)]">ডেলিভারি তথ্য দিন</p>
        <CheckoutForm lines={lines} source="landing" initiateOnMount={false} compact submitLabel={lines.length ? undefined : "স্টক শেষ · Sold out"} />
      </div>
    </div>
  );
}

/**
 * Phone-only bottom bar with the price and an order button. Appears once the hero buttons are scrolled
 * away and hides again when the order form is on screen (it never covers the form).
 */
export function StickyOrderBar({ price, compareAt }: { price: string; compareAt: string | null }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const hero = document.getElementById("lp-hero-cta");
      const order = document.getElementById(ORDER_ANCHOR);
      const pastHero = hero ? hero.getBoundingClientRect().bottom < 0 : window.scrollY > 600;
      const atOrder = order ? order.getBoundingClientRect().top < window.innerHeight * 0.9 : false;
      setShow(pastHero && !atOrder);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);
  return (
    <div
      className={cn(
        "pb-safe fixed inset-x-0 bottom-0 z-30 border-t border-[var(--lp-sand)] bg-white/95 px-4 pt-3 backdrop-blur transition-transform duration-200 md:hidden",
        show ? "translate-y-0" : "pointer-events-none translate-y-full",
      )}
      inert={!show}
    >
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1 leading-tight">
          <p className="text-lg font-semibold text-[var(--lp-maroon)]">{bdt(price)}</p>
          {compareAt && <p className="text-xs text-[var(--lp-muted)] line-through">{bdt(compareAt)}</p>}
        </div>
        <OrderButton className="min-h-12 px-6 text-base">অর্ডার করুন</OrderButton>
      </div>
    </div>
  );
}
