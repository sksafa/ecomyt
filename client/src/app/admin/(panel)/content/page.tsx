"use client";

import { Suspense } from "react";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/admin/ui";
import { Forbidden, useUrlFilters } from "@/components/admin/ops/common";
import { BannersTab, ContentSettingsTab, FaqsTab, PagesTab, TestimonialsTab } from "@/components/admin/ops/content-tabs";

const TABS = [
  { key: "banners", label: "Banners" },
  { key: "pages", label: "Pages & landing pages" },
  { key: "testimonials", label: "Testimonials" },
  { key: "faqs", label: "FAQs" },
  { key: "settings", label: "Content settings" },
] as const;

function ContentScreen() {
  const { can } = useAuth();
  const [filters, setFilters] = useUrlFilters(["tab"] as const);
  if (!can("cms.manage")) return <Forbidden what="storefront content" />;
  const tab = TABS.find((t) => t.key === filters.tab) ?? TABS[0];
  return (
    <div className="space-y-4">
      <PageHeader title="Storefront content" description="Banners, pages, reviews and FAQs shown on the website. Changes go live immediately." />
      <div className="flex gap-1 overflow-x-auto border-b" role="tablist">
        {TABS.map((t) => (
          <button key={t.key} role="tab" aria-selected={tab.key === t.key} onClick={() => setFilters({ tab: t.key === "banners" ? undefined : t.key })}
            className={cn("shrink-0 border-b-2 px-3 py-2 text-sm font-medium", tab.key === t.key ? "border-blue-600 text-blue-700" : "border-transparent text-muted-foreground hover:text-foreground")}>
            {t.label}
          </button>
        ))}
      </div>
      {tab.key === "banners" && <BannersTab />}
      {tab.key === "pages" && <PagesTab />}
      {tab.key === "testimonials" && <TestimonialsTab />}
      {tab.key === "faqs" && <FaqsTab />}
      {tab.key === "settings" && <ContentSettingsTab />}
    </div>
  );
}

export default function ContentPage() {
  return <Suspense><ContentScreen /></Suspense>;
}
