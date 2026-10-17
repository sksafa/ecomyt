import Link from "next/link";
import { BadgeCheck, Check, Gift, Heart, RefreshCcw, Shield, Sparkles, Star, Truck, Wallet, type LucideIcon } from "lucide-react";
import { ArtImage } from "./banners";
import { Countdown, OrderFormBlock } from "./landing-client";
import type { Section } from "./types";
import { Container, FaqList, ProductGrid, SectionTitle, Testimonials } from "./ui";

const ICONS: Record<string, LucideIcon> = {
  truck: Truck, delivery: Truck, wallet: Wallet, cod: Wallet, cash: Wallet, refresh: RefreshCcw, exchange: RefreshCcw, star: Star, shield: Shield,
  gift: Gift, heart: Heart, sparkles: Sparkles, quality: BadgeCheck, badge: BadgeCheck, check: Check,
};

const SAFE_URL = /^(\/(?!\/)|#|https?:\/\/|mailto:|tel:)/i;

/** Minimal Markdown → React (headings, lists, paragraphs, **bold**, *italic*, [links](url)). No HTML injection. */
function inline(text: string, key: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*|\*([^*]+)\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const k = `${key}-${i++}`;
    if (m[1]) out.push(<strong key={k}>{m[1]}</strong>);
    else if (m[2]) out.push(<em key={k}>{m[2]}</em>);
    else out.push(SAFE_URL.test(m[4]) ? <a key={k} href={m[4]} rel="noopener noreferrer">{m[3]}</a> : m[3]);
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function Markdown({ source }: { source: string }) {
  const blocks = source.replace(/\r/g, "").split(/\n{2,}/);
  return (
    <>
      {blocks.map((b, bi) => {
        const lines = b.split("\n").filter((l) => l.trim());
        if (!lines.length) return null;
        const h = lines[0].match(/^(#{1,3})\s+(.*)$/);
        if (h && lines.length === 1) {
          const Tag = (["h1", "h2", "h3"] as const)[h[1].length - 1];
          return <Tag key={bi}>{inline(h[2], `h${bi}`)}</Tag>;
        }
        if (lines.every((l) => /^\s*[-*]\s+/.test(l))) return <ul key={bi}>{lines.map((l, li) => <li key={li}>{inline(l.replace(/^\s*[-*]\s+/, ""), `${bi}-${li}`)}</li>)}</ul>;
        if (lines.every((l) => /^\s*\d+[.)]\s+/.test(l))) return <ol key={bi}>{lines.map((l, li) => <li key={li}>{inline(l.replace(/^\s*\d+[.)]\s+/, ""), `${bi}-${li}`)}</li>)}</ol>;
        return (
          <p key={bi}>
            {lines.map((l, li) => (
              <span key={li}>
                {li > 0 && <br />}
                {inline(l, `${bi}-${li}`)}
              </span>
            ))}
          </p>
        );
      })}
    </>
  );
}

function SectionBlock({ s, index }: { s: Section; index: number }) {
  switch (s.type) {
    case "hero":
      return (
        <section className="relative overflow-hidden bg-[var(--bb-cream)]">
          {s.imageUrl && <ArtImage src={s.imageUrl} alt="" eager={index === 0} className="absolute inset-0" />}
          <div className={s.imageUrl ? "relative bg-gradient-to-t from-black/60 via-black/25 to-black/10" : "relative"}>
            <Container className="flex min-h-[60vh] flex-col items-center justify-center py-14 text-center sm:min-h-[26rem]">
              <h1 className={`font-display text-4xl font-semibold leading-tight sm:text-6xl ${s.imageUrl ? "text-white" : "text-[var(--bb-maroon)]"}`}>{s.title}</h1>
              {s.subtitle && <p className={`mt-4 max-w-xl text-base ${s.imageUrl ? "text-white/90" : "text-foreground/80"}`}>{s.subtitle}</p>}
              {s.ctaLabel && s.ctaUrl && (
                <Link href={s.ctaUrl} className="mt-6 inline-flex h-12 items-center rounded-md bg-primary px-8 text-base font-medium text-primary-foreground hover:bg-primary/90">
                  {s.ctaLabel}
                </Link>
              )}
            </Container>
          </div>
        </section>
      );
    case "rich_text":
      return (
        <Container className="max-w-3xl">
          {s.html ? (
            // html is sanitised server-side (sanitize-html allow-list) before it reaches the storefront
            <div className="bb-prose" dangerouslySetInnerHTML={{ __html: s.html }} />
          ) : s.markdown ? (
            <div className="bb-prose">
              <Markdown source={s.markdown} />
            </div>
          ) : null}
        </Container>
      );
    case "product_grid":
      if (!s.products?.length) return null;
      return (
        <Container>
          <SectionTitle title={s.title || s.collection?.name || "Shop the collection"} href={s.collection ? `/collections/${s.collection.slug}` : undefined} />
          <ProductGrid products={s.products} />
        </Container>
      );
    case "image_banner": {
      const img = (
        <figure className="overflow-hidden sm:rounded-xl">
          <ArtImage src={s.imageUrl} mobileSrc={s.mobileImageUrl} alt={s.alt ?? s.title ?? ""} eager={index === 0} className="h-auto w-full" />
          {s.title && <figcaption className="sr-only">{s.title}</figcaption>}
        </figure>
      );
      return <Container className="px-0 sm:px-6">{s.linkUrl ? <Link href={s.linkUrl}>{img}</Link> : img}</Container>;
    }
    case "testimonials":
      if (!s.testimonials?.length) return null;
      return (
        <Container>
          <Testimonials items={s.testimonials} title={s.title} />
        </Container>
      );
    case "faq":
      if (!s.faqs?.length) return null;
      return (
        <Container className="max-w-3xl">
          <SectionTitle title={s.title || "Frequently asked questions"} />
          <FaqList faqs={s.faqs} />
        </Container>
      );
    case "countdown":
      return (
        <Container className="max-w-3xl">
          <Countdown title={s.title} endsAt={s.endsAt} />
        </Container>
      );
    case "order_form":
      if (!s.product) return null;
      return (
        <Container className="max-w-xl">
          <OrderFormBlock title={s.title} product={s.product} />
        </Container>
      );
    case "features":
      return (
        <Container>
          {s.title && <SectionTitle title={s.title} />}
          <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
            {s.items.map((it, i) => {
              const Icon = ICONS[(it.icon ?? "").toLowerCase()] ?? Check;
              return (
                <li key={i} className="rounded-xl border border-border bg-card p-4">
                  <span className="grid size-10 place-items-center rounded-full bg-primary/10 text-primary">
                    <Icon className="size-5" aria-hidden />
                  </span>
                  <p className="mt-3 text-sm font-medium">{it.title}</p>
                  {it.text && <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{it.text}</p>}
                </li>
              );
            })}
          </ul>
        </Container>
      );
    case "video":
      return (
        <Container className="max-w-3xl">
          {s.title && <SectionTitle title={s.title} />}
          <div className="relative aspect-video overflow-hidden rounded-xl bg-black">
            <iframe
              src={`https://www.youtube-nocookie.com/embed/${encodeURIComponent(s.youtubeId)}?rel=0`}
              title={s.title ?? "Video"}
              loading="lazy"
              allow="accelerometer; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              referrerPolicy="strict-origin-when-cross-origin"
              className="absolute inset-0 size-full"
            />
          </div>
        </Container>
      );
    default:
      return null;
  }
}

export function Sections({ sections }: { sections: Section[] }) {
  return (
    <div className="space-y-12 pb-6 sm:space-y-16">
      {sections.map((s, i) => (
        <SectionBlock key={s.id ?? `${s.type}-${i}`} s={s} index={i} />
      ))}
    </div>
  );
}
