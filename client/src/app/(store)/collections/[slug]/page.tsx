import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { absoluteUrl, NotFoundError, storeFetch } from "@/components/store/server-api";
import { Pager } from "@/components/store/shop-filters";
import type { CollectionInfo, PublicProduct } from "@/components/store/types";
import { Container, EmptyBlock, ProductGrid } from "@/components/store/ui";

type Params = Promise<{ slug: string }>;
type Payload = { collection: CollectionInfo; products: PublicProduct[] };

async function load(slug: string, page = 1) {
  try {
    return await storeFetch<Payload>(`/storefront/collections/${encodeURIComponent(slug)}?page=${page}&pageSize=24`, { revalidate: 60 });
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  const { data } = await load(slug);
  const image = absoluteUrl(data.collection.imageUrl ?? data.products[0]?.imageUrl);
  return {
    title: data.collection.name,
    description: data.collection.description ?? `${data.collection.name} – premium embroidered orna by Bent & Bound. Cash on delivery all over Bangladesh.`,
    openGraph: { title: data.collection.name, images: image ? [image] : undefined },
  };
}

export default async function CollectionPage({ params, searchParams }: { params: Params; searchParams: Promise<{ page?: string }> }) {
  const { slug } = await params;
  const page = Math.max(1, Number((await searchParams).page) || 1);
  const { data, meta } = await load(slug, page);
  return (
    <>
      <section className="bg-[var(--bb-cream)]">
        <Container className="py-10 text-center sm:py-14">
          <p className="text-xs font-medium uppercase tracking-[0.25em] text-[var(--bb-gold)]">Collection</p>
          <h1 className="mt-2 font-display text-4xl font-semibold text-[var(--bb-maroon)] sm:text-5xl">{data.collection.name}</h1>
          {data.collection.description && <p className="mx-auto mt-3 max-w-xl text-sm text-foreground/80">{data.collection.description}</p>}
          {meta && <p className="mt-2 text-xs text-muted-foreground">{meta.total} pieces</p>}
        </Container>
      </section>
      <Container className="py-8">
        {data.products.length ? <ProductGrid products={data.products} priorityCount={4} /> : <EmptyBlock title="Coming soon" text="New pieces for this collection are being finished." />}
        {meta && <Pager page={meta.page} totalPages={meta.totalPages} basePath={`/collections/${slug}`} params={{}} />}
      </Container>
    </>
  );
}
