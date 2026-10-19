import Link from "next/link";
import { BadgeCheck, RefreshCcw, Star, Truck, Wallet } from "lucide-react";
import { bdt } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Faq, PublicProduct, Testimonial } from "./types";

/** Plain <img> (images are unoptimised in this app); lazy by default, with a cream placeholder background. */
export function Img({ src, alt, className, eager, sizes }: { src: string | null | undefined; alt: string; className?: string; eager?: boolean; sizes?: string }) {
  if (!src) return <div aria-hidden className={cn("bg-secondary", className)} />;
  return <img src={src} alt={alt} sizes={sizes} loading={eager ? "eager" : "lazy"} decoding="async" className={cn("bg-secondary object-cover", className)} />;
}

export function Price({ price, compareAt, className, size = "md" }: { price: string; compareAt?: string | null; className?: string; size?: "sm" | "md" | "lg" }) {
  const off = compareAt && Number(compareAt) > Number(price) ? Math.round((1 - Number(price) / Number(compareAt)) * 100) : 0;
  return (
    <div className={cn("flex flex-wrap items-baseline gap-x-2 gap-y-0.5", className)}>
      <span className={cn("font-semibold text-primary", size === "lg" ? "text-2xl" : size === "sm" ? "text-sm" : "text-base")}>{bdt(price)}</span>
      {off > 0 && (
        <>
          <span className={cn("text-muted-foreground line-through", size === "lg" ? "text-base" : "text-xs")}>{bdt(compareAt)}</span>
          <span className={cn("rounded-full bg-primary/10 px-1.5 py-0.5 font-medium text-primary", size === "lg" ? "text-xs" : "text-[10px]")}>-{off}%</span>
        </>
      )}
    </div>
  );
}

export function ProductCard({ product, priority }: { product: PublicProduct; priority?: boolean }) {
  const second = product.images[1]?.url;
  return (
    <Link href={`/products/${product.slug}`} className="group block focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary">
      <div className="relative aspect-[4/5] overflow-hidden rounded-lg bg-secondary">
        <Img src={product.imageUrl} alt={product.images[0]?.alt ?? product.name} eager={priority} className="absolute inset-0 size-full transition-opacity duration-500 group-hover:opacity-0" />
        {second && <Img src={second} alt="" className="absolute inset-0 size-full opacity-0 transition-opacity duration-500 group-hover:opacity-100" />}
        <div className="absolute left-2 top-2 flex flex-col gap-1">
          {product.onSale && <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary-foreground">Sale</span>}
          {!product.inStock && <span className="rounded-full bg-foreground/80 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-background">Sold out</span>}
        </div>
      </div>
      <div className="mt-2.5 space-y-1 px-0.5">
        <h3 className="line-clamp-2 text-sm leading-snug text-foreground group-hover:text-primary">{product.name}</h3>
        <Price price={product.price} compareAt={product.compareAtPrice} size="sm" />
      </div>
    </Link>
  );
}

export function ProductGrid({ products, priorityCount = 0 }: { products: PublicProduct[]; priorityCount?: number }) {
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-6 sm:gap-x-5 md:grid-cols-3 lg:grid-cols-4">
      {products.map((p, i) => (
        <ProductCard key={p.id} product={p} priority={i < priorityCount} />
      ))}
    </div>
  );
}

export function SectionTitle({ title, eyebrow, href, linkLabel = "View all" }: { title: string; eyebrow?: string; href?: string; linkLabel?: string }) {
  return (
    <div className="mb-5 flex items-end justify-between gap-4 sm:mb-7">
      <div>
        {eyebrow && <p className="mb-1 text-xs font-medium uppercase tracking-[0.2em] text-[var(--bb-gold)]">{eyebrow}</p>}
        <h2 className="font-display text-2xl font-semibold text-foreground sm:text-3xl">{title}</h2>
      </div>
      {href && (
        <Link href={href} className="shrink-0 text-sm font-medium text-primary underline-offset-4 hover:underline">
          {linkLabel} →
        </Link>
      )}
    </div>
  );
}

export function Container({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("mx-auto w-full max-w-6xl px-4 sm:px-6", className)}>{children}</div>;
}

export function TrustBadges({ className }: { className?: string }) {
  const items = [
    { icon: Wallet, en: "Cash on delivery", bn: "ক্যাশ অন ডেলিভারি" },
    { icon: Truck, en: "Delivery all over Bangladesh", bn: "সারা বাংলাদেশে ডেলিভারি" },
    { icon: RefreshCcw, en: "Easy exchange", bn: "সহজ এক্সচেঞ্জ" },
    { icon: BadgeCheck, en: "Premium quality", bn: "প্রিমিয়াম কোয়ালিটি" },
  ];
  return (
    <ul className={cn("grid grid-cols-2 gap-3 md:grid-cols-4", className)}>
      {items.map(({ icon: Icon, en, bn }) => (
        <li key={en} className="flex items-center gap-3 rounded-lg border border-border bg-card p-3 sm:p-4">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
            <Icon className="size-5" aria-hidden />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-medium leading-tight">{en}</span>
            <span className="block font-bengali text-xs text-muted-foreground">{bn}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

export function Stars({ rating }: { rating: number }) {
  return (
    <span className="flex gap-0.5 text-[var(--bb-gold)]" aria-label={`${rating} out of 5`}>
      {Array.from({ length: 5 }, (_, i) => (
        <Star key={i} className={cn("size-3.5", i < rating ? "fill-current" : "opacity-30")} aria-hidden />
      ))}
    </span>
  );
}

export function Testimonials({ items, title = "What our customers say" }: { items: Testimonial[]; title?: string | null }) {
  if (!items.length) return null;
  return (
    <div>
      <SectionTitle title={title || "What our customers say"} eyebrow="Reviews" />
      <div className="bb-scroll-x -mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 lg:grid-cols-3">
        {items.map((t) => (
          <figure key={t.id} className="w-[80%] shrink-0 snap-start overflow-hidden rounded-xl border border-border bg-card sm:w-auto">
            {t.reviewImageUrl && (
              <a href={t.reviewImageUrl} target="_blank" rel="noopener noreferrer" className="block bg-secondary">
                <Img src={t.reviewImageUrl} alt={`Customer review${t.name ? ` from ${t.name}` : ""}`} className="aspect-[2/3] w-full object-contain" />
              </a>
            )}
            {(t.rating || t.quote || t.name) && (
              <div className="p-5">
                {t.rating ? <Stars rating={t.rating} /> : null}
                {t.quote && <blockquote className="mt-3 text-sm leading-relaxed text-foreground/90">“{t.quote}”</blockquote>}
                {t.name && (
                  <figcaption className="mt-4 flex items-center gap-3">
                    {t.imageUrl ? <Img src={t.imageUrl} alt="" className="size-9 rounded-full" /> : <span className="grid size-9 place-items-center rounded-full bg-secondary font-display text-primary">{t.name.slice(0, 1)}</span>}
                    <span>
                      <span className="block text-sm font-medium">{t.name}</span>
                      {t.location && <span className="block text-xs text-muted-foreground">{t.location}</span>}
                    </span>
                  </figcaption>
                )}
              </div>
            )}
          </figure>
        ))}
      </div>
    </div>
  );
}

/** Accessible FAQ accordion with native <details> (no JS). Answers are plain text. */
export function FaqList({ faqs }: { faqs: Faq[] }) {
  return (
    <div className="divide-y divide-border rounded-xl border border-border bg-card">
      {faqs.map((f) => (
        <details key={f.id} className="group px-4 sm:px-5">
          <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-4 py-3 text-sm font-medium [&::-webkit-details-marker]:hidden">
            {f.question}
            <span aria-hidden className="text-lg leading-none text-primary transition-transform group-open:rotate-45">+</span>
          </summary>
          <p className="whitespace-pre-line pb-4 text-sm leading-relaxed text-muted-foreground">{f.answer}</p>
        </details>
      ))}
    </div>
  );
}

export function EmptyBlock({ title, text, action }: { title: string; text?: string; action?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-card px-6 py-14 text-center">
      <p className="font-display text-xl text-foreground">{title}</p>
      {text && <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">{text}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
