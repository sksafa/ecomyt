import type { Metadata } from "next";
import Link from "next/link";
import { storeData } from "@/components/store/server-api";
import type { Faq } from "@/components/store/types";
import { Container, EmptyBlock, FaqList } from "@/components/store/ui";

export const metadata: Metadata = { title: "FAQ", description: "Delivery, cash on delivery, exchange and care questions about Bent & Bound orna." };

export default async function FaqPage() {
  const faqs = await storeData<Faq[]>("/storefront/faqs", { revalidate: 300 }).catch(() => null);
  const groups = new Map<string, Faq[]>();
  for (const f of faqs ?? []) groups.set(f.category || "General", [...(groups.get(f.category || "General") ?? []), f]);
  const jsonLd = faqs?.length
    ? { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: faqs.map((f) => ({ "@type": "Question", name: f.question, acceptedAnswer: { "@type": "Answer", text: f.answer } })) }
    : null;
  return (
    <Container className="max-w-3xl py-8 sm:py-12">
      <h1 className="font-display text-4xl font-semibold text-[var(--bb-maroon)]">
        Frequently asked questions <span className="block font-bengali text-xl text-muted-foreground">সচরাচর জিজ্ঞাসা</span>
      </h1>
      <div className="mt-8 space-y-8">
        {faqs === null ? (
          <EmptyBlock title="Couldn’t load the FAQ" text="Please refresh the page in a moment." />
        ) : faqs.length === 0 ? (
          <EmptyBlock
            title="No questions yet"
            text="Have a question about delivery, cash on delivery or exchange? Track your order or contact us."
            action={
              <Link href="/order-status" className="inline-flex h-11 items-center rounded-md bg-primary px-6 text-sm font-medium text-primary-foreground">
                Track your order
              </Link>
            }
          />
        ) : (
          [...groups].map(([cat, list]) => (
            <section key={cat}>
              {groups.size > 1 && <h2 className="mb-3 font-display text-2xl font-semibold">{cat}</h2>}
              <FaqList faqs={list} />
            </section>
          ))
        )}
      </div>
      {jsonLd && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />}
    </Container>
  );
}
