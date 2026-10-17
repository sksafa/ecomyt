import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { Sections } from "@/components/store/sections";
import { absoluteUrl, NotFoundError, storeData } from "@/components/store/server-api";
import type { CmsPage } from "@/components/store/types";
import { Container } from "@/components/store/ui";

type Params = Promise<{ slug: string }>;

const load = cache(async (slug: string) => {
  try {
    return await storeData<CmsPage>(`/storefront/pages/${encodeURIComponent(slug)}`, { revalidate: 30 });
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
});

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const page = await load((await params).slug);
  const firstImage = page.sections.find((s) => (s.type === "hero" || s.type === "image_banner") && s.imageUrl) as { imageUrl?: string } | undefined;
  const image = absoluteUrl(page.seo.ogImageUrl ?? firstImage?.imageUrl);
  return {
    title: page.seo.title,
    description: page.seo.description ?? undefined,
    alternates: { canonical: `/p/${page.slug}` },
    openGraph: { title: page.seo.title, description: page.seo.description ?? undefined, images: image ? [image] : undefined, type: "website" },
  };
}

export default async function CmsPageRoute({ params }: { params: Params }) {
  const page = await load((await params).slug);
  const startsWithHero = page.sections[0]?.type === "hero" || page.sections[0]?.type === "image_banner";
  return (
    <div className={startsWithHero ? "" : "pt-8 sm:pt-12"}>
      {!startsWithHero && (
        <Container className="mb-8 max-w-3xl">
          <h1 className="font-display text-4xl font-semibold text-[var(--bb-maroon)] sm:text-5xl">{page.title}</h1>
        </Container>
      )}
      <Sections sections={page.sections} />
    </div>
  );
}
