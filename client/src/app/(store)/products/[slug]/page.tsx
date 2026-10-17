import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { ProductDetail } from "@/components/store/product-detail";
import { absoluteUrl, NotFoundError, storeData } from "@/components/store/server-api";
import type { PublicProduct, PublicProductDetail } from "@/components/store/types";
import { Container, ProductGrid, SectionTitle } from "@/components/store/ui";

type Params = Promise<{ slug: string }>;
type Payload = { product: PublicProductDetail; related: PublicProduct[]; upsell: PublicProduct[] };

const load = cache(async (slug: string) => {
  try {
    return await storeData<Payload>(`/storefront/products/${encodeURIComponent(slug)}`, { revalidate: 30 });
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
});

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { product } = await load((await params).slug);
  const image = absoluteUrl(product.seo.ogImageUrl ?? product.imageUrl);
  const description = product.seo.description ?? product.shortDescription ?? `${product.name} – premium embroidered orna. Cash on delivery all over Bangladesh.`;
  return {
    title: product.seo.title,
    description,
    alternates: { canonical: `/products/${product.slug}` },
    openGraph: { type: "website", title: product.seo.title, description, images: image ? [{ url: image, alt: product.name }] : undefined },
    twitter: { card: "summary_large_image", title: product.seo.title, description, images: image ? [image] : undefined },
  };
}

export default async function ProductPage({ params }: { params: Params }) {
  const { product, related, upsell } = await load((await params).slug);
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    description: product.seo.description ?? product.shortDescription ?? undefined,
    image: product.images.map((i) => absoluteUrl(i.url)),
    sku: product.variants[0]?.sku,
    brand: { "@type": "Brand", name: "Bent & Bound" },
    offers: {
      "@type": "AggregateOffer",
      priceCurrency: "BDT",
      lowPrice: product.priceRange.min,
      highPrice: product.priceRange.max,
      availability: product.inStock ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
    },
  };
  const more = [...upsell, ...related.filter((r) => !upsell.some((u) => u.id === r.id))].slice(0, 8);
  return (
    <Container className="py-4 sm:py-8">
      <nav aria-label="Breadcrumb" className="mb-4 hidden text-xs text-muted-foreground sm:block">
        <Link href="/" className="hover:text-primary">Home</Link> /{" "}
        {product.category ? (
          <Link href={`/shop?category=${product.category.slug}`} className="hover:text-primary">{product.category.name}</Link>
        ) : (
          <Link href="/shop" className="hover:text-primary">Shop</Link>
        )}{" "}
        / <span className="text-foreground">{product.name}</span>
      </nav>
      <ProductDetail product={product} />
      {more.length > 0 && (
        <section className="mt-16">
          <SectionTitle title="You may also like" />
          <ProductGrid products={more} />
        </section>
      )}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
    </Container>
  );
}
