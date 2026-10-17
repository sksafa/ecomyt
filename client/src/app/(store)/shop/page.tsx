import type { Metadata } from "next";
import { Suspense } from "react";
import { storeData, storeFetch } from "@/components/store/server-api";
import { Pager, ShopFilters } from "@/components/store/shop-filters";
import type { CategoryNode, CollectionListItem, PublicProduct } from "@/components/store/types";
import { Container, EmptyBlock, ProductGrid } from "@/components/store/ui";

export const metadata: Metadata = {
  title: "Shop all orna",
  description: "Browse premium embroidered orna (dupatta) – hand embroidery, zari, nakshi kantha. Cash on delivery all over Bangladesh.",
};

type SP = { collection?: string; category?: string; search?: string; sort?: string; page?: string };
const SORTS = ["newest", "price_asc", "price_desc", "name", "featured"];

export default async function ShopPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const sort = SORTS.includes(sp.sort ?? "") ? sp.sort : undefined;
  const qs = new URLSearchParams(
    Object.entries({ page: String(page), pageSize: "24", collection: sp.collection, category: sp.category, search: sp.search?.slice(0, 100), sort }).filter(([, v]) => v) as [string, string][],
  );

  const [list, collections, categories] = await Promise.all([
    storeFetch<PublicProduct[]>(`/storefront/products?${qs}`).catch(() => null),
    storeData<CollectionListItem[]>("/storefront/collections", { revalidate: 300 }).catch(() => [] as CollectionListItem[]),
    storeData<CategoryNode[]>("/storefront/categories", { revalidate: 300 }).catch(() => [] as CategoryNode[]),
  ]);
  const flatCats = categories.flatMap((c) => [c, ...c.children]);
  const heading = sp.search
    ? `Results for “${sp.search}”`
    : sp.collection
      ? (collections.find((c) => c.slug === sp.collection)?.name ?? "Shop")
      : sp.category
        ? (flatCats.find((c) => c.slug === sp.category)?.name ?? "Shop")
        : "Shop all orna";

  return (
    <Container className="py-8 sm:py-10">
      <h1 className="font-display text-3xl font-semibold sm:text-4xl">{heading}</h1>
      {list?.meta && <p className="mt-1 text-sm text-muted-foreground">{list.meta.total} pieces</p>}
      <div className="mt-5">
        <Suspense>
          <ShopFilters key={sp.search ?? ""} collections={collections.filter((c) => c.productCount > 0)} categories={flatCats} />
        </Suspense>
      </div>
      <div className="mt-6">
        {!list ? (
          <EmptyBlock title="Couldn’t load products" text="Please refresh the page in a moment." />
        ) : list.data.length === 0 ? (
          <EmptyBlock title="No orna found" text={sp.search ? "Try a different word, or browse all pieces." : "Nothing here yet — please check back soon."} />
        ) : (
          <ProductGrid products={list.data} priorityCount={4} />
        )}
      </div>
      {list?.meta && <Pager page={list.meta.page} totalPages={list.meta.totalPages} basePath="/shop" params={{ collection: sp.collection, category: sp.category, search: sp.search, sort }} />}
    </Container>
  );
}
