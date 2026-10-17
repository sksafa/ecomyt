"use client";

import { useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Copy, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Field, NativeSelect } from "@/components/admin/ui";
import { ImageField, dhakaLocalToIso, isoToDhakaLocal } from "./common";
import { CollectionSelect, ProductPicker } from "./pickers";

/** A section block as edited in the UI; `_k` is a client-only React key. */
export type Block = { _k: string; type: string } & Record<string, unknown>;

export const BLOCK_TYPES: { type: string; label: string; desc: string; init: Record<string, unknown> }[] = [
  { type: "hero", label: "Hero", desc: "Big headline with image and button", init: { title: "", subtitle: "", imageUrl: "", ctaLabel: "", ctaUrl: "" } },
  { type: "rich_text", label: "Rich text", desc: "Paragraphs, lists, links (Markdown or HTML)", init: { markdown: "" } },
  { type: "product_grid", label: "Product grid", desc: "Products from a collection or hand-picked", init: { title: "", collectionSlug: "", productIds: [], limit: 8 } },
  { type: "image_banner", label: "Image banner", desc: "Full-width image with optional link", init: { imageUrl: "", mobileImageUrl: "", alt: "", linkUrl: "", title: "" } },
  { type: "testimonials", label: "Testimonials", desc: "Customer reviews from the Testimonials tab", init: { title: "", limit: 6 } },
  { type: "faq", label: "FAQ", desc: "Questions from the FAQs tab", init: { title: "", category: "" } },
  { type: "countdown", label: "Countdown", desc: "Timer to a sale or launch", init: { title: "", endsAt: "" } },
  { type: "order_form", label: "Order form", desc: "Landing-page checkout for one product", init: { title: "", productId: "" } },
  { type: "features", label: "Features", desc: "Icon + text highlights (e.g. Free delivery)", init: { title: "", items: [{ icon: "", title: "", text: "" }] } },
  { type: "video", label: "YouTube video", desc: "Embedded video", init: { title: "", youtubeId: "" } },
];
const LABEL = Object.fromEntries(BLOCK_TYPES.map((b) => [b.type, b.label]));

let seq = 0;
export const newKey = () => `b${Date.now().toString(36)}${(seq++).toString(36)}`;
export const toBlocks = (sections: unknown): Block[] => (Array.isArray(sections) ? sections.map((s) => ({ ...(s as Record<string, unknown>), _k: newKey() }) as Block) : []);

/** Strip client keys and empty optional values before sending to the API. */
export function fromBlocks(blocks: Block[]) {
  return blocks.map(({ _k, ...b }) => {
    void _k;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(b)) {
      if (v === "" || v === null || v === undefined) continue;
      if (Array.isArray(v) && v.length === 0) continue;
      if (k === "items" && Array.isArray(v)) {
        out[k] = v.map((it: Record<string, string>) => Object.fromEntries(Object.entries(it).filter(([, x]) => x !== "")));
        continue;
      }
      out[k] = v;
    }
    return out;
  });
}

/** One-line summary for a collapsed block. */
function summary(b: Block) {
  const t = (b.title as string) || "";
  switch (b.type) {
    case "rich_text": return String(b.markdown ?? b.html ?? "").replace(/<[^>]+>/g, "").slice(0, 80) || "empty";
    case "product_grid": return `${t || "Products"} · ${b.collectionSlug ? `collection ${b.collectionSlug}` : `${(b.productIds as string[] | undefined)?.length ?? 0} picked`}`;
    case "image_banner": return t || (b.alt as string) || (b.imageUrl as string) || "no image";
    case "video": return `${t || "Video"} · ${b.youtubeId || "no id"}`;
    case "features": return `${t || "Features"} · ${(b.items as unknown[] | undefined)?.length ?? 0} items`;
    default: return t || "untitled";
  }
}

const ytId = (v: string) => v.match(/(?:v=|youtu\.be\/|embed\/|shorts\/)([A-Za-z0-9_-]{11})/)?.[1] ?? v.trim();

function BlockFields({ b, set, errors, prefix }: { b: Block; set: (patch: Record<string, unknown>) => void; errors: Record<string, string>; prefix: string }) {
  const err = (k: string) => errors[`${prefix}.${k}`];
  const s = (k: string) => String(b[k] ?? "");
  const text = (k: string, label: string, opts: { hint?: ReactNode; required?: boolean } = {}) => (
    <Field label={`${label}${opts.required ? " *" : ""}`} htmlFor={`${b._k}-${k}`} error={err(k)} hint={opts.hint}>
      <Input id={`${b._k}-${k}`} value={s(k)} onChange={(e) => set({ [k]: e.target.value })} />
    </Field>
  );
  const image = (k: string, label: string, required?: boolean) => (
    <Field label={`${label}${required ? " *" : ""}`} htmlFor={`${b._k}-${k}`} error={err(k)}><ImageField id={`${b._k}-${k}`} value={s(k)} onChange={(v) => set({ [k]: v })} /></Field>
  );
  const num = (k: string, label: string, max: number) => (
    <Field label={label} htmlFor={`${b._k}-${k}`} error={err(k)}><Input id={`${b._k}-${k}`} type="number" min={1} max={max} className="w-28" value={s(k)} onChange={(e) => set({ [k]: e.target.value ? Math.max(1, Math.min(max, Math.floor(Number(e.target.value)))) : undefined })} /></Field>
  );
  const anchor = <Field label="Anchor id (optional)" htmlFor={`${b._k}-id`} hint="For links like #order" error={err("id")}><Input id={`${b._k}-id`} className="font-mono text-xs" value={s("id")} onChange={(e) => set({ id: e.target.value.replace(/[^A-Za-z0-9_-]/g, "") })} /></Field>;

  switch (b.type) {
    case "hero":
      return <div className="grid gap-3 sm:grid-cols-2">{text("title", "Headline", { required: true })}{text("subtitle", "Subtitle")}<div className="sm:col-span-2">{image("imageUrl", "Background image")}</div>{text("ctaLabel", "Button label")}{text("ctaUrl", "Button link", { hint: "e.g. /products or #order" })}{anchor}</div>;
    case "rich_text": {
      const mode = b.html !== undefined && b.markdown === undefined ? "html" : "markdown";
      return (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm">
            Format
            <NativeSelect className="h-8 w-36" value={mode} onChange={(e) => { const cur = s(mode); set(e.target.value === "html" ? { html: cur, markdown: undefined } : { markdown: cur, html: undefined }); }} aria-label="Text format">
              <option value="markdown">Markdown</option>
              <option value="html">HTML</option>
            </NativeSelect>
          </div>
          <Field label="Content *" htmlFor={`${b._k}-${mode}`} error={err(mode) ?? err("")} hint="Scripts, inline event handlers and javascript: links are removed when published.">
            <Textarea id={`${b._k}-${mode}`} rows={8} className="font-mono text-xs" value={s(mode)} onChange={(e) => set({ [mode]: e.target.value })} />
          </Field>
          {anchor}
        </div>
      );
    }
    case "product_grid":
      return (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">{text("title", "Title")}<Field label="Collection" htmlFor={`${b._k}-col`} error={err("collectionSlug")}><CollectionSelect id={`${b._k}-col`} value={s("collectionSlug")} onChange={(v) => set({ collectionSlug: v })} /></Field>{num("limit", "Max products", 48)}</div>
          <Field label="…or hand-picked products" error={err("productIds") ?? err("")} hint="Use a collection, specific products, or both (picked products show first).">
            <ProductPicker value={(b.productIds as string[]) ?? []} onChange={(ids) => set({ productIds: ids })} />
          </Field>
          {anchor}
        </div>
      );
    case "image_banner":
      return <div className="grid gap-3 sm:grid-cols-2"><div className="sm:col-span-2">{image("imageUrl", "Image", true)}</div><div className="sm:col-span-2">{image("mobileImageUrl", "Mobile image (optional)")}</div>{text("alt", "Alt text", { hint: "Describe the image for screen readers" })}{text("linkUrl", "Link")}{text("title", "Title")}{anchor}</div>;
    case "testimonials":
      return <div className="grid gap-3 sm:grid-cols-3">{text("title", "Title")}{num("limit", "How many", 50)}{anchor}</div>;
    case "faq":
      return <div className="grid gap-3 sm:grid-cols-3">{text("title", "Title")}{text("category", "Only this FAQ category", { hint: "Empty = all FAQs" })}{anchor}</div>;
    case "countdown":
      return (
        <div className="grid gap-3 sm:grid-cols-3">
          {text("title", "Title", { required: true })}
          <Field label="Ends at (Dhaka time) *" htmlFor={`${b._k}-end`} error={err("endsAt")}>
            <Input id={`${b._k}-end`} type="datetime-local" value={isoToDhakaLocal(s("endsAt"))} onChange={(e) => set({ endsAt: dhakaLocalToIso(e.target.value) ?? "" })} />
          </Field>
          {anchor}
        </div>
      );
    case "order_form":
      return (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">{text("title", "Title", { hint: "e.g. অর্ডার করতে নিচের ফর্মটি পূরণ করুন" })}{anchor}</div>
          <Field label="Product *" error={err("productId")}><ProductPicker multiple={false} value={s("productId") ? [s("productId")] : []} onChange={(ids) => set({ productId: ids[0] ?? "" })} /></Field>
        </div>
      );
    case "features": {
      const items = (b.items as { icon?: string; title?: string; text?: string }[] | undefined) ?? [];
      const setItem = (i: number, patch: Record<string, string>) => set({ items: items.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
      return (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">{text("title", "Title")}{anchor}</div>
          {items.map((it, i) => (
            <div key={i} className="grid gap-2 rounded border bg-white p-2 sm:grid-cols-[110px_minmax(0,1fr)_minmax(0,2fr)_auto]">
              <Input placeholder="Icon (e.g. truck)" value={it.icon ?? ""} onChange={(e) => setItem(i, { icon: e.target.value })} aria-label={`Feature ${i + 1} icon`} />
              <Input placeholder="Title *" value={it.title ?? ""} onChange={(e) => setItem(i, { title: e.target.value })} aria-label={`Feature ${i + 1} title`} className={cn(err(`items.${i}.title`) && "border-red-400")} />
              <Input placeholder="Text" value={it.text ?? ""} onChange={(e) => setItem(i, { text: e.target.value })} aria-label={`Feature ${i + 1} text`} />
              <Button type="button" variant="ghost" size="icon" className="size-9" aria-label={`Remove feature ${i + 1}`} disabled={items.length <= 1} onClick={() => set({ items: items.filter((_, j) => j !== i) })}><Trash2 className="size-4" /></Button>
            </div>
          ))}
          {err("items") && <p className="text-xs text-red-600">{err("items")}</p>}
          <Button type="button" variant="outline" size="sm" disabled={items.length >= 12} onClick={() => set({ items: [...items, { icon: "", title: "", text: "" }] })}><Plus className="size-4" /> Add feature</Button>
        </div>
      );
    }
    case "video":
      return (
        <div className="grid gap-3 sm:grid-cols-3">
          {text("title", "Title")}
          <Field label="YouTube link or id *" htmlFor={`${b._k}-yt`} error={err("youtubeId")} hint={s("youtubeId") ? `id: ${s("youtubeId")}` : undefined}>
            <Input id={`${b._k}-yt`} value={s("youtubeId")} onChange={(e) => set({ youtubeId: ytId(e.target.value) })} placeholder="https://youtu.be/…" />
          </Field>
          {anchor}
        </div>
      );
    default:
      return <p className="text-sm text-amber-700">Unknown block type “{b.type}” — it will be kept as is.</p>;
  }
}

export function SectionBuilder({ blocks, onChange, errors }: { blocks: Block[]; onChange: (b: Block[]) => void; errors: Record<string, string> }) {
  const [open, setOpen] = useState<Set<string>>(() => new Set(blocks.length <= 2 ? blocks.map((b) => b._k) : []));
  const toggle = (k: string) => setOpen((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const move = (i: number, d: number) => { const n = [...blocks]; [n[i], n[i + d]] = [n[i + d], n[i]]; onChange(n); };
  const add = (type: string, at = blocks.length) => {
    const def = BLOCK_TYPES.find((t) => t.type === type)!;
    const b = { ...structuredClone(def.init), type, _k: newKey() } as Block;
    const n = [...blocks];
    n.splice(at, 0, b);
    onChange(n);
    setOpen((s) => new Set(s).add(b._k));
  };
  const addMenu = (at?: number, label = "Add block") => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild><Button type="button" variant="outline" size="sm" disabled={blocks.length >= 50}><Plus className="size-4" /> {label}</Button></DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        {BLOCK_TYPES.map((t) => (
          <DropdownMenuItem key={t.type} onClick={() => add(t.type, at)} className="flex-col items-start gap-0">
            <span className="font-medium">{t.label}</span><span className="text-xs text-muted-foreground">{t.desc}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
  const blockErrorCount = (i: number) => Object.keys(errors).filter((k) => k === `sections.${i}` || k.startsWith(`sections.${i}.`)).length;

  return (
    <div className="space-y-2">
      {blocks.length === 0 && <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">No sections yet. Add a hero, product grid or order form to build the page.</p>}
      {blocks.map((b, i) => {
        const isOpen = open.has(b._k);
        const errs = blockErrorCount(i);
        return (
          <div key={b._k} className={cn("rounded-lg border bg-slate-50/60", errs && "border-red-300")}>
            <div className="flex items-center gap-1 px-2 py-1.5">
              <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => toggle(b._k)} aria-expanded={isOpen}>
                {isOpen ? <ChevronDown className="size-4 shrink-0" /> : <ChevronRight className="size-4 shrink-0" />}
                <span className="shrink-0 rounded bg-white px-1.5 py-0.5 text-xs font-semibold ring-1 ring-border">{i + 1}. {LABEL[b.type] ?? b.type}</span>
                <span className="truncate text-sm text-muted-foreground">{summary(b)}</span>
                {errs > 0 && <span className="shrink-0 text-xs text-red-600">{errs} error{errs === 1 ? "" : "s"}</span>}
              </button>
              <Button type="button" variant="ghost" size="icon" className="size-8" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move block ${i + 1} up`}><ArrowUp className="size-4" /></Button>
              <Button type="button" variant="ghost" size="icon" className="size-8" disabled={i === blocks.length - 1} onClick={() => move(i, 1)} aria-label={`Move block ${i + 1} down`}><ArrowDown className="size-4" /></Button>
              <Button type="button" variant="ghost" size="icon" className="size-8" onClick={() => { const n = [...blocks]; n.splice(i + 1, 0, { ...structuredClone(b), _k: newKey() }); onChange(n); }} aria-label={`Duplicate block ${i + 1}`}><Copy className="size-4" /></Button>
              <Button type="button" variant="ghost" size="icon" className="size-8 text-red-700" onClick={() => onChange(blocks.filter((_, j) => j !== i))} aria-label={`Remove block ${i + 1}`}><Trash2 className="size-4" /></Button>
            </div>
            {isOpen && (
              <div className="border-t p-3">
                {errors[`sections.${i}`] && <p className="mb-2 text-xs text-red-600">{errors[`sections.${i}`]}</p>}
                <BlockFields b={b} errors={errors} prefix={`sections.${i}`} set={(patch) => onChange(blocks.map((x, j) => (j === i ? ({ ...x, ...patch } as Block) : x)))} />
              </div>
            )}
          </div>
        );
      })}
      <div>{addMenu()}</div>
    </div>
  );
}
