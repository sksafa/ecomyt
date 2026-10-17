"use client";

import Link from "next/link";
import { use, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, ExternalLink, Loader2 } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { dhakaDateTime } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ErrorState, Field, LoadingRows, NativeSelect, PageHeader, Pill, Section } from "@/components/admin/ui";
import { fieldErrorsOf, Forbidden, ImageField } from "@/components/admin/ops/common";
import { SectionBuilder, fromBlocks, toBlocks, type Block } from "@/components/admin/ops/section-builder";

interface CmsPage {
  id: string; slug: string; title: string; type: "PAGE" | "LANDING" | "POLICY"; status: "DRAFT" | "PUBLISHED"; sections: unknown[];
  seoTitle: string | null; seoDescription: string | null; ogImageUrl: string | null; publishedAt: string | null; updatedAt: string;
}

const slugify = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/[\s_]+/g, "-").replace(/-+/g, "-").slice(0, 100);

function Editor({ page }: { page: CmsPage | null }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [f, setF] = useState({
    title: page?.title ?? "", slug: page?.slug ?? "", type: page?.type ?? "LANDING", status: page?.status ?? "DRAFT",
    seoTitle: page?.seoTitle ?? "", seoDescription: page?.seoDescription ?? "", ogImageUrl: page?.ogImageUrl ?? "",
  });
  const [blocks, setBlocks] = useState<Block[]>(() => toBlocks(page?.sections ?? []));
  const [dirty, setDirty] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const upd = (patch: Partial<typeof f>) => { setF({ ...f, ...patch }); setDirty(true); };
  const m = useMutation({
    mutationFn: (status: "DRAFT" | "PUBLISHED") => {
      const body = {
        title: f.title.trim(), slug: f.slug.trim() || slugify(f.title), type: f.type, status,
        seoTitle: f.seoTitle.trim() || null, seoDescription: f.seoDescription.trim() || null, ogImageUrl: f.ogImageUrl.trim() || null,
        sections: fromBlocks(blocks),
      };
      return page ? api<CmsPage>(`/cms/pages/${page.id}`, { method: "PUT", body }) : api<CmsPage>("/cms/pages", { method: "POST", body });
    },
    onSuccess: (p, status) => {
      setErrors({});
      setDirty(false);
      setF((x) => ({ ...x, slug: p.slug, status }));
      toast.success(status === "PUBLISHED" ? `Published at /p/${p.slug}` : "Draft saved");
      qc.invalidateQueries({ queryKey: ["cms", "pages"] });
      qc.setQueryData(["cms", "page", p.id], p);
      if (!page) router.replace(`/admin/content/pages/${p.id}`);
    },
    onError: (e) => {
      const fe = fieldErrorsOf(e);
      setErrors(fe);
      const n = Object.keys(fe).length;
      toast.error(n ? `Please fix ${n} field${n === 1 ? "" : "s"}` : errorMessage(e));
    },
  });
  const slug = f.slug.trim() || slugify(f.title);

  return (
    <div className="space-y-4">
      <Link href="/admin/content?tab=pages" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> Pages</Link>
      <PageHeader
        title={page ? page.title : "New page"}
        description={page ? `Last saved ${dhakaDateTime(page.updatedAt)}${page.publishedAt ? ` · first published ${dhakaDateTime(page.publishedAt)}` : ""}` : "Build a page from sections. Save as a draft, then publish when it's ready."}
        actions={
          <>
            {dirty && <span className="text-xs text-amber-700">Unsaved changes</span>}
            {page && <Button variant="outline" size="sm" asChild><a href={`/p/${page.slug}`} target="_blank" rel="noreferrer"><ExternalLink className="size-4" /> Preview</a></Button>}
            <Button variant="outline" size="sm" disabled={m.isPending || !f.title.trim()} onClick={() => m.mutate("DRAFT")}>{f.status === "PUBLISHED" ? "Unpublish & save" : "Save draft"}</Button>
            <Button size="sm" disabled={m.isPending || !f.title.trim()} onClick={() => m.mutate("PUBLISHED")}>{m.isPending && <Loader2 className="size-4 animate-spin" />} {f.status === "PUBLISHED" ? "Save & keep live" : "Publish"}</Button>
          </>
        }
      >
        <div className="mt-2">{f.status === "PUBLISHED" ? <Pill tone="green">Published</Pill> : <Pill tone="gray">Draft</Pill>}</div>
      </PageHeader>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Section title={`Sections (${blocks.length})`}>
          <SectionBuilder blocks={blocks} onChange={(b) => { setBlocks(b); setDirty(true); }} errors={errors} />
        </Section>
        <div className="space-y-4">
          <Section title="Page">
            <div className="space-y-3">
              <Field label="Title *" htmlFor="pg-title" error={errors.title}><Input id="pg-title" value={f.title} onChange={(e) => upd({ title: e.target.value })} /></Field>
              <Field label="URL slug" htmlFor="pg-slug" error={errors.slug} hint={<>Public address: <span className="font-mono">/p/{slug || "…"}</span></>}>
                <Input id="pg-slug" className="font-mono text-sm" value={f.slug} placeholder={slugify(f.title)} onChange={(e) => upd({ slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-") })} />
              </Field>
              <Field label="Type" htmlFor="pg-type" error={errors.type}>
                <NativeSelect id="pg-type" value={f.type} onChange={(e) => upd({ type: e.target.value as CmsPage["type"] })}>
                  <option value="LANDING">Landing page (campaigns, ads)</option>
                  <option value="PAGE">Page (About, Size guide…)</option>
                  <option value="POLICY">Policy (Returns, Privacy…)</option>
                </NativeSelect>
              </Field>
              {page && page.slug !== slug && page.status === "PUBLISHED" && <p className="text-xs text-amber-700">Changing the slug breaks existing links to /p/{page.slug}.</p>}
            </div>
          </Section>
          <Section title="SEO & sharing">
            <div className="space-y-3">
              <Field label="SEO title" htmlFor="pg-seot" error={errors.seoTitle} hint={`${f.seoTitle.length}/60 recommended`}><Input id="pg-seot" value={f.seoTitle} placeholder={f.title} onChange={(e) => upd({ seoTitle: e.target.value })} /></Field>
              <Field label="Meta description" htmlFor="pg-seod" error={errors.seoDescription} hint={`${f.seoDescription.length}/160 recommended`}><Textarea id="pg-seod" rows={3} value={f.seoDescription} onChange={(e) => upd({ seoDescription: e.target.value })} /></Field>
              <Field label="Social share image" htmlFor="pg-og" error={errors.ogImageUrl} hint="1200×630 works best for Facebook"><ImageField id="pg-og" value={f.ogImageUrl} onChange={(ogImageUrl) => upd({ ogImageUrl })} /></Field>
            </div>
          </Section>
          {errors.sections && <p className="text-sm text-red-600">{errors.sections}</p>}
        </div>
      </div>
    </div>
  );
}

export default function PageEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { can } = useAuth();
  const isNew = id === "new";
  const q = useQuery({ queryKey: ["cms", "page", id], queryFn: () => api<CmsPage>(`/cms/pages/${id}`), enabled: !isNew && can("cms.manage") });
  if (!can("cms.manage")) return <Forbidden what="storefront content" />;
  if (isNew) return <Editor page={null} />;
  if (q.isLoading) return <LoadingRows rows={6} />;
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  return <Editor key={q.data.id} page={q.data} />;
}
