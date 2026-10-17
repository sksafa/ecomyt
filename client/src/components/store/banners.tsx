import Link from "next/link";
import { cn } from "@/lib/utils";
import type { Banner } from "./types";

/** Responsive image: mobile art direction below 640px when a mobile image is provided. */
export function ArtImage({ src, mobileSrc, alt, eager, className }: { src: string; mobileSrc?: string | null; alt: string; eager?: boolean; className?: string }) {
  return (
    <picture>
      {mobileSrc && <source media="(max-width: 639px)" srcSet={mobileSrc} />}
      <img src={src} alt={alt} loading={eager ? "eager" : "lazy"} fetchPriority={eager ? "high" : undefined} decoding="async" className={cn("size-full object-cover", className)} />
    </picture>
  );
}

function BannerSlide({ b, eager, tall }: { b: Banner; eager?: boolean; tall?: boolean }) {
  const inner = (
    <div className={cn("relative overflow-hidden rounded-none bg-secondary sm:rounded-xl", tall ? "aspect-[4/5] sm:aspect-[21/9]" : "aspect-[16/9] sm:aspect-[21/7]")}>
      <ArtImage src={b.imageUrl} mobileSrc={b.mobileImageUrl} alt={b.title ?? ""} eager={eager} className="absolute inset-0" />
      {(b.title || b.subtitle || b.ctaLabel) && (
        <div className="absolute inset-0 flex items-end bg-gradient-to-t from-black/55 via-black/10 to-transparent p-5 sm:items-center sm:bg-gradient-to-r sm:p-12">
          <div className="max-w-md text-white">
            {b.title && <h2 className="font-display text-3xl font-semibold leading-tight sm:text-5xl">{b.title}</h2>}
            {b.subtitle && <p className="mt-2 text-sm text-white/90 sm:text-base">{b.subtitle}</p>}
            {b.ctaLabel && b.linkUrl && <span className="mt-4 inline-flex h-11 items-center rounded-md bg-white px-6 text-sm font-medium text-[var(--bb-maroon)]">{b.ctaLabel}</span>}
          </div>
        </div>
      )}
    </div>
  );
  return b.linkUrl ? (
    <Link href={b.linkUrl} className="block w-full shrink-0 snap-center" aria-label={b.title ?? "View offer"}>
      {inner}
    </Link>
  ) : (
    <div className="w-full shrink-0 snap-center">{inner}</div>
  );
}

/** Hero banners: a swipeable scroll-snap row (no JS needed). */
export function HeroBanners({ banners }: { banners: Banner[] }) {
  if (!banners.length) return null;
  return (
    <div className="mx-auto max-w-6xl sm:px-6 sm:pt-6">
      <div className="bb-scroll-x flex snap-x snap-mandatory gap-3 overflow-x-auto" aria-roledescription="carousel">
        {banners.map((b, i) => (
          <BannerSlide key={b.id} b={b} eager={i === 0} tall />
        ))}
      </div>
      {banners.length > 1 && <p className="mt-2 text-center text-xs text-muted-foreground sm:hidden">Swipe for more →</p>}
    </div>
  );
}

export function InlineBanners({ banners }: { banners: Banner[] }) {
  if (!banners.length) return null;
  return (
    <div className="space-y-3">
      {banners.map((b) => (
        <BannerSlide key={b.id} b={b} />
      ))}
    </div>
  );
}
