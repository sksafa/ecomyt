import Link from "next/link";
import { Mail, MapPin, MessageCircle, Phone } from "lucide-react";
import { telHref, whatsappHref } from "@/lib/format";
import type { AnnouncementBar, FooterInfo, StoreInfo } from "./types";

export function Announcement({ bar }: { bar: AnnouncementBar | null }) {
  if (!bar || (!bar.text && !bar.textBn)) return null;
  const content = (
    <span className="flex flex-wrap items-center justify-center gap-x-2">
      {bar.text && <span>{bar.text}</span>}
      {bar.text && bar.textBn && <span aria-hidden className="opacity-60">·</span>}
      {bar.textBn && <span className="font-bengali">{bar.textBn}</span>}
    </span>
  );
  return (
    <div className="bg-[var(--bb-maroon)] px-4 py-2 text-center text-xs font-medium tracking-wide text-[#fbf1e6] sm:text-sm">
      {bar.link ? (
        <Link href={bar.link} className="underline-offset-4 hover:underline">
          {content}
        </Link>
      ) : (
        content
      )}
    </div>
  );
}

export function StoreFooter({ store, footer }: { store: StoreInfo; footer: FooterInfo | null }) {
  const year = new Date().getFullYear();
  const social = [
    footer?.facebookUrl && { href: footer.facebookUrl, label: "Facebook" },
    footer?.instagramUrl && { href: footer.instagramUrl, label: "Instagram" },
  ].filter(Boolean) as { href: string; label: string }[];
  return (
    <footer className="mt-16 border-t border-border bg-[var(--bb-cream)]">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:px-6 md:grid-cols-[1.4fr_1fr_1fr]">
        <div>
          <p className="font-display text-3xl font-semibold text-[var(--bb-maroon)]">{store.name}</p>
          <p className="mt-1 text-sm text-muted-foreground">{store.tagline || "Premium embroidered orna"}</p>
          <p className="mt-4 max-w-sm text-sm leading-relaxed text-foreground/80">
            {footer?.about || "Hand-finished embroidered orna (dupatta), made in Bangladesh and delivered to your door with cash on delivery."}
          </p>
          {social.length > 0 && (
            <div className="mt-5 flex gap-2">
              {social.map((s) => (
                <a key={s.label} href={s.href} target="_blank" rel="noopener noreferrer" className="inline-flex h-10 items-center rounded-full border border-[var(--bb-maroon)]/30 px-4 text-sm text-[var(--bb-maroon)] hover:bg-[var(--bb-maroon)] hover:text-white">
                  {s.label}
                </a>
              ))}
            </div>
          )}
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">Shop</p>
          <ul className="mt-3 space-y-1 text-sm">
            {[
              ["/shop", "All orna"],
              ["/cart", "Your bag"],
              ["/order-status", "Track your order · অর্ডার ট্র্যাক"],
              ["/faq", "FAQ"],
            ].map(([href, label]) => (
              <li key={href}>
                <Link href={href} className="inline-flex min-h-9 items-center hover:text-primary">
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">Contact</p>
          <ul className="mt-3 space-y-2 text-sm">
            {store.phone && (
              <li>
                <a href={telHref(store.phone)} className="inline-flex min-h-9 items-center gap-2 hover:text-primary">
                  <Phone className="size-4" aria-hidden /> {store.phone}
                </a>
              </li>
            )}
            {footer?.whatsapp && (
              <li>
                <a href={whatsappHref(footer.whatsapp)} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-9 items-center gap-2 hover:text-primary">
                  <MessageCircle className="size-4" aria-hidden /> WhatsApp
                </a>
              </li>
            )}
            {store.email && (
              <li>
                <a href={`mailto:${store.email}`} className="inline-flex min-h-9 items-center gap-2 hover:text-primary">
                  <Mail className="size-4" aria-hidden /> {store.email}
                </a>
              </li>
            )}
            {store.address && (
              <li className="flex gap-2 text-foreground/80">
                <MapPin className="mt-0.5 size-4 shrink-0" aria-hidden /> {store.address}
              </li>
            )}
            <li className="pt-1 font-bengali text-foreground/80">ক্যাশ অন ডেলিভারি · সারা বাংলাদেশে ডেলিভারি</li>
          </ul>
        </div>
      </div>
      <div className="border-t border-border/80 px-4 py-4 text-center text-xs text-muted-foreground">
        © {year} {store.name}. Made with care in Bangladesh.
      </div>
    </footer>
  );
}
