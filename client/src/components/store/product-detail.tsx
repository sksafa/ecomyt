"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ShoppingBag, Truck, Wallet } from "lucide-react";
import { toast } from "sonner";
import { bdt } from "@/lib/format";
import { cn } from "@/lib/utils";
import { cart, MAX_QTY } from "./cart";
import { QtyStepper } from "./cart-drawer";
import { trackWithServer } from "./tracking";
import type { PublicProductDetail, PublicVariant } from "./types";
import { Img, Price } from "./ui";

const uniq = (xs: (string | null)[]) => [...new Set(xs.filter((x): x is string => !!x))];

/** Variant selection state shared by the product page and the landing-page order form. */
export function useVariantPicker(product: PublicProductDetail) {
  const colors = useMemo(() => uniq(product.variants.map((v) => v.color)), [product.variants]);
  const sizes = useMemo(() => uniq(product.variants.map((v) => v.size)), [product.variants]);
  const firstInStock = product.variants.find((v) => v.inStock) ?? product.variants[0];
  const [color, setColor] = useState<string | null>(firstInStock?.color ?? null);
  const [size, setSize] = useState<string | null>(firstInStock?.size ?? null);

  const match = (c: string | null, s: string | null) => product.variants.find((v) => (!colors.length || v.color === c) && (!sizes.length || v.size === s));
  const variant: PublicVariant | undefined = product.variants.length === 1 ? product.variants[0] : match(color, size);

  const pickColor = (c: string) => {
    setColor(c);
    // keep the size if that combination exists, otherwise jump to an in-stock size of this colour
    if (!match(c, size)?.inStock) {
      const alt = product.variants.find((v) => v.color === c && v.inStock) ?? product.variants.find((v) => v.color === c);
      if (alt) setSize(alt.size);
    }
  };
  const colorInStock = (c: string) => product.variants.some((v) => v.color === c && v.inStock);
  const sizeState = (s: string) => {
    const v = match(color, s);
    return v ? (v.inStock ? "in" : "out") : "none";
  };
  return { colors, sizes, color, size, setSize, pickColor, colorInStock, sizeState, variant };
}

export function VariantOptions({ picker }: { picker: ReturnType<typeof useVariantPicker> }) {
  const { colors, sizes, color, size, setSize, pickColor, colorInStock, sizeState } = picker;
  return (
    <div className="space-y-4">
      {colors.length > 1 && (
        <fieldset>
          <legend className="mb-2 text-sm">
            Colour · <span className="font-bengali">রং</span>: <span className="font-medium">{color}</span>
          </legend>
          <div className="flex flex-wrap gap-2">
            {colors.map((c) => {
              const inStock = colorInStock(c);
              return (
                <button
                  key={c}
                  type="button"
                  aria-pressed={c === color}
                  onClick={() => pickColor(c)}
                  className={cn(
                    "relative min-h-11 rounded-md border px-4 text-sm transition-colors",
                    c === color ? "border-primary bg-primary/5 font-medium text-primary ring-1 ring-primary" : "border-input bg-card hover:border-primary",
                    !inStock && "text-muted-foreground line-through decoration-1",
                  )}
                >
                  {c}
                  {!inStock && <span className="sr-only"> (sold out)</span>}
                </button>
              );
            })}
          </div>
        </fieldset>
      )}
      {sizes.length > 1 && (
        <fieldset>
          <legend className="mb-2 text-sm">
            Size · <span className="font-bengali">সাইজ</span>: <span className="font-medium">{size}</span>
          </legend>
          <div className="flex flex-wrap gap-2">
            {sizes.map((s) => {
              const st = sizeState(s);
              return (
                <button
                  key={s}
                  type="button"
                  aria-pressed={s === size}
                  disabled={st === "none"}
                  onClick={() => setSize(s)}
                  className={cn(
                    "min-h-11 rounded-md border px-4 text-sm",
                    s === size ? "border-primary bg-primary/5 font-medium text-primary ring-1 ring-primary" : "border-input bg-card hover:border-primary",
                    st === "out" && "text-muted-foreground line-through",
                    st === "none" && "cursor-not-allowed opacity-40",
                  )}
                >
                  {s}
                </button>
              );
            })}
          </div>
        </fieldset>
      )}
      {colors.length <= 1 && sizes.length <= 1 && (colors[0] || sizes[0]) && (
        <p className="text-sm text-muted-foreground">{[colors[0], sizes[0]].filter(Boolean).join(" · ")}</p>
      )}
    </div>
  );
}

export function StockNote({ variant }: { variant?: PublicVariant }) {
  if (!variant) return <p className="text-sm text-muted-foreground">This combination is not available.</p>;
  if (!variant.inStock) return <p className="text-sm font-medium text-destructive">Sold out · স্টক শেষ</p>;
  if (variant.lowStock) return <p className="text-sm font-medium text-amber-700">Only a few left · অল্প কিছু বাকি</p>;
  return (
    <p className="flex items-center gap-1.5 text-sm text-emerald-700">
      <Check className="size-4" aria-hidden /> In stock · স্টকে আছে
    </p>
  );
}

function Gallery({ images, name, activeUrl }: { images: { url: string; alt: string | null }[]; name: string; activeUrl?: string | null }) {
  const [idx, setIdx] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);
  const go = (i: number, smooth = true) => {
    setIdx(i);
    const el = scroller.current;
    if (el) el.scrollTo({ left: i * el.clientWidth, behavior: smooth ? "smooth" : "auto" });
  };
  // jump to the selected variant's image
  useEffect(() => {
    if (!activeUrl) return;
    const i = images.findIndex((im) => im.url === activeUrl);
    const el = scroller.current;
    if (i >= 0 && el) el.scrollTo({ left: i * el.clientWidth, behavior: "smooth" });
  }, [activeUrl, images]);

  if (!images.length) return <div className="aspect-[4/5] rounded-xl bg-secondary" />;
  return (
    <div className="md:sticky md:top-24">
      <div
        ref={scroller}
        className="bb-scroll-x -mx-4 flex snap-x snap-mandatory overflow-x-auto sm:mx-0 sm:rounded-xl"
        onScroll={(e) => {
          const el = e.currentTarget;
          const i = Math.round(el.scrollLeft / el.clientWidth);
          if (i !== idx) setIdx(i);
        }}
      >
        {images.map((im, i) => (
          <Img key={im.url + i} src={im.url} alt={im.alt ?? name} eager={i === 0} className="aspect-[4/5] w-full shrink-0 snap-center" />
        ))}
      </div>
      {images.length > 1 && (
        <>
          <div className="mt-3 flex justify-center gap-1.5 sm:hidden" aria-hidden>
            {images.map((im, i) => (
              <span key={im.url + i} className={cn("h-1.5 rounded-full transition-all", i === idx ? "w-5 bg-primary" : "w-1.5 bg-primary/25")} />
            ))}
          </div>
          <div className="mt-3 hidden gap-2 sm:flex">
            {images.map((im, i) => (
              <button key={im.url + i} type="button" onClick={() => go(i)} aria-label={`Show image ${i + 1}`} className={cn("overflow-hidden rounded-md border-2", i === idx ? "border-primary" : "border-transparent")}>
                <Img src={im.url} alt="" className="h-24 w-20" />
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export function ProductDetail({ product }: { product: PublicProductDetail }) {
  const router = useRouter();
  const picker = useVariantPicker(product);
  const { variant } = picker;
  const [qty, setQty] = useState(1);

  // ViewContent once per product view (the ref also absorbs React StrictMode's double effect in development)
  const viewed = useRef<string | null>(null);
  useEffect(() => {
    if (viewed.current === product.id) return;
    viewed.current = product.id;
    const v = product.variants.find((x) => x.inStock) ?? product.variants[0];
    if (v) trackWithServer("ViewContent", [{ sku: v.sku, quantity: 1, price: v.price ?? product.price, variantId: v.id }], { content_name: product.name });
  }, [product]);

  const canBuy = !!variant?.inStock;
  const line = () =>
    variant && {
      variantId: variant.id,
      sku: variant.sku,
      productId: product.id,
      slug: product.slug,
      name: product.name,
      variantName: variant.name,
      price: variant.price,
      imageUrl: variant.imageUrl ?? product.imageUrl,
      weightGrams: product.weightGrams,
    };

  const addToCart = () => {
    const l = line();
    if (!l || !canBuy) return;
    if (!cart.add(l, qty, { openDrawer: true })) toast.error("Your bag is full (20 items). Please check out first.");
  };
  const buyNow = () => {
    const l = line();
    if (!l || !canBuy) return;
    cart.add(l, qty);
    router.push("/checkout");
  };

  const details = [
    ["Fabric · কাপড়", product.fabric],
    ["Design", product.design],
    ["Embroidery · কাজ", product.embroidery],
    ["Care · যত্ন", product.careInstructions],
    ["Delivery", product.shippingNote],
  ].filter((d): d is [string, string] => !!d[1]);

  return (
    <div className="grid gap-6 pb-24 md:grid-cols-2 md:gap-10 md:pb-0">
      <Gallery images={product.images} name={product.name} activeUrl={variant?.imageUrl} />
      <div>
        {product.category && <p className="text-xs font-medium uppercase tracking-[0.2em] text-[var(--bb-gold)]">{product.category.name}</p>}
        <h1 className="mt-1 font-display text-3xl font-semibold leading-tight sm:text-4xl">{product.name}</h1>
        <Price className="mt-3" price={variant?.price ?? product.price} compareAt={product.compareAtPrice} size="lg" />
        {product.shortDescription && <p className="mt-4 text-sm leading-relaxed text-foreground/80">{product.shortDescription}</p>}

        <div className="mt-6">
          <VariantOptions picker={picker} />
        </div>
        <div className="mt-4">
          <StockNote variant={variant} />
        </div>

        <div className="mt-5 flex items-center gap-3">
          <QtyStepper value={qty} onChange={(n) => setQty(Math.max(1, Math.min(MAX_QTY, n)))} label="Quantity" />
          <span className="text-xs text-muted-foreground">Max {MAX_QTY} per order line</span>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3">
          <button type="button" onClick={addToCart} disabled={!canBuy} className="flex h-12 items-center justify-center gap-2 rounded-md border border-primary text-sm font-medium text-primary hover:bg-primary/5 disabled:opacity-40">
            <ShoppingBag className="size-4" aria-hidden /> Add to bag
          </button>
          <button type="button" onClick={buyNow} disabled={!canBuy} className="h-12 rounded-md bg-primary text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40">
            Buy now · <span className="font-bengali">এখনই কিনুন</span>
          </button>
        </div>

        <ul className="mt-6 space-y-2 rounded-lg border border-border bg-card p-4 text-sm">
          <li className="flex items-center gap-2">
            <Wallet className="size-4 text-primary" aria-hidden /> Cash on delivery · <span className="font-bengali">ক্যাশ অন ডেলিভারি</span>
          </li>
          <li className="flex items-center gap-2">
            <Truck className="size-4 text-primary" aria-hidden /> {product.freeShipping ? "Free delivery all over Bangladesh" : "Delivery all over Bangladesh"}
          </li>
        </ul>

        {(product.description || details.length > 0) && (
          <div className="mt-8 space-y-6">
            {product.description && (
              <div>
                <h2 className="font-display text-xl font-semibold">Description</h2>
                <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-foreground/85">{product.description}</p>
              </div>
            )}
            {details.length > 0 && (
              <dl className="divide-y divide-border rounded-lg border border-border bg-card text-sm">
                {details.map(([k, v]) => (
                  <div key={k} className="grid grid-cols-[8.5rem_1fr] gap-3 px-4 py-3">
                    <dt className="text-muted-foreground">{k}</dt>
                    <dd className="whitespace-pre-line">{v}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        )}
      </div>

      {/* mobile sticky buy bar – thumb-reachable, safe-area aware */}
      <div className="pb-safe fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card/95 px-4 pt-3 backdrop-blur md:hidden">
        <div className="flex items-center gap-3">
          <div className="min-w-0">
            <p className="truncate text-xs text-muted-foreground">{variant?.name ?? product.name}</p>
            <p className="font-semibold text-primary">{bdt(Number(variant?.price ?? product.price) * qty)}</p>
          </div>
          <button type="button" onClick={addToCart} disabled={!canBuy} aria-label="Add to bag" className="ml-auto grid size-12 shrink-0 place-items-center rounded-md border border-primary text-primary disabled:opacity-40">
            <ShoppingBag className="size-5" />
          </button>
          <button type="button" onClick={buyNow} disabled={!canBuy} className="h-12 shrink-0 rounded-md bg-primary px-5 text-sm font-medium text-primary-foreground disabled:opacity-40">
            {canBuy ? "Buy now" : "Sold out"}
          </button>
        </div>
      </div>
    </div>
  );
}
