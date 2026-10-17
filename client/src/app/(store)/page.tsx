import Link from "next/link";
import { HeroBanners, InlineBanners } from "@/components/store/banners";
import { getHome, storeData } from "@/components/store/server-api";
import type { Faq } from "@/components/store/types";
import { Container, EmptyBlock, FaqList, Img, ProductGrid, SectionTitle, Testimonials, TrustBadges } from "@/components/store/ui";

export default async function HomePage() {
  const [home, faqs] = await Promise.all([getHome(), storeData<Faq[]>("/storefront/faqs", { revalidate: 300 }).catch(() => [] as Faq[])]);

  if (!home) {
    return (
      <Container className="py-16">
        <EmptyBlock title="We’ll be right back" text="The shop is temporarily unavailable. Please refresh in a moment." />
      </Container>
    );
  }

  const hero = home.banners.filter((b) => b.placement === "HOME_HERO");
  const other = home.banners.filter((b) => b.placement !== "HOME_HERO");
  const heroProduct = home.featuredProducts[0] ?? home.featuredCollections[0]?.products[0];

  return (
    <>
      {hero.length > 0 ? (
        <HeroBanners banners={hero} />
      ) : (
        // Fallback hero when no banner is scheduled: brand statement + a featured product photo
        <section className="relative overflow-hidden bg-[var(--bb-cream)]">
          <Container className="grid items-center gap-6 py-10 sm:py-14 md:grid-cols-2">
            <div className="order-2 md:order-1">
              <p className="text-xs font-medium uppercase tracking-[0.25em] text-[var(--bb-gold)]">Handcrafted in Bangladesh</p>
              <h1 className="mt-3 font-display text-4xl font-semibold leading-[1.05] text-[var(--bb-maroon)] sm:text-6xl">Embroidered orna, made to be treasured</h1>
              <p className="mt-4 max-w-md font-bengali text-base text-foreground/80">প্রিমিয়াম হাতের কাজের ওড়না — সারা বাংলাদেশে ক্যাশ অন ডেলিভারি।</p>
              <div className="mt-6 flex flex-wrap gap-3">
                <Link href="/shop" className="inline-flex h-12 items-center rounded-md bg-primary px-7 text-base font-medium text-primary-foreground hover:bg-primary/90">
                  Shop now
                </Link>
                {home.featuredCollections[0] && (
                  <Link href={`/collections/${home.featuredCollections[0].collection.slug}`} className="inline-flex h-12 items-center rounded-md border border-primary/40 px-6 text-base text-primary hover:bg-primary/5">
                    {home.featuredCollections[0].collection.name}
                  </Link>
                )}
              </div>
            </div>
            {heroProduct && (
              <Link href={`/products/${heroProduct.slug}`} className="order-1 mx-auto block w-3/4 max-w-sm md:order-2 md:w-full">
                <Img src={heroProduct.imageUrl} alt={heroProduct.name} eager className="aspect-[4/5] w-full rounded-t-full shadow-xl shadow-[var(--bb-maroon)]/10" />
              </Link>
            )}
          </Container>
        </section>
      )}

      <Container className="mt-8">
        <TrustBadges />
      </Container>

      {home.featuredCollections.map(({ collection, products }, i) =>
        products.length ? (
          <section key={collection.id} className="mt-14">
            <Container>
              <SectionTitle title={collection.name} eyebrow={i === 0 ? "Collection" : undefined} href={`/collections/${collection.slug}`} />
              {collection.description && <p className="-mt-3 mb-6 max-w-2xl text-sm text-muted-foreground">{collection.description}</p>}
              <ProductGrid products={products} priorityCount={i === 0 && hero.length === 0 ? 2 : 0} />
            </Container>
          </section>
        ) : null,
      )}

      {other.length > 0 && (
        <Container className="mt-14 px-0 sm:px-6">
          <InlineBanners banners={other} />
        </Container>
      )}

      {home.featuredProducts.length > 0 && (
        <section className="mt-14">
          <Container>
            <SectionTitle title="Featured orna" eyebrow="Handpicked" href="/shop?sort=featured" />
            <ProductGrid products={home.featuredProducts} />
          </Container>
        </section>
      )}

      {!home.featuredCollections.some((c) => c.products.length) && !home.featuredProducts.length && (
        <Container className="mt-14">
          <EmptyBlock title="New pieces are on their way" text="Our next collection is being finished by hand. Please check back soon." />
        </Container>
      )}

      {home.testimonials.length > 0 && (
        <section className="mt-16 bg-[var(--bb-cream)]/60 py-12">
          <Container>
            <Testimonials items={home.testimonials} />
          </Container>
        </section>
      )}

      {faqs.length > 0 && (
        <section className="mt-14">
          <Container className="max-w-3xl">
            <SectionTitle title="Questions? · প্রশ্ন" href="/faq" linkLabel="All FAQs" />
            <FaqList faqs={faqs.slice(0, 4)} />
          </Container>
        </section>
      )}
    </>
  );
}
