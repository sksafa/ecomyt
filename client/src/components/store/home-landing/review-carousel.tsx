"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Expand, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Testimonial } from "../types";
import { Img, Stars } from "../ui";

/**
 * Customer reviews slider for the landing page: screenshots of customers' messages and written reviews,
 * exactly as entered in Content → Testimonials. One card per view on phones (with the next one peeking),
 * three on desktop. Screenshots open full size on tap. No autoplay.
 */
export function ReviewCarousel({ reviews }: { reviews: Testimonial[] }) {
  const scroller = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState(0);
  const [pages, setPages] = useState(reviews.length);
  const [open, setOpen] = useState<Testimonial | null>(null);

  // pages = how many snap positions exist at the current width (1 per card on phones, fewer on desktop)
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const measure = () => {
      const card = el.firstElementChild as HTMLElement | null;
      if (!card) return;
      const perView = Math.max(1, Math.round(el.clientWidth / card.offsetWidth));
      setPages(Math.max(1, reviews.length - perView + 1));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [reviews.length]);

  const go = (i: number) => {
    const el = scroller.current;
    const first = el?.firstElementChild as HTMLElement | null;
    const card = el?.children[Math.max(0, Math.min(pages - 1, i))] as HTMLElement | undefined;
    if (el && first && card) el.scrollTo({ left: card.offsetLeft - first.offsetLeft, behavior: "smooth" });
  };

  return (
    <div>
      <div
        ref={scroller}
        // centred when every review fits on screen (justify-center would clip an overflowing row)
        className={cn("bb-scroll-x -mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto scroll-px-4 px-4 pb-4 sm:mx-0 sm:scroll-px-0 sm:px-0", pages === 1 && "justify-center")}
        onScroll={(e) => {
          const el = e.currentTarget;
          const card = el.firstElementChild as HTMLElement | null;
          if (!card) return;
          const i = Math.round(el.scrollLeft / (card.offsetWidth + 16));
          if (i !== page) setPage(Math.min(pages - 1, i));
        }}
        aria-roledescription="carousel"
        aria-label="Customer reviews"
      >
        {reviews.map((t, i) => (
          <figure
            key={t.id}
            className="flex w-[82%] shrink-0 snap-start flex-col overflow-hidden rounded-2xl border border-[var(--lp-sand)] bg-white shadow-[0_24px_50px_-34px_rgb(69_19_29/0.45)] sm:w-[calc((100%-1rem)/2)] lg:w-[calc((100%-2rem)/3)]"
            aria-roledescription="slide"
            aria-label={`Review ${i + 1} of ${reviews.length}`}
          >
            {t.reviewImageUrl && (
              <button type="button" onClick={() => setOpen(t)} className="group relative block bg-[var(--lp-cream)]" aria-label={`Open review ${i + 1} full size`}>
                <Img src={t.reviewImageUrl} alt={t.quote ? `Review from ${t.name || "a customer"}` : `Customer review ${i + 1}`} className="aspect-[2/3] w-full bg-[var(--lp-cream)] object-contain" />
                <span className="absolute bottom-3 right-3 grid size-9 place-items-center rounded-full bg-white/90 text-[var(--lp-maroon)] shadow-sm" aria-hidden>
                  <Expand className="size-4" />
                </span>
              </button>
            )}
            {(t.quote || t.rating || t.name) && (
              <div className={cn("flex flex-1 flex-col p-5 sm:p-6", t.reviewImageUrl && "border-t border-[var(--lp-sand)]")}>
                {t.rating ? <Stars rating={t.rating} /> : null}
                {t.quote && <blockquote className="mt-2 flex-1 text-[0.98rem] leading-relaxed text-[var(--lp-ink)]">“{t.quote}”</blockquote>}
                {(t.name || t.location) && (
                  <figcaption className="mt-4 flex items-center gap-3">
                    {t.imageUrl ? (
                      <Img src={t.imageUrl} alt="" className="size-10 rounded-full" />
                    ) : t.name ? (
                      <span className="lp-serif grid size-10 place-items-center rounded-full bg-[var(--lp-cream)] text-[var(--lp-maroon)]">{t.name.slice(0, 1)}</span>
                    ) : null}
                    <span>
                      {t.name && <span className="block text-sm font-semibold">{t.name}</span>}
                      {t.location && <span className="block text-xs text-[var(--lp-muted)]">{t.location}</span>}
                    </span>
                  </figcaption>
                )}
              </div>
            )}
          </figure>
        ))}
      </div>

      {pages > 1 && (
        <div className="mt-4 flex items-center justify-center gap-4">
          <button type="button" onClick={() => go(page - 1)} disabled={page === 0} aria-label="Previous review" className="grid size-10 place-items-center rounded-full border border-[var(--lp-sand)] bg-white text-[var(--lp-maroon)] disabled:opacity-40">
            <ChevronLeft className="size-5" />
          </button>
          <div className="flex gap-1.5" aria-hidden>
            {Array.from({ length: pages }, (_, i) => (
              <span key={i} className={cn("h-1.5 rounded-full transition-all", i === page ? "w-6 bg-[var(--lp-maroon)]" : "w-1.5 bg-[var(--lp-maroon)]/25")} />
            ))}
          </div>
          <button type="button" onClick={() => go(page + 1)} disabled={page >= pages - 1} aria-label="Next review" className="grid size-10 place-items-center rounded-full border border-[var(--lp-sand)] bg-white text-[var(--lp-maroon)] disabled:opacity-40">
            <ChevronRight className="size-5" />
          </button>
        </div>
      )}

      {open?.reviewImageUrl && <Lightbox src={open.reviewImageUrl} alt="Customer review" onClose={() => setOpen(null)} />}
    </div>
  );
}

function Lightbox({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  const closeBtn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    closeBtn.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      prev?.focus();
    };
  }, [onClose]);
  return (
    <div role="dialog" aria-modal="true" aria-label={alt} className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4" onClick={onClose}>
      <button ref={closeBtn} type="button" onClick={onClose} aria-label="Close" className="absolute right-3 top-3 grid size-11 place-items-center rounded-full bg-white/15 text-white hover:bg-white/25">
        <X className="size-6" />
      </button>
      <img src={src} alt={alt} className="max-h-full max-w-full rounded-lg object-contain" onClick={(e) => e.stopPropagation()} />
    </div>
  );
}
