"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ExternalLink, Loader2, Pencil, Plus, Star, Trash2 } from "lucide-react";
import { api, errorMessage, request } from "@/lib/api";
import { dhakaDateTime, dhakaDay } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ConfirmDialog, EmptyState, ErrorState, Field, LoadingRows, NativeSelect, Pagination, Pill, Section } from "@/components/admin/ui";
import { dhakaLocalToIso, fieldErrorsOf, ImageField, isoToDhakaLocal, TableShell, TD, TH, ToggleRow } from "./common";
import { useCollections } from "./pickers";

// ───────────── generic dialog shell for simple CMS records ─────────────

function useCmsSave(path: string, queryKey: string, onDone: () => void) {
  const qc = useQueryClient();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const m = useMutation({
    mutationFn: ({ id, body }: { id?: string; body: Record<string, unknown> }) => api(id ? `${path}/${id}` : path, { method: id ? "PUT" : "POST", body }),
    onSuccess: () => { toast.success("Saved"); qc.invalidateQueries({ queryKey: ["cms", queryKey] }); setErrors({}); onDone(); },
    onError: (e) => { setErrors(fieldErrorsOf(e)); toast.error(errorMessage(e)); },
  });
  return { save: m.mutate, saving: m.isPending, errors };
}

function EditDialog({ title, children, onClose, onSave, saving, disabled }: { title: string; children: ReactNode; onClose: () => void; onSave: () => void; saving: boolean; disabled?: boolean }) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        {children}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={saving || disabled} onClick={onSave}>{saving && <Loader2 className="size-4 animate-spin" />} Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function useDelete(path: string, queryKey: string) {
  const qc = useQueryClient();
  return async (id: string) => {
    await api(`${path}/${id}`, { method: "DELETE" });
    toast.success("Deleted");
    qc.invalidateQueries({ queryKey: ["cms", queryKey] });
  };
}

const orNull = (v: string) => (v.trim() ? v.trim() : null);

// ───────────── banners ─────────────

interface Banner { id: string; title: string; subtitle: string | null; imageUrl: string; mobileImageUrl: string | null; linkUrl: string | null; ctaLabel: string | null; placement: string; sortOrder: number; isActive: boolean; startsAt: string | null; endsAt: string | null }
const PLACEMENTS = ["HOME_HERO", "HOME_STRIP", "HOME_PROMO", "CATEGORY_TOP", "CHECKOUT"];

function BannerDialog({ banner, onClose }: { banner: Banner | "new"; onClose: () => void }) {
  const b = banner === "new" ? null : banner;
  const [f, setF] = useState({
    title: b?.title ?? "", subtitle: b?.subtitle ?? "", imageUrl: b?.imageUrl ?? "", mobileImageUrl: b?.mobileImageUrl ?? "", linkUrl: b?.linkUrl ?? "", ctaLabel: b?.ctaLabel ?? "",
    placement: b?.placement ?? "HOME_HERO", sortOrder: String(b?.sortOrder ?? 0), isActive: b?.isActive ?? true, startsAt: isoToDhakaLocal(b?.startsAt), endsAt: isoToDhakaLocal(b?.endsAt),
  });
  const { save, saving, errors } = useCmsSave("/cms/banners", "banners", onClose);
  const badRange = f.startsAt && f.endsAt && f.endsAt <= f.startsAt;
  return (
    <EditDialog title={b ? "Edit banner" : "New banner"} onClose={onClose} saving={saving} disabled={!f.title.trim() || !f.imageUrl.trim() || !!badRange || !/^[A-Z0-9_]{2,40}$/.test(f.placement)}
      onSave={() => save({ id: b?.id, body: {
        title: f.title.trim(), subtitle: orNull(f.subtitle), imageUrl: f.imageUrl.trim(), mobileImageUrl: orNull(f.mobileImageUrl), linkUrl: orNull(f.linkUrl), ctaLabel: orNull(f.ctaLabel),
        placement: f.placement, sortOrder: Number(f.sortOrder) || 0, isActive: f.isActive, startsAt: dhakaLocalToIso(f.startsAt), endsAt: dhakaLocalToIso(f.endsAt),
      } })}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Title *" htmlFor="bn-title" error={errors.title}><Input id="bn-title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        <Field label="Subtitle" htmlFor="bn-sub" error={errors.subtitle}><Input id="bn-sub" value={f.subtitle} onChange={(e) => setF({ ...f, subtitle: e.target.value })} /></Field>
        <div className="sm:col-span-2"><Field label="Image * (desktop)" htmlFor="bn-img" error={errors.imageUrl} hint="Recommended 1920×700"><ImageField id="bn-img" value={f.imageUrl} onChange={(imageUrl) => setF({ ...f, imageUrl })} /></Field></div>
        <div className="sm:col-span-2"><Field label="Mobile image" htmlFor="bn-mimg" error={errors.mobileImageUrl} hint="Recommended 800×1000; falls back to the desktop image"><ImageField id="bn-mimg" value={f.mobileImageUrl} onChange={(mobileImageUrl) => setF({ ...f, mobileImageUrl })} /></Field></div>
        <Field label="Link" htmlFor="bn-link" error={errors.linkUrl} hint="e.g. /collections/eid or https://…"><Input id="bn-link" value={f.linkUrl} onChange={(e) => setF({ ...f, linkUrl: e.target.value })} /></Field>
        <Field label="Button label" htmlFor="bn-cta" error={errors.ctaLabel}><Input id="bn-cta" value={f.ctaLabel} onChange={(e) => setF({ ...f, ctaLabel: e.target.value })} placeholder="Shop now" /></Field>
        <Field label="Placement" htmlFor="bn-pl" error={errors.placement} hint="Where the storefront shows it (UPPER_SNAKE_CASE)">
          <Input id="bn-pl" list="bn-placements" value={f.placement} onChange={(e) => setF({ ...f, placement: e.target.value.toUpperCase() })} />
          <datalist id="bn-placements">{PLACEMENTS.map((p) => <option key={p} value={p} />)}</datalist>
        </Field>
        <Field label="Sort order" htmlFor="bn-sort" error={errors.sortOrder} hint="Lower shows first"><Input id="bn-sort" type="number" value={f.sortOrder} onChange={(e) => setF({ ...f, sortOrder: e.target.value })} /></Field>
        <Field label="Show from (Dhaka time)" htmlFor="bn-start" error={errors.startsAt}><Input id="bn-start" type="datetime-local" value={f.startsAt} onChange={(e) => setF({ ...f, startsAt: e.target.value })} /></Field>
        <Field label="Show until (Dhaka time)" htmlFor="bn-end" error={errors.endsAt ?? (badRange ? "Must be after the start" : undefined)}><Input id="bn-end" type="datetime-local" value={f.endsAt} onChange={(e) => setF({ ...f, endsAt: e.target.value })} /></Field>
        <div className="sm:col-span-2"><ToggleRow id="bn-active" label="Active" checked={f.isActive} onChange={(isActive) => setF({ ...f, isActive })} description="Inactive banners are never shown, even inside their schedule." /></div>
      </div>
    </EditDialog>
  );
}

function scheduleState(b: Banner) {
  const now = new Date().toISOString();
  if (!b.isActive) return <Pill tone="gray">Inactive</Pill>;
  if (b.startsAt && b.startsAt > now) return <Pill tone="sky">Scheduled</Pill>;
  if (b.endsAt && b.endsAt <= now) return <Pill tone="gray">Ended</Pill>;
  return <Pill tone="green">Live</Pill>;
}

export function BannersTab() {
  const [placement, setPlacement] = useState("");
  const [page, setPage] = useState(1);
  const q = useQuery({ queryKey: ["cms", "banners", placement, page], queryFn: () => request<Banner[]>("/cms/banners", { query: { placement, page, pageSize: 25 } }), placeholderData: keepPreviousData });
  const [edit, setEdit] = useState<Banner | "new" | null>(null);
  const [del, setDel] = useState<Banner | null>(null);
  const remove = useDelete("/cms/banners", "banners");
  return (
    <Section title="Banners" actions={<div className="flex gap-2"><NativeSelect className="h-8 w-40" aria-label="Placement" value={placement} onChange={(e) => { setPlacement(e.target.value); setPage(1); }}><option value="">All placements</option>{PLACEMENTS.map((p) => <option key={p} value={p}>{p}</option>)}</NativeSelect><Button size="sm" onClick={() => setEdit("new")}><Plus className="size-4" /> New banner</Button></div>}>
      {q.isLoading ? <LoadingRows rows={3} /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !q.data?.data.length ? <EmptyState title="No banners" description="Banners appear on the storefront home page and other placements." action={<Button size="sm" onClick={() => setEdit("new")}>Create a banner</Button>} /> : (
        <>
          <ul className="space-y-2">
            {q.data.data.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center gap-3 rounded-lg border bg-white p-2">
                <img src={b.imageUrl} alt="" className="h-16 w-32 rounded object-cover" />
                <div className="min-w-48 flex-1">
                  <div className="flex flex-wrap items-center gap-2 font-medium">{b.title} {scheduleState(b)}</div>
                  <div className="text-xs text-muted-foreground">{b.placement} · order {b.sortOrder}{b.linkUrl ? ` · → ${b.linkUrl}` : ""}</div>
                  {(b.startsAt || b.endsAt) && <div className="text-xs text-muted-foreground">{b.startsAt ? dhakaDateTime(b.startsAt) : "now"} → {b.endsAt ? dhakaDateTime(b.endsAt) : "no end"}</div>}
                </div>
                <Button size="icon" variant="ghost" className="size-8" aria-label={`Edit ${b.title}`} onClick={() => setEdit(b)}><Pencil className="size-4" /></Button>
                <Button size="icon" variant="ghost" className="size-8 text-red-700" aria-label={`Delete ${b.title}`} onClick={() => setDel(b)}><Trash2 className="size-4" /></Button>
              </li>
            ))}
          </ul>
          <Pagination meta={q.data.meta} onPage={setPage} />
        </>
      )}
      {edit && <BannerDialog banner={edit} onClose={() => setEdit(null)} />}
      <ConfirmDialog open={!!del} onOpenChange={(o) => !o && setDel(null)} title={`Delete banner “${del?.title}”?`} destructive confirmLabel="Delete" onConfirm={() => remove(del!.id)} />
    </Section>
  );
}

// ───────────── pages list ─────────────

interface PageRow { id: string; slug: string; title: string; type: string; status: string; publishedAt: string | null; updatedAt: string }

export function PagesTab() {
  const [f, setF] = useState({ type: "", status: "", search: "", page: 1 });
  const [search, setSearch] = useState("");
  const q = useQuery({ queryKey: ["cms", "pages", f], queryFn: () => request<PageRow[]>("/cms/pages", { query: { ...f, pageSize: 25 } }), placeholderData: keepPreviousData });
  const [del, setDel] = useState<PageRow | null>(null);
  const remove = useDelete("/cms/pages", "pages");
  return (
    <Section title="Pages & landing pages" actions={<Button size="sm" asChild><Link href="/admin/content/pages/new"><Plus className="size-4" /> New page</Link></Button>}>
      <div className="mb-3 flex flex-wrap gap-2">
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); setF({ ...f, search: search.trim(), page: 1 }); }}>
          <Input className="h-8 w-56" placeholder="Search title or slug" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search pages" />
          <Button type="submit" size="sm" variant="outline" className="h-8">Search</Button>
        </form>
        <NativeSelect className="h-8 w-36" aria-label="Type" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value, page: 1 })}><option value="">All types</option><option value="PAGE">Pages</option><option value="LANDING">Landing pages</option><option value="POLICY">Policies</option></NativeSelect>
        <NativeSelect className="h-8 w-36" aria-label="Status" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value, page: 1 })}><option value="">Any status</option><option value="PUBLISHED">Published</option><option value="DRAFT">Draft</option></NativeSelect>
      </div>
      {q.isLoading ? <LoadingRows rows={3} /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !q.data?.data.length ? <EmptyState title="No pages yet" description="Create landing pages for campaigns, or policy pages like Returns & Refunds." /> : (
        <>
          <TableShell minWidth={680}>
            <thead><tr><th className={TH}>Title</th><th className={TH}>Type</th><th className={TH}>Status</th><th className={TH}>Updated</th><th className={TH}><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {q.data.data.map((p) => (
                <tr key={p.id} className="hover:bg-muted/30">
                  <td className={TD}><Link href={`/admin/content/pages/${p.id}`} className="font-medium text-blue-700 hover:underline">{p.title}</Link><div className="font-mono text-xs text-muted-foreground">/p/{p.slug}</div></td>
                  <td className={TD}>{p.type.toLowerCase()}</td>
                  <td className={TD}>{p.status === "PUBLISHED" ? <Pill tone="green">Published</Pill> : <Pill tone="gray">Draft</Pill>}{p.publishedAt && <div className="text-[11px] text-muted-foreground">since {dhakaDay(p.publishedAt)}</div>}</td>
                  <td className={cn(TD, "whitespace-nowrap text-xs")}>{dhakaDateTime(p.updatedAt)}</td>
                  <td className={cn(TD, "whitespace-nowrap text-right")}>
                    <Button size="icon" variant="ghost" className="size-8" asChild aria-label={`Preview ${p.title}`}><a href={`/p/${p.slug}`} target="_blank" rel="noreferrer"><ExternalLink className="size-4" /></a></Button>
                    <Button size="icon" variant="ghost" className="size-8" asChild aria-label={`Edit ${p.title}`}><Link href={`/admin/content/pages/${p.id}`}><Pencil className="size-4" /></Link></Button>
                    <Button size="icon" variant="ghost" className="size-8 text-red-700" aria-label={`Delete ${p.title}`} onClick={() => setDel(p)}><Trash2 className="size-4" /></Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </TableShell>
          <Pagination meta={q.data.meta} onPage={(page) => setF({ ...f, page })} />
        </>
      )}
      <ConfirmDialog open={!!del} onOpenChange={(o) => !o && setDel(null)} title={`Delete page “${del?.title}”?`} description={`/p/${del?.slug} will stop working. Links to it from ads or social posts will break.`} destructive confirmLabel="Delete page" onConfirm={() => remove(del!.id)} />
    </Section>
  );
}

// ───────────── testimonials ─────────────

interface Testimonial { id: string; name: string; location: string | null; quote: string; rating: number; imageUrl: string | null; isActive: boolean; sortOrder: number }

function TestimonialDialog({ t, onClose }: { t: Testimonial | "new"; onClose: () => void }) {
  const x = t === "new" ? null : t;
  const [f, setF] = useState({ name: x?.name ?? "", location: x?.location ?? "", quote: x?.quote ?? "", rating: x?.rating ?? 5, imageUrl: x?.imageUrl ?? "", isActive: x?.isActive ?? true, sortOrder: String(x?.sortOrder ?? 0) });
  const { save, saving, errors } = useCmsSave("/cms/testimonials", "testimonials", onClose);
  return (
    <EditDialog title={x ? "Edit testimonial" : "New testimonial"} onClose={onClose} saving={saving} disabled={!f.name.trim() || !f.quote.trim()}
      onSave={() => save({ id: x?.id, body: { name: f.name.trim(), location: orNull(f.location), quote: f.quote.trim(), rating: f.rating, imageUrl: orNull(f.imageUrl), isActive: f.isActive, sortOrder: Number(f.sortOrder) || 0 } })}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Customer name *" htmlFor="t-name" error={errors.name}><Input id="t-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Location" htmlFor="t-loc" error={errors.location}><Input id="t-loc" value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} placeholder="Dhanmondi, Dhaka" /></Field>
        <div className="sm:col-span-2"><Field label="Quote * (English or Bangla)" htmlFor="t-quote" error={errors.quote}><Textarea id="t-quote" rows={4} value={f.quote} onChange={(e) => setF({ ...f, quote: e.target.value })} /></Field></div>
        <Field label="Rating">
          <div className="flex gap-1" role="radiogroup" aria-label="Rating">
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} type="button" role="radio" aria-checked={f.rating === n} aria-label={`${n} star${n > 1 ? "s" : ""}`} onClick={() => setF({ ...f, rating: n })}>
                <Star className={cn("size-6", n <= f.rating ? "fill-amber-400 text-amber-400" : "text-slate-300")} />
              </button>
            ))}
          </div>
        </Field>
        <Field label="Sort order" htmlFor="t-sort"><Input id="t-sort" type="number" value={f.sortOrder} onChange={(e) => setF({ ...f, sortOrder: e.target.value })} /></Field>
        <div className="sm:col-span-2"><Field label="Photo" htmlFor="t-img" error={errors.imageUrl}><ImageField id="t-img" value={f.imageUrl} onChange={(imageUrl) => setF({ ...f, imageUrl })} /></Field></div>
        <div className="sm:col-span-2"><ToggleRow id="t-active" label="Show on the storefront" checked={f.isActive} onChange={(isActive) => setF({ ...f, isActive })} /></div>
      </div>
    </EditDialog>
  );
}

export function TestimonialsTab() {
  const [page, setPage] = useState(1);
  const q = useQuery({ queryKey: ["cms", "testimonials", page], queryFn: () => request<Testimonial[]>("/cms/testimonials", { query: { page, pageSize: 25 } }), placeholderData: keepPreviousData });
  const [edit, setEdit] = useState<Testimonial | "new" | null>(null);
  const [del, setDel] = useState<Testimonial | null>(null);
  const remove = useDelete("/cms/testimonials", "testimonials");
  return (
    <Section title="Testimonials" actions={<Button size="sm" onClick={() => setEdit("new")}><Plus className="size-4" /> New testimonial</Button>}>
      {q.isLoading ? <LoadingRows rows={3} /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !q.data?.data.length ? <EmptyState title="No testimonials" description="Add real customer reviews (with their permission) to build trust." /> : (
        <>
          <ul className="grid gap-3 md:grid-cols-2">
            {q.data.data.map((t) => (
              <li key={t.id} className={cn("flex gap-3 rounded-lg border bg-white p-3", !t.isActive && "opacity-60")}>
                {t.imageUrl ? <img src={t.imageUrl} alt="" className="size-12 shrink-0 rounded-full object-cover" /> : <div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-muted font-semibold">{t.name.slice(0, 1)}</div>}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{t.name}</span><span className="text-xs text-amber-500" aria-label={`${t.rating} of 5`}>{"★".repeat(t.rating)}<span className="text-slate-300">{"★".repeat(5 - t.rating)}</span></span>{!t.isActive && <Pill tone="gray">hidden</Pill>}</div>
                  {t.location && <div className="text-xs text-muted-foreground">{t.location}</div>}
                  <p className="mt-1 line-clamp-3 text-sm">“{t.quote}”</p>
                </div>
                <div className="flex flex-col">
                  <Button size="icon" variant="ghost" className="size-8" aria-label={`Edit ${t.name}`} onClick={() => setEdit(t)}><Pencil className="size-4" /></Button>
                  <Button size="icon" variant="ghost" className="size-8 text-red-700" aria-label={`Delete ${t.name}`} onClick={() => setDel(t)}><Trash2 className="size-4" /></Button>
                </div>
              </li>
            ))}
          </ul>
          <Pagination meta={q.data.meta} onPage={setPage} />
        </>
      )}
      {edit && <TestimonialDialog t={edit} onClose={() => setEdit(null)} />}
      <ConfirmDialog open={!!del} onOpenChange={(o) => !o && setDel(null)} title={`Delete ${del?.name}'s testimonial?`} destructive confirmLabel="Delete" onConfirm={() => remove(del!.id)} />
    </Section>
  );
}

// ───────────── FAQs ─────────────

interface Faq { id: string; question: string; answer: string; category: string | null; sortOrder: number; isActive: boolean }

function FaqDialog({ faq, categories, onClose }: { faq: Faq | "new"; categories: string[]; onClose: () => void }) {
  const x = faq === "new" ? null : faq;
  const [f, setF] = useState({ question: x?.question ?? "", answer: x?.answer ?? "", category: x?.category ?? "", sortOrder: String(x?.sortOrder ?? 0), isActive: x?.isActive ?? true });
  const { save, saving, errors } = useCmsSave("/cms/faqs", "faqs", onClose);
  return (
    <EditDialog title={x ? "Edit FAQ" : "New FAQ"} onClose={onClose} saving={saving} disabled={!f.question.trim() || !f.answer.trim()}
      onSave={() => save({ id: x?.id, body: { question: f.question.trim(), answer: f.answer.trim(), category: orNull(f.category), sortOrder: Number(f.sortOrder) || 0, isActive: f.isActive } })}>
      <div className="space-y-3">
        <Field label="Question *" htmlFor="fq-q" error={errors.question}><Input id="fq-q" value={f.question} onChange={(e) => setF({ ...f, question: e.target.value })} /></Field>
        <Field label="Answer *" htmlFor="fq-a" error={errors.answer} hint="Markdown supported"><Textarea id="fq-a" rows={6} value={f.answer} onChange={(e) => setF({ ...f, answer: e.target.value })} /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Category" htmlFor="fq-c" error={errors.category} hint="Group FAQs, e.g. Delivery, Returns"><Input id="fq-c" list="faq-cats" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} /><datalist id="faq-cats">{categories.map((c) => <option key={c} value={c} />)}</datalist></Field>
          <Field label="Sort order" htmlFor="fq-s"><Input id="fq-s" type="number" value={f.sortOrder} onChange={(e) => setF({ ...f, sortOrder: e.target.value })} /></Field>
        </div>
        <ToggleRow id="fq-active" label="Show on the storefront" checked={f.isActive} onChange={(isActive) => setF({ ...f, isActive })} />
      </div>
    </EditDialog>
  );
}

export function FaqsTab() {
  const [category, setCategory] = useState("");
  const [page, setPage] = useState(1);
  const q = useQuery({ queryKey: ["cms", "faqs", category, page], queryFn: () => request<Faq[]>("/cms/faqs", { query: { category, page, pageSize: 50 } }), placeholderData: keepPreviousData });
  const all = useQuery({ queryKey: ["cms", "faqs", "categories"], queryFn: () => api<Faq[]>("/cms/faqs", { query: { pageSize: 200 } }) });
  const categories = [...new Set((all.data ?? []).map((f) => f.category).filter(Boolean) as string[])].sort();
  const [edit, setEdit] = useState<Faq | "new" | null>(null);
  const [del, setDel] = useState<Faq | null>(null);
  const remove = useDelete("/cms/faqs", "faqs");
  return (
    <Section title="FAQs" actions={<div className="flex gap-2"><NativeSelect className="h-8 w-40" aria-label="Category" value={category} onChange={(e) => { setCategory(e.target.value); setPage(1); }}><option value="">All categories</option>{categories.map((c) => <option key={c} value={c}>{c}</option>)}</NativeSelect><Button size="sm" onClick={() => setEdit("new")}><Plus className="size-4" /> New FAQ</Button></div>}>
      {q.isLoading ? <LoadingRows rows={3} /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !q.data?.data.length ? <EmptyState title="No FAQs" description="Answer common questions about delivery, COD, returns and fabric care." /> : (
        <>
          <ul className="divide-y rounded-lg border bg-white">
            {q.data.data.map((x) => (
              <li key={x.id} className={cn("flex items-start gap-2 p-3", !x.isActive && "opacity-60")}>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 font-medium">{x.question}{x.category && <Pill tone="indigo">{x.category}</Pill>}{!x.isActive && <Pill tone="gray">hidden</Pill>}</div>
                  <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">{x.answer}</p>
                </div>
                <Button size="icon" variant="ghost" className="size-8" aria-label="Edit FAQ" onClick={() => setEdit(x)}><Pencil className="size-4" /></Button>
                <Button size="icon" variant="ghost" className="size-8 text-red-700" aria-label="Delete FAQ" onClick={() => setDel(x)}><Trash2 className="size-4" /></Button>
              </li>
            ))}
          </ul>
          <Pagination meta={q.data.meta} onPage={setPage} />
        </>
      )}
      {edit && <FaqDialog faq={edit} categories={categories} onClose={() => setEdit(null)} />}
      <ConfirmDialog open={!!del} onOpenChange={(o) => !o && setDel(null)} title="Delete this FAQ?" description={del?.question} destructive confirmLabel="Delete" onConfirm={() => remove(del!.id)} />
    </Section>
  );
}

// ───────────── content settings ─────────────

interface ContentSettings {
  announcementBar: { enabled: boolean; text: string; textBn: string; link: string };
  footer: { about: string; facebookUrl: string; instagramUrl: string; whatsapp: string };
  homepage: { featuredCollectionSlugs: string[] };
  contact: { phone: string; email: string; address: string };
}

function ContentSettingsForm({ v }: { v: ContentSettings }) {
  const qc = useQueryClient();
  const collections = useCollections();
  const [f, setF] = useState(v);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const m = useMutation({
    mutationFn: () => api("/cms/settings", { method: "PUT", body: f }),
    onSuccess: () => { toast.success("Content settings saved"); setErrors({}); qc.invalidateQueries({ queryKey: ["cms", "settings"] }); qc.invalidateQueries({ queryKey: ["settings"] }); },
    onError: (e) => { setErrors(fieldErrorsOf(e)); toast.error(errorMessage(e)); },
  });
  const set = <K extends keyof ContentSettings>(k: K, patch: Partial<ContentSettings[K]>) => setF({ ...f, [k]: { ...f[k], ...patch } });
  const featured = f.homepage.featuredCollectionSlugs;
  return (
    <div className="space-y-4">
      <Section title="Announcement bar">
        <ToggleRow id="ab-on" label="Show the announcement bar" checked={f.announcementBar.enabled} onChange={(enabled) => set("announcementBar", { enabled })} description="A thin strip at the top of every storefront page." />
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          <Field label="Text (English)" htmlFor="ab-en" error={errors["announcementBar.text"]}><Input id="ab-en" maxLength={300} value={f.announcementBar.text} onChange={(e) => set("announcementBar", { text: e.target.value })} placeholder="Free delivery inside Dhaka on orders over ৳3000" /></Field>
          <Field label="Text (বাংলা)" htmlFor="ab-bn" error={errors["announcementBar.textBn"]}><Input id="ab-bn" lang="bn" maxLength={300} value={f.announcementBar.textBn} onChange={(e) => set("announcementBar", { textBn: e.target.value })} placeholder="ঢাকার ভিতরে ৳৩০০০+ অর্ডারে ফ্রি ডেলিভারি" /></Field>
          <Field label="Link (optional)" htmlFor="ab-link" error={errors["announcementBar.link"]}><Input id="ab-link" value={f.announcementBar.link} onChange={(e) => set("announcementBar", { link: e.target.value })} placeholder="/p/eid-offer" /></Field>
        </div>
      </Section>
      <Section title="Homepage featured collections">
        <p className="mb-2 text-xs text-muted-foreground">Collections shown on the home page, in this order (max 20).</p>
        {featured.length > 0 && (
          <ol className="mb-2 space-y-1">
            {featured.map((slug, i) => (
              <li key={slug} className="flex items-center gap-2 rounded border bg-white px-2 py-1 text-sm">
                <span className="w-5 text-muted-foreground">{i + 1}.</span>
                <span className="flex-1">{collections.data?.find((c) => c.slug === slug)?.name ?? <span className="text-red-700">{slug} (missing)</span>}</span>
                <Button type="button" size="sm" variant="ghost" className="h-7 px-2" disabled={i === 0} aria-label="Move up" onClick={() => { const n = [...featured]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; set("homepage", { featuredCollectionSlugs: n }); }}>↑</Button>
                <Button type="button" size="icon" variant="ghost" className="size-7" aria-label={`Remove ${slug}`} onClick={() => set("homepage", { featuredCollectionSlugs: featured.filter((s) => s !== slug) })}><Trash2 className="size-3.5" /></Button>
              </li>
            ))}
          </ol>
        )}
        <NativeSelect className="max-w-xs" aria-label="Add collection" value="" onChange={(e) => e.target.value && set("homepage", { featuredCollectionSlugs: [...featured, e.target.value] })} disabled={featured.length >= 20}>
          <option value="">Add a collection…</option>
          {collections.data?.filter((c) => !featured.includes(c.slug)).map((c) => <option key={c.id} value={c.slug}>{c.name}{c.isActive ? "" : " (inactive)"}</option>)}
        </NativeSelect>
      </Section>
      <Section title="Footer & social links">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2"><Field label="About text" htmlFor="ft-about" error={errors["footer.about"]}><Textarea id="ft-about" rows={3} value={f.footer.about} onChange={(e) => set("footer", { about: e.target.value })} /></Field></div>
          <Field label="Facebook page URL" htmlFor="ft-fb" error={errors["footer.facebookUrl"]}><Input id="ft-fb" value={f.footer.facebookUrl} onChange={(e) => set("footer", { facebookUrl: e.target.value })} placeholder="https://facebook.com/…" /></Field>
          <Field label="Instagram URL" htmlFor="ft-ig" error={errors["footer.instagramUrl"]}><Input id="ft-ig" value={f.footer.instagramUrl} onChange={(e) => set("footer", { instagramUrl: e.target.value })} placeholder="https://instagram.com/…" /></Field>
          <Field label="WhatsApp number" htmlFor="ft-wa" error={errors["footer.whatsapp"]}><Input id="ft-wa" value={f.footer.whatsapp} onChange={(e) => set("footer", { whatsapp: e.target.value })} placeholder="01XXXXXXXXX" /></Field>
        </div>
      </Section>
      <Section title="Contact information">
        <p className="mb-2 text-xs text-muted-foreground">Shown on the storefront and invoices (same as Settings → Store info).</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Phone" htmlFor="ct-phone" error={errors["contact.phone"]}><Input id="ct-phone" value={f.contact.phone} onChange={(e) => set("contact", { phone: e.target.value })} /></Field>
          <Field label="Email" htmlFor="ct-email" error={errors["contact.email"]}><Input id="ct-email" type="email" value={f.contact.email} onChange={(e) => set("contact", { email: e.target.value })} /></Field>
          <div className="sm:col-span-2"><Field label="Address" htmlFor="ct-addr" error={errors["contact.address"]}><Textarea id="ct-addr" rows={2} value={f.contact.address} onChange={(e) => set("contact", { address: e.target.value })} /></Field></div>
        </div>
      </Section>
      <div className="flex justify-end"><Button onClick={() => m.mutate()} disabled={m.isPending}>{m.isPending && <Loader2 className="size-4 animate-spin" />} Save content settings</Button></div>
    </div>
  );
}

export function ContentSettingsTab() {
  const q = useQuery({ queryKey: ["cms", "settings"], queryFn: () => api<ContentSettings>("/cms/settings") });
  if (q.isLoading) return <LoadingRows rows={4} />;
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  return <ContentSettingsForm key={q.dataUpdatedAt} v={q.data} />;
}
