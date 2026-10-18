import type { Metadata } from "next";
import { cache } from "react";
import { ClassicHome } from "@/components/store/classic-home";
import { HomeLanding } from "@/components/store/home-landing/home-landing";
import { absoluteUrl, getHome, storeData } from "@/components/store/server-api";
import type { DeliveryOptionInfo, Faq, PublicProductDetail } from "@/components/store/types";

// Homepage = sales landing page for the product chosen in Content settings (Homepage product).
// The previous catalogue-style homepage lives at /home2 and is also shown here if no product can be sold.

const load = cache(async () => {
  const home = await getHome();
  const slug = home?.landing?.productSlug;
  if (!home || !slug) return null;
  const [product, faqs, delivery] = await Promise.all([
    storeData<{ product: PublicProductDetail }>(`/storefront/products/${encodeURIComponent(slug)}`, { revalidate: 30 })
      .then((r) => r.product)
      .catch(() => null),
    storeData<Faq[]>("/storefront/faqs", { revalidate: 300 }).catch(() => [] as Faq[]),
    storeData<DeliveryOptionInfo[]>("/storefront/delivery-options", { revalidate: 60 }).catch(() => [] as DeliveryOptionInfo[]),
  ]);
  return product ? { home, product, faqs, delivery } : null;
});

export async function generateMetadata(): Promise<Metadata> {
  const data = await load();
  if (!data) return { alternates: { canonical: "/" } };
  const { product } = data;
  const description = product.seo.description ?? product.shortDescription ?? `${product.name} – premium embroidered orna by Bent & Bound. ক্যাশ অন ডেলিভারি, সারা বাংলাদেশে।`;
  const image = absoluteUrl(product.seo.ogImageUrl ?? product.imageUrl);
  return {
    title: { absolute: `${product.name} · Bent & Bound` },
    description,
    alternates: { canonical: "/" },
    openGraph: { type: "website", title: product.name, description, images: image ? [{ url: image, alt: product.name }] : undefined },
    twitter: { card: "summary_large_image", title: product.name, description, images: image ? [image] : undefined },
  };
}

export default async function HomePage() {
  const data = await load();
  if (!data) return <ClassicHome />;
  const { product } = data;
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
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <HomeLanding product={product} home={data.home} faqs={data.faqs} delivery={data.delivery} />
    </>
  );
}
