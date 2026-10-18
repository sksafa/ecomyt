import Link from "next/link";
import { BadgeCheck, Camera, Check, MessageCircle, Phone, RefreshCcw, ShieldCheck, Truck, Wallet } from "lucide-react";
import { bdt } from "@/lib/format";
import { cn } from "@/lib/utils";
import { landingThemeClass } from "../fonts";
import type { DeliveryOptionInfo, Faq, HomeData, PublicProductDetail } from "../types";
import { Img, Stars } from "../ui";
import { HeroGallery, LandingOrder, LandingViewContent, ORDER_ANCHOR, OrderButton, StickyOrderBar, type Slide } from "./landing-interactive";

/*
 * Homepage sales page ("/") for one product, modelled on the brand's embroidered-orna landing pages.
 * Everything product-specific (name, photos, price, fabric, sizes, stock) comes from the catalogue; the
 * Bengali copy below is brand-level and makes no product claims, so it stays true for whichever product
 * is selected in Content settings. Reviews are only real testimonials from the CMS.
 */

const uniq = (xs: (string | null)[]) => [...new Set(xs.filter((x): x is string => !!x?.trim()))];

/** wa.me link for a Bangladeshi number ("01XXXXXXXXX" / "+8801…"), with a pre-filled order message. */
function whatsappLink(raw: string | null | undefined, productName: string) {
  const digits = (raw ?? "").replace(/\D/g, "");
  const intl = digits.startsWith("880") ? digits : digits.startsWith("01") ? `88${digits}` : digits;
  if (intl.length < 11) return null;
  return `https://wa.me/${intl}?text=${encodeURIComponent(`আমি "${productName}" অর্ডার করতে চাই।`)}`;
}

function SectionHead({ eyebrow, title, className, light }: { eyebrow: string; title: string; className?: string; light?: boolean }) {
  return (
    <div className={cn("mb-8 text-center sm:mb-12", className)}>
      <p className="lp-eyebrow">{eyebrow}</p>
      <h2 className={cn("lp-serif mt-2 text-[1.9rem] leading-tight sm:text-[2.6rem]", light ? "text-white" : "text-[var(--lp-maroon-deep)]")}>{title}</h2>
    </div>
  );
}

const Wrap = ({ children, className }: { children: React.ReactNode; className?: string }) => <div className={cn("mx-auto w-full max-w-6xl px-4 sm:px-6", className)}>{children}</div>;

/** Image + text row; image side alternates on desktop, image always first on phones. */
function Feature({ image, alt, flip, children }: { image?: string | null; alt: string; flip?: boolean; children: React.ReactNode }) {
  if (!image) return <div className="mx-auto max-w-2xl text-center [&_ul]:text-left">{children}</div>;
  return (
    <div className="grid items-center gap-7 md:grid-cols-2 md:gap-14">
      <div className={cn("overflow-hidden rounded-2xl bg-[var(--lp-cream)] shadow-[0_30px_60px_-35px_rgb(69_19_29/0.45)]", flip && "md:order-2")}>
        <Img src={image} alt={alt} className="aspect-[4/5] w-full" />
      </div>
      <div className={cn(flip && "md:order-1")}>{children}</div>
    </div>
  );
}

function Para({ children }: { children: React.ReactNode }) {
  return <p className="mt-4 text-[1.02rem] leading-[1.85] text-[var(--lp-muted)] [&_b]:font-semibold [&_b]:text-[var(--lp-maroon)]">{children}</p>;
}

export function HomeLanding({ product, home, faqs, delivery }: { product: PublicProductDetail; home: HomeData; faqs: Faq[]; delivery: DeliveryOptionInfo[] }) {
  const images = product.images.length ? product.images : product.imageUrl ? [{ url: product.imageUrl, alt: product.name }] : [];
  const pic = (i: number) => images[i]?.url ?? null;
  const price = product.price;
  const compareAt = product.compareAtPrice && Number(product.compareAtPrice) > Number(price) ? product.compareAtPrice : null;
  const save = compareAt ? Number(compareAt) - Number(price) : 0;
  const off = compareAt ? Math.round((save / Number(compareAt)) * 100) : 0;
  const colors = uniq(product.variants.map((v) => v.color));
  const sizes = uniq(product.variants.map((v) => v.size));
  const wa = whatsappLink(home.footer?.whatsapp, product.name);
  const phone = home.store.phone?.trim() || null;
  const inside = delivery.find((d) => d.code === "INSIDE_DHAKA");
  const outside = delivery.find((d) => d.code === "OUTSIDE_DHAKA");

  const captions = [
    { title: "Elegant. Classy. Premium.", text: [product.embroidery, product.fabric].filter(Boolean).join(" · ") || "প্রিমিয়াম এমব্রয়ডারি করা ওড়না" },
    { title: "Designed With Detail", text: "সূক্ষ্ম সুতার কাজ ও যত্নশীল ফিনিশিং" },
    { title: "Made For Your Style", text: "আরামদায়ক, মার্জিত এবং premium look" },
  ];
  const slides: Slide[] = images.map((im, i) => ({ url: im.url, alt: im.alt ?? product.name, ...(captions[i] ?? {}) }));

  const details: [string, string][] = (
    [
      ["রং · Color", colors.join(", ")],
      ["কাপড় · Fabric", product.fabric],
      ["সাইজ · Size", sizes.join(", ")],
      ["কাজ · Work", product.embroidery],
      ["ডিজাইন · Design", product.design],
    ] as [string, string | null][]
  ).filter((d): d is [string, string] => !!d[1]);

  const care = product.careInstructions
    ? product.careInstructions.split(/\r?\n|।\s*/).map((s) => s.replace(/^[-•*\s]+/, "").trim()).filter(Boolean)
    : ["ঠান্ডা পানিতে ধুয়ে নিন", "ব্লিচ ব্যবহার করবেন না", "ছায়ায় শুকাতে দিন", "প্রয়োজন হলে হালকা তাপমাত্রায় উল্টো দিক থেকে ইস্ত্রি করুন", "Embroidery ও Lace-এর সৌন্দর্য ধরে রাখতে মেশিনে না ধুয়ে হালকা হাতে ধোয়া ভালো"];

  const deliveryText =
    inside && outside ? `ঢাকার ভিতরে ${bdt(inside.charge)} এবং ঢাকার বাইরে ${bdt(outside.charge)}। অর্ডার ফর্মে আপনার এলাকা বেছে নিলে মোট টাকা সাথে সাথে দেখতে পাবেন।` : null;

  const faqItems: { q: string; a: string }[] = [
    ...(product.fabric ? [{ q: "এই ওড়নার কাপড় কী?", a: product.fabric }] : []),
    ...(sizes.length ? [{ q: "ওড়নার সাইজ কত?", a: sizes.join(", ") }] : []),
    ...(product.embroidery ? [{ q: "Embroidery কীভাবে করা হয়েছে?", a: product.embroidery }] : []),
    ...(product.careInstructions ? [{ q: "ওড়নাটি কি ধোয়া যাবে?", a: product.careInstructions }] : []),
    ...(deliveryText ? [{ q: "ডেলিভারি চার্জ কত?", a: deliveryText }] : []),
    { q: "Product হাতে পাওয়ার পর চেক করা যাবে?", a: "অবশ্যই। প্রোডাক্ট হাতে পাওয়ার পর ভালোভাবে চেক করে দেখুন। পছন্দ হলে তবেই পেমেন্ট করবেন।" },
    { q: "Return করলে delivery charge কে বহন করবে?", a: "কোনো কারণে প্রোডাক্ট রিটার্ন করতে চাইলে রিটার্নের ক্ষেত্রে delivery charge customer-কে বহন করতে হবে।" },
    ...faqs.map((f) => ({ q: f.question, a: f.answer })),
  ];

  const trust = [
    { icon: Wallet, text: "ক্যাশ অন ডেলিভারি" },
    { icon: BadgeCheck, text: "হাতে পেয়ে দেখে পেমেন্ট" },
    { icon: Truck, text: "সারা বাংলাদেশে ডেলিভারি" },
  ];

  return (
    // -mb-16 cancels the store footer's top margin so the order section meets the footer
    <div className={cn(landingThemeClass, "-mb-16")}>
      <LandingViewContent product={product} />

      {/* 1 · Hero */}
      <section className="bg-[var(--lp-sand)]">
        <Wrap className="grid gap-6 py-6 sm:gap-8 sm:py-12 lg:grid-cols-2 lg:gap-x-14 lg:gap-y-0 lg:py-16">
          <div className="text-center lg:order-2 lg:self-end lg:pb-8 lg:text-left">
            <p className="lp-serif hidden text-base tracking-[0.3em] text-[var(--lp-maroon)] lowercase lg:block">bent &amp; bound</p>
            <div className="lp-rule mx-auto hidden lg:mx-0 lg:mt-3 lg:block" />
            <p className="lp-eyebrow lg:hidden">Premium embroidered orna</p>
            <h1 className="lp-serif mt-2 lg:mt-5 text-[2.15rem] leading-[1.1] text-[var(--lp-maroon-deep)] sm:text-5xl lg:text-[3.4rem]">{product.name}</h1>
            <p className="mt-3 text-base text-[var(--lp-muted)] sm:text-lg">আপনার পরের অনুষ্ঠানে সাজটা একটু আলাদা হোক।</p>
          </div>

          <div className="lg:order-1 lg:row-span-2">
            <HeroGallery slides={slides} />
          </div>

          <div className="text-center lg:order-3 lg:self-start lg:text-left">
            <div className="flex flex-wrap items-baseline justify-center gap-x-3 gap-y-1 lg:justify-start">
              <span className="lp-serif text-4xl text-[var(--lp-maroon)] sm:text-[2.6rem]">{bdt(price)}</span>
              {compareAt && <span className="text-lg text-[var(--lp-muted)] line-through">{bdt(compareAt)}</span>}
              {off > 0 && <span className="rounded-full bg-[var(--lp-maroon)] px-2.5 py-0.5 text-xs font-semibold text-white">{off}% ছাড়</span>}
            </div>
            {!product.inStock && <p className="mt-2 font-medium text-destructive">এই মুহূর্তে স্টক শেষ · Sold out</p>}
            <div id="lp-hero-cta" className="mt-6 flex flex-col items-stretch gap-3 sm:flex-row sm:justify-center lg:justify-start">
              <OrderButton className="sm:min-w-52" />
              {wa && (
                <a href={wa} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-[3.25rem] items-center justify-center gap-2 rounded-full border border-[#1f9d55]/40 bg-white px-7 font-semibold text-[#17803f] hover:bg-[#f2fbf5]">
                  <MessageCircle className="size-5" aria-hidden /> WhatsApp-এ অর্ডার
                </a>
              )}
            </div>
            <ul className="mt-7 grid grid-cols-3 gap-2 border-t border-[var(--lp-gold)]/30 pt-5 text-[13px] text-[var(--lp-ink)] sm:text-sm">
              {trust.map(({ icon: Icon, text }) => (
                <li key={text} className="flex flex-col items-center gap-1.5 text-center lg:flex-row lg:text-left">
                  <Icon className="size-5 shrink-0 text-[var(--lp-gold)]" aria-hidden /> {text}
                </li>
              ))}
            </ul>
          </div>
        </Wrap>
      </section>

      {/* 2–4 · Details, value, embroidery close-ups */}
      <section className="py-16 sm:py-24">
        <Wrap>
          <SectionHead eyebrow="The details" title="Made With Elegance" />
          <div className="space-y-16 sm:space-y-24">
            <Feature image={pic(1) ?? pic(0)} alt={`${product.name} – details`}>
              <h3 className="lp-serif text-[1.75rem] text-[var(--lp-maroon)]">Product Details</h3>
              {product.shortDescription && <Para>{product.shortDescription}</Para>}
              {details.length > 0 && (
                <dl className="mt-5 divide-y divide-[var(--lp-sand)] border-y border-[var(--lp-sand)]">
                  {details.map(([k, v]) => (
                    <div key={k} className="grid grid-cols-[7.5rem_1fr] gap-3 py-3 text-[0.98rem]">
                      <dt className="font-semibold text-[var(--lp-maroon-deep)]">{k}</dt>
                      <dd className="text-[var(--lp-muted)]">{v}</dd>
                    </div>
                  ))}
                </dl>
              )}
              {product.description && <p className="mt-5 whitespace-pre-line text-[0.98rem] leading-[1.85] text-[var(--lp-muted)]">{product.description}</p>}
              <OrderButton className="mt-7" />
            </Feature>

            <Feature image={pic(2)} alt={`${product.name} – worn`} flip>
              <h3 className="lp-serif text-[1.75rem] leading-snug text-[var(--lp-maroon)]">কেন আমাদের কাছ থেকে এই Orna কিনবেন?</h3>
              <Para>
                আমরা এই Orna সাধারণ প্রতিদিনের ব্যবহারের জন্য তৈরি করিনি। এমনভাবে ডিজাইন করেছি, যেন <b>দাওয়াত, বিয়ে, পারিবারিক অনুষ্ঠান কিংবা যেকোনো বিশেষ আয়োজনে</b> পরলে আপনার পুরো
                Outfit-এ আসে একটি আলাদা <b>Elegant &amp; Luxury Look</b>। নিখুঁত Embroidery, যত্নশীল ফিনিশিং আর আরামদায়ক কাপড় — সুন্দর look-এর পাশাপাশি পরতেও স্বস্তি।
              </Para>
              <Para>
                আমাদের লক্ষ্য শুধু একটি Orna বিক্রি করা নয় — এমন একটি Orna দেওয়া, যেটা পরলে আপনি নিজেই এর <b>Luxury Look ও Quality</b>-র পার্থক্য অনুভব করবেন।
              </Para>
              <OrderButton className="mt-7" />
            </Feature>

            <Feature image={pic(3)} alt={`${product.name} – embroidery close-up`}>
              <h3 className="lp-serif text-[1.75rem] leading-snug text-[var(--lp-maroon)]">প্রোডাক্ট হাতে পেয়ে দেখে তারপর পেমেন্ট</h3>
              <Para>
                প্রোডাক্ট হাতে পাওয়ার পর <b>কাপড়, embroidery ও finishing দেখে নিন।</b> পছন্দ হলে তবেই payment করবেন — অগ্রিম কোনো টাকা লাগবে না।
              </Para>
              <ul className="mx-auto mt-5 inline-grid gap-2.5 text-[0.98rem] text-[var(--lp-ink)]">
                {["ক্যাশ অন ডেলিভারি — সারা বাংলাদেশে", "অর্ডারের পর কল করে অর্ডার নিশ্চিত করা হয়", "ছবিতে যেমন দেখছেন, হাতে পাবেন ঠিক তেমন"].map((t) => (
                  <li key={t} className="flex items-start gap-2.5">
                    <Check className="mt-0.5 size-5 shrink-0 text-[var(--lp-gold)]" aria-hidden /> {t}
                  </li>
                ))}
              </ul>
              <div>
                <OrderButton className="mt-7" />
              </div>
            </Feature>
          </div>
        </Wrap>
      </section>

      {/* 6 · Offer */}
      <section className="bg-[var(--lp-cream)] py-16 sm:py-24">
        <Wrap>
          <SectionHead eyebrow="Special offer" title="আজকের বিশেষ অফার" />
          <div className="mx-auto max-w-xl rounded-3xl border border-white bg-white px-6 py-9 text-center shadow-[0_30px_60px_-35px_rgb(69_19_29/0.4)] sm:px-10">
            {compareAt ? (
              <>
                <span className="inline-block rounded-full bg-[var(--lp-maroon)] px-4 py-1.5 text-xs font-semibold tracking-wider text-white">{off}% ছাড়</span>
                <p className="mt-5 text-sm text-[var(--lp-muted)]">নিয়মিত মূল্য · Regular price</p>
                <p className="text-xl text-[var(--lp-muted)] line-through">{bdt(compareAt)}</p>
                <p className="mt-3 text-sm text-[var(--lp-muted)]">অফার মূল্য · Offer price</p>
              </>
            ) : (
              <p className="text-sm text-[var(--lp-muted)]">মূল্য · Price</p>
            )}
            <p className="lp-serif mt-1 text-5xl text-[var(--lp-maroon)] sm:text-6xl">{bdt(price)}</p>
            {save > 0 && <p className="mt-3 text-sm font-medium text-[var(--lp-ink)]">আপনি সাশ্রয় করছেন {bdt(save)}</p>}
            {deliveryText && inside && outside && (
              <p className="mx-auto mt-4 max-w-sm text-sm text-[var(--lp-muted)]">
                + ডেলিভারি চার্জ: ঢাকার ভিতরে {bdt(inside.charge)} · ঢাকার বাইরে {bdt(outside.charge)}
              </p>
            )}
            <OrderButton className="mt-7 w-full sm:w-auto sm:min-w-60" />
          </div>
        </Wrap>
      </section>

      {/* 5 · Reviews (real CMS testimonials only) */}
      {home.testimonials.length > 0 && (
        <section className="py-16 sm:py-24">
          <Wrap>
            <SectionHead eyebrow="Customer reviews" title="কাস্টমারদের মতামত" />
            <div className="bb-scroll-x -mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 lg:grid-cols-3">
              {home.testimonials.map((t) => (
                <figure key={t.id} className="flex w-[85%] shrink-0 snap-center flex-col rounded-2xl border border-[var(--lp-sand)] bg-white p-6 sm:w-auto">
                  {t.rating ? <Stars rating={t.rating} /> : null}
                  <blockquote className="mt-3 flex-1 text-[0.98rem] leading-relaxed text-[var(--lp-ink)]">“{t.quote}”</blockquote>
                  <figcaption className="mt-5 flex items-center gap-3 border-t border-[var(--lp-sand)] pt-4">
                    {t.imageUrl ? (
                      <Img src={t.imageUrl} alt="" className="size-10 rounded-full" />
                    ) : (
                      <span className="lp-serif grid size-10 place-items-center rounded-full bg-[var(--lp-cream)] text-[var(--lp-maroon)]">{t.name.slice(0, 1)}</span>
                    )}
                    <span>
                      <span className="block text-sm font-semibold">{t.name}</span>
                      {t.location && <span className="block text-xs text-[var(--lp-muted)]">{t.location}</span>}
                    </span>
                  </figcaption>
                </figure>
              ))}
            </div>
            <div className="mt-10 text-center">
              <OrderButton />
            </div>
          </Wrap>
        </section>
      )}

      {/* Care guide */}
      <section className={cn("py-16 sm:py-24", home.testimonials.length > 0 && "pt-0 sm:pt-0")}>
        <Wrap className="max-w-3xl">
          <SectionHead eyebrow="Care guide" title="কাপড়ের যত্নের নির্দেশনা" />
          <ul className="divide-y divide-[var(--lp-gold)]/20 rounded-2xl bg-[var(--lp-cream)] px-6 py-2 sm:px-9">
            {care.map((c) => (
              <li key={c} className="flex items-start gap-3 py-3.5 text-[0.98rem] text-[var(--lp-muted)]">
                <Check className="mt-0.5 size-4 shrink-0 text-[var(--lp-gold)]" aria-hidden /> {c}
              </li>
            ))}
          </ul>
        </Wrap>
      </section>

      {/* Trust: photos, returns, delivery */}
      <section className="bg-[var(--lp-cream)] py-16 sm:py-20">
        <Wrap>
          <div className="grid gap-4 md:grid-cols-3 md:gap-5">
            <div className="rounded-2xl border border-white bg-white p-6 sm:p-7">
              <Camera className="size-6 text-[var(--lp-gold)]" aria-hidden />
              <h3 className="lp-serif mt-3 text-xl text-[var(--lp-maroon)]">ছবির সাথে মিলবে?</h3>
              <p className="mt-2 text-[0.95rem] leading-[1.8] text-[var(--lp-muted)]">
                জি, অবশ্যই মিলবে। ছবিতে যেমনটি দেখছেন, হাতে পেয়েও ঠিক তেমনটাই পাবেন। আমরা ছবিতে কোনো অতিরিক্ত editing বা misleading presentation করি না।
              </p>
            </div>
            <div className="rounded-2xl border border-white bg-white p-6 sm:p-7">
              <RefreshCcw className="size-6 text-[var(--lp-gold)]" aria-hidden />
              <h3 className="lp-serif mt-3 text-xl text-[var(--lp-maroon)]">রিটার্ন পলিসি</h3>
              <p className="mt-2 text-[0.95rem] leading-[1.8] text-[var(--lp-muted)]">
                প্রোডাক্ট হাতে পেয়ে ভালোভাবে চেক করে দেখুন, পছন্দ হলে তবেই পেমেন্ট করবেন। কোনো কারণে রিটার্ন করতে চাইলে রিটার্নের ডেলিভারি চার্জ কাস্টমারকে বহন করতে হবে।
              </p>
            </div>
            <div className="rounded-2xl border border-white bg-white p-6 sm:p-7">
              <Truck className="size-6 text-[var(--lp-gold)]" aria-hidden />
              <h3 className="lp-serif mt-3 text-xl text-[var(--lp-maroon)]">ডেলিভারি</h3>
              <p className="mt-2 text-[0.95rem] leading-[1.8] text-[var(--lp-muted)]">{deliveryText ?? "সারা বাংলাদেশে ক্যাশ অন ডেলিভারি।"}</p>
            </div>
          </div>
        </Wrap>
      </section>

      {/* FAQ */}
      <section className="py-16 sm:py-24">
        <Wrap className="max-w-3xl">
          <SectionHead eyebrow="Questions" title="সাধারণ জিজ্ঞাসা" />
          <div className="divide-y divide-[var(--lp-sand)] border-y border-[var(--lp-sand)]">
            {faqItems.map((f, i) => (
              <details key={f.q + i} className="group">
                <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 py-4 text-[1.02rem] font-semibold text-[var(--lp-ink)] [&::-webkit-details-marker]:hidden">
                  {f.q}
                  <span aria-hidden className="text-xl leading-none text-[var(--lp-maroon)] transition-transform group-open:rotate-45">+</span>
                </summary>
                <p className="whitespace-pre-line pb-5 text-[0.98rem] leading-[1.8] text-[var(--lp-muted)]">{f.a}</p>
              </details>
            ))}
          </div>
        </Wrap>
      </section>

      {/* 7 · Order */}
      <section id={ORDER_ANCHOR} className="scroll-mt-16 bg-[var(--lp-cream)] pb-16 sm:pb-24">
        <div className="bg-[var(--lp-maroon-deep)] px-4 pb-24 pt-12 text-center sm:pb-28 sm:pt-16">
          <p className="lp-eyebrow !text-[var(--lp-gold-soft)]">Order now</p>
          <h2 className="lp-serif mt-2 text-[1.9rem] leading-tight text-white sm:text-[2.6rem]">আপনার পছন্দের Orna অর্ডার করুন</h2>
          <p className="mx-auto mt-3 max-w-xl text-white/80">নিচের ফর্মে নাম, মোবাইল নম্বর ও ঠিকানা দিন — আমরা কল করে অর্ডার নিশ্চিত করব।</p>
          {(phone || wa) && (
            <div className="mt-5 flex flex-wrap justify-center gap-3 text-sm">
              {phone && (
                <a href={`tel:${phone.replace(/[^\d+]/g, "")}`} className="inline-flex min-h-11 items-center gap-2 rounded-full border border-white/30 px-5 text-white hover:bg-white/10">
                  <Phone className="size-4" aria-hidden /> কল করুন {phone}
                </a>
              )}
              {wa && (
                <a href={wa} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-2 rounded-full bg-[#25d366] px-5 font-semibold text-white hover:bg-[#1fbd5b]">
                  <MessageCircle className="size-4" aria-hidden /> WhatsApp-এ অর্ডার করুন
                </a>
              )}
            </div>
          )}
        </div>
        <Wrap className="-mt-16 sm:-mt-20">
          <div className="rounded-3xl bg-[var(--lp-cream)] p-0 sm:p-2">
            {product.inStock ? (
              <LandingOrder product={product} />
            ) : (
              <div className="rounded-2xl bg-white p-8 text-center">
                <ShieldCheck className="mx-auto size-8 text-[var(--lp-gold)]" aria-hidden />
                <p className="lp-serif mt-3 text-2xl text-[var(--lp-maroon)]">এই মুহূর্তে স্টক শেষ</p>
                <p className="mt-2 text-[var(--lp-muted)]">নতুন স্টক আসছে। {wa || phone ? "আগাম অর্ডার বা খোঁজ নিতে আমাদের সাথে যোগাযোগ করুন।" : ""}</p>
                <Link href="/shop" className="lp-cta mt-6">অন্যান্য ডিজাইন দেখুন</Link>
              </div>
            )}
          </div>
        </Wrap>
      </section>

      {product.inStock && <StickyOrderBar price={price} compareAt={compareAt} />}
    </div>
  );
}
