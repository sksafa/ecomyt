"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useFieldArray, useForm, useWatch, type Control, type FieldPath, type UseFormRegister } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Calculator, ImagePlus, Loader2, Plus, Search, Trash2, Upload, X } from "lucide-react";
import { api, ApiError, errorMessage, request, upload } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { bdt } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, NativeSelect, Pill, Section } from "@/components/admin/ui";
import { COST_COMPONENT_TYPES, PRODUCT_STATUS, Thumb, useCategories, useCollections, useDebounced, useMaterials } from "./shared";

// ───────────── API shape ─────────────

export interface ProductVariantDetail {
  id: string; sku: string; barcode: string | null; name: string; color: string | null; size: string | null; price: string | null; costPrice?: string | null;
  weightGrams: number | null; imageUrl: string | null; isActive: boolean; lowStockThreshold: number; effectivePrice: string;
  stock: { available: number; reserved: number; damaged: number; returned: number }; lowStock: boolean;
}
export interface ProductDetail {
  id: string; name: string; slug: string; sku: string; barcode: string | null; shortDescription: string | null; description: string | null;
  categoryId: string | null; status: "DRAFT" | "ACTIVE" | "ARCHIVED"; isPublished: boolean; isFeatured: boolean;
  regularPrice: string; salePrice: string | null; costPrice?: string; weightGrams: number; lengthCm: string | null; widthCm: string | null; heightCm: string | null;
  fabric: string | null; design: string | null; embroidery: string | null; careInstructions: string | null; freeShipping: boolean; shippingNote: string | null;
  seoTitle: string | null; seoDescription: string | null; ogImageUrl: string | null; createdAt: string; updatedAt: string;
  category: { id: string; name: string; slug: string } | null;
  images: { id: string; url: string; alt: string | null; sortOrder: number }[];
  variants: ProductVariantDetail[];
  collections: { id: string; name: string; slug: string }[];
  related: { id: string; name: string; slug: string; type: "RELATED" | "UPSELL" }[];
  costComponents?: { id: string; type: string; materialId: string | null; description: string; quantity: string; unitCost: string }[];
  computedCost?: string;
  stock: { available: number; reserved: number };
}

// ───────────── form schema ─────────────

const money = z.string().trim().regex(/^\d+(\.\d{1,2})?$/, "Enter an amount like 1250 or 1250.50");
const optMoney = z.string().trim().regex(/^(\d+(\.\d{1,2})?)?$/, "Enter an amount like 1250 or 1250.50");
const optInt = z.string().trim().regex(/^\d*$/, "Whole number");
const qtyRe = /^\d+(\.\d{1,3})?$/;

const schema = z
  .object({
    name: z.string().trim().min(2, "Name is required").max(200),
    slug: z.string().trim().max(100).regex(/^[a-z0-9ঀ-৿-]*$/, "Lowercase letters, numbers and dashes only"),
    sku: z.string().trim().min(2, "SKU is required").max(60),
    barcode: z.string().trim().max(60),
    shortDescription: z.string().max(500),
    description: z.string().max(20_000),
    categoryId: z.string(),
    collectionIds: z.array(z.string()),
    status: z.enum(["DRAFT", "ACTIVE", "ARCHIVED"]),
    isPublished: z.boolean(),
    isFeatured: z.boolean(),
    regularPrice: money,
    salePrice: optMoney,
    costPrice: optMoney,
    weightGrams: z.string().trim().regex(/^[1-9]\d{0,4}$/, "Weight in grams (1–50000)"),
    lengthCm: optMoney, widthCm: optMoney, heightCm: optMoney,
    fabric: z.string().max(200), design: z.string().max(200), embroidery: z.string().max(200), careInstructions: z.string().max(2000),
    freeShipping: z.boolean(),
    shippingNote: z.string().max(500),
    seoTitle: z.string().max(200), seoDescription: z.string().max(500), ogImageUrl: z.string().max(500),
    images: z.array(z.object({ url: z.string().min(1), alt: z.string().max(200) })).max(20, "Up to 20 images"),
    variants: z
      .array(
        z.object({
          id: z.string().optional(),
          sku: z.string().trim().min(2, "SKU required").max(60),
          barcode: z.string().trim().max(60),
          name: z.string().trim().min(1, "Name required").max(120),
          color: z.string().max(60), size: z.string().max(60),
          price: optMoney, costPrice: optMoney,
          weightGrams: optInt,
          imageUrl: z.string(),
          isActive: z.boolean(),
          lowStockThreshold: z.string().trim().regex(/^\d+$/, "Whole number"),
          openingStock: optInt,
        }),
      )
      .min(1, "Add at least one variant")
      .max(100),
    costComponents: z.array(
      z.object({
        type: z.enum(COST_COMPONENT_TYPES),
        materialId: z.string(),
        description: z.string().trim().min(1, "Describe this cost").max(200),
        quantity: z.string().trim().regex(qtyRe, "Quantity (up to 3 decimals)"),
        unitCost: money,
      }),
    ),
    related: z.array(z.object({ productId: z.string(), name: z.string(), type: z.enum(["RELATED", "UPSELL"]) })),
  })
  .superRefine((v, ctx) => {
    if (v.salePrice && Number(v.salePrice) >= Number(v.regularPrice)) ctx.addIssue({ code: "custom", path: ["salePrice"], message: "Sale price should be lower than the regular price" });
    const seen = new Map<string, number>();
    v.variants.forEach((x, i) => {
      const k = x.sku.trim().toUpperCase();
      if (seen.has(k)) ctx.addIssue({ code: "custom", path: ["variants", i, "sku"], message: "Duplicate SKU" });
      seen.set(k, i);
    });
  });

export type ProductFormValues = z.infer<typeof schema>;

const s = (v: string | null | undefined) => v ?? "";
const nul = (v: string) => (v.trim() === "" ? null : v.trim());

function toForm(p?: ProductDetail): ProductFormValues {
  if (!p) {
    return {
      name: "", slug: "", sku: "", barcode: "", shortDescription: "", description: "", categoryId: "", collectionIds: [], status: "DRAFT", isPublished: false, isFeatured: false,
      regularPrice: "", salePrice: "", costPrice: "", weightGrams: "250", lengthCm: "", widthCm: "", heightCm: "", fabric: "", design: "", embroidery: "", careInstructions: "",
      freeShipping: false, shippingNote: "", seoTitle: "", seoDescription: "", ogImageUrl: "", images: [],
      variants: [{ sku: "", barcode: "", name: "Default", color: "", size: "", price: "", costPrice: "", weightGrams: "", imageUrl: "", isActive: true, lowStockThreshold: "5", openingStock: "" }],
      costComponents: [], related: [],
    };
  }
  return {
    name: p.name, slug: p.slug, sku: p.sku, barcode: s(p.barcode), shortDescription: s(p.shortDescription), description: s(p.description), categoryId: s(p.categoryId),
    collectionIds: p.collections.map((c) => c.id), status: p.status, isPublished: p.isPublished, isFeatured: p.isFeatured,
    regularPrice: p.regularPrice, salePrice: s(p.salePrice), costPrice: s(p.costPrice), weightGrams: String(p.weightGrams),
    lengthCm: s(p.lengthCm), widthCm: s(p.widthCm), heightCm: s(p.heightCm), fabric: s(p.fabric), design: s(p.design), embroidery: s(p.embroidery),
    careInstructions: s(p.careInstructions), freeShipping: p.freeShipping, shippingNote: s(p.shippingNote), seoTitle: s(p.seoTitle), seoDescription: s(p.seoDescription),
    ogImageUrl: s(p.ogImageUrl), images: p.images.map((i) => ({ url: i.url, alt: s(i.alt) })),
    variants: p.variants.map((v) => ({
      id: v.id, sku: v.sku, barcode: s(v.barcode), name: v.name, color: s(v.color), size: s(v.size), price: s(v.price), costPrice: s(v.costPrice),
      weightGrams: v.weightGrams ? String(v.weightGrams) : "", imageUrl: s(v.imageUrl), isActive: v.isActive, lowStockThreshold: String(v.lowStockThreshold), openingStock: "",
    })),
    costComponents: (p.costComponents ?? []).map((c) => ({ type: c.type as (typeof COST_COMPONENT_TYPES)[number], materialId: s(c.materialId), description: c.description, quantity: String(Number(c.quantity)), unitCost: c.unitCost })),
    related: p.related.map((r) => ({ productId: r.id, name: r.name, type: r.type })),
  };
}

function toBody(v: ProductFormValues, opts: { isNew: boolean; sendCosts: boolean }) {
  return {
    name: v.name.trim(), slug: v.slug.trim() || undefined, sku: v.sku.trim(), barcode: nul(v.barcode), shortDescription: nul(v.shortDescription), description: nul(v.description),
    categoryId: v.categoryId || null, collectionIds: v.collectionIds, status: v.status, isPublished: v.isPublished, isFeatured: v.isFeatured,
    regularPrice: v.regularPrice, salePrice: nul(v.salePrice), costPrice: v.costPrice.trim() || "0", weightGrams: Number(v.weightGrams),
    lengthCm: nul(v.lengthCm), widthCm: nul(v.widthCm), heightCm: nul(v.heightCm), fabric: nul(v.fabric), design: nul(v.design), embroidery: nul(v.embroidery),
    careInstructions: nul(v.careInstructions), freeShipping: v.freeShipping, shippingNote: nul(v.shippingNote), seoTitle: nul(v.seoTitle), seoDescription: nul(v.seoDescription),
    ogImageUrl: nul(v.ogImageUrl), images: v.images.map((i) => ({ url: i.url, alt: nul(i.alt) })),
    related: v.related.map((r) => ({ productId: r.productId, type: r.type })),
    costComponents: opts.sendCosts ? v.costComponents.map((c) => ({ type: c.type, materialId: c.materialId || null, description: c.description.trim(), quantity: c.quantity, unitCost: c.unitCost })) : undefined,
    variants: v.variants.map((x) => ({
      id: x.id, sku: x.sku.trim(), barcode: nul(x.barcode), name: x.name.trim(), color: nul(x.color), size: nul(x.size), price: nul(x.price), costPrice: nul(x.costPrice),
      weightGrams: x.weightGrams ? Number(x.weightGrams) : null, imageUrl: nul(x.imageUrl), isActive: x.isActive, lowStockThreshold: Number(x.lowStockThreshold),
      openingStock: opts.isNew && x.openingStock ? Number(x.openingStock) : undefined,
    })),
  };
}

// ───────────── form ─────────────

export function ProductForm({ product }: { product?: ProductDetail }) {
  const isNew = !product;
  const router = useRouter();
  const qc = useQueryClient();
  const { can } = useAuth();
  const canManage = can("products.manage");
  // Costs are visible to finance users and product managers; when hidden we leave them untouched on save.
  const showCosts = isNew ? canManage : product.costPrice !== undefined;
  const categories = useCategories();
  const collections = useCollections();
  const [saving, setSaving] = useState(false);

  const form = useForm<ProductFormValues>({ resolver: zodResolver(schema), defaultValues: toForm(product), mode: "onTouched" });
  const { register, control, handleSubmit, setValue, setError, formState } = form;
  const errors = formState.errors;
  const images = useFieldArray({ control, name: "images" });
  const variants = useFieldArray({ control, name: "variants", keyName: "_key" });
  const costs = useFieldArray({ control, name: "costComponents" });
  const related = useFieldArray({ control, name: "related" });

  const watched = useWatch({ control });
  const regular = Number(watched.regularPrice || 0);
  const sale = watched.salePrice ? Number(watched.salePrice) : null;
  const basePrice = sale ?? regular;

  // live cost calculation from components
  const costInput = useMemo(
    () => (watched.costComponents ?? []).filter((c) => c && c.quantity && qtyRe.test(c.quantity) && (c.materialId || (c.description && c.unitCost && /^\d+(\.\d{1,2})?$/.test(c.unitCost)))),
    [watched.costComponents],
  );
  const debouncedCostInput = useDebounced(JSON.stringify(costInput), 300);
  const calc = useQuery({
    queryKey: ["calculate-cost", debouncedCostInput],
    enabled: showCosts && costInput.length > 0,
    queryFn: () =>
      api<{ lines: { lineTotal: string }[]; total: string }>("/materials/calculate-cost", {
        method: "POST",
        body: {
          components: (JSON.parse(debouncedCostInput) as ProductFormValues["costComponents"]).map((c) => ({
            materialId: c.materialId || null, description: c.description || null, type: c.type, quantity: c.quantity, unitCost: c.unitCost || null,
          })),
        },
      }),
    placeholderData: (prev) => prev,
    retry: false,
  });
  const hasComponents = (watched.costComponents?.length ?? 0) > 0;
  const computedCost = hasComponents && calc.data ? calc.data.total : null;
  useEffect(() => {
    if (computedCost !== null && Number(form.getValues("costPrice") || 0) !== Number(computedCost)) {
      setValue("costPrice", Number(computedCost).toFixed(2), { shouldDirty: true });
    }
  }, [computedCost, setValue, form]);
  const productCost = Number(watched.costPrice || 0);

  async function onSubmit(values: ProductFormValues) {
    setSaving(true);
    try {
      const body = toBody(values, { isNew, sendCosts: showCosts });
      const saved = isNew
        ? await api<ProductDetail>("/products", { method: "POST", body })
        : await api<ProductDetail>(`/products/${product.id}`, { method: "PUT", body });
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.setQueryData(["product", saved.id], saved);
      toast.success(isNew ? "Product created" : "Product saved");
      if (isNew) router.replace(`/admin/products/${saved.id}`);
      else form.reset(toForm(saved));
    } catch (e) {
      if (e instanceof ApiError) {
        const fe = e.fieldErrors;
        for (const [path, message] of Object.entries(fe)) setError(path as FieldPath<ProductFormValues>, { message });
        if (/sku/i.test(e.message) && e.status === 409) setError("sku", { message: e.message });
      }
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  const imageUrls = (watched.images ?? []).map((i) => i?.url).filter((u): u is string => !!u);

  return (
    <form onSubmit={handleSubmit(onSubmit, () => toast.error("Please fix the highlighted fields"))} className="space-y-4" noValidate>
      <fieldset disabled={!canManage} className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Section title="Basics">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Field label="Product name" htmlFor="p-name" error={errors.name?.message}>
                  <Input id="p-name" {...register("name")} placeholder="e.g. Maroon Zari Work Orna" aria-invalid={!!errors.name} />
                </Field>
              </div>
              <Field label="SKU" htmlFor="p-sku" error={errors.sku?.message}><Input id="p-sku" {...register("sku")} placeholder="BB-ORN-001" aria-invalid={!!errors.sku} /></Field>
              <Field label="Barcode" htmlFor="p-barcode" error={errors.barcode?.message}><Input id="p-barcode" {...register("barcode")} /></Field>
              <div className="sm:col-span-2">
                <Field label="URL slug" htmlFor="p-slug" error={errors.slug?.message} hint={isNew ? "Leave empty to generate from the name" : "Changing the slug changes the product's web address"}>
                  <Input id="p-slug" {...register("slug")} placeholder="maroon-zari-work-orna" />
                </Field>
              </div>
              <div className="sm:col-span-2">
                <Field label="Short description" htmlFor="p-short" error={errors.shortDescription?.message}><Textarea id="p-short" rows={2} {...register("shortDescription")} /></Field>
              </div>
              <div className="sm:col-span-2">
                <Field label="Full description" htmlFor="p-desc" error={errors.description?.message} hint="Bengali text is supported"><Textarea id="p-desc" rows={6} {...register("description")} /></Field>
              </div>
            </div>
          </Section>

          <Section title={`Images (${images.fields.length}/20)`} actions={canManage ? <ImageUploadButton disabled={images.fields.length >= 20} onUploaded={(url) => images.append({ url, alt: watched.name ?? "" })} /> : undefined}>
            {images.fields.length === 0 ? (
              <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">No images yet. The first image is the main product photo.</p>
            ) : (
              <ul className="space-y-2">
                {images.fields.map((f, i) => (
                  <li key={f.id} className="flex items-center gap-3 rounded-lg border p-2">
                    <Thumb src={watched.images?.[i]?.url} alt={watched.images?.[i]?.alt || `Image ${i + 1}`} size={64} />
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        {i === 0 ? <Pill tone="blue">Main</Pill> : <span>#{i + 1}</span>}
                        <span className="truncate">{watched.images?.[i]?.url}</span>
                      </div>
                      <Input {...register(`images.${i}.alt`)} placeholder="Alt text (describe the photo)" aria-label={`Alt text for image ${i + 1}`} className="h-8" />
                    </div>
                    <div className="flex shrink-0 gap-0.5">
                      <Button type="button" variant="ghost" size="icon" className="size-8" disabled={i === 0} onClick={() => images.move(i, i - 1)} aria-label="Move up"><ArrowUp className="size-4" /></Button>
                      <Button type="button" variant="ghost" size="icon" className="size-8" disabled={i === images.fields.length - 1} onClick={() => images.move(i, i + 1)} aria-label="Move down"><ArrowDown className="size-4" /></Button>
                      <Button type="button" variant="ghost" size="icon" className="size-8 text-red-600" onClick={() => images.remove(i)} aria-label="Remove image"><Trash2 className="size-4" /></Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section
            title="Variants"
            actions={
              <Button
                type="button" variant="outline" size="sm"
                onClick={() => variants.append({ sku: `${watched.sku || "SKU"}-${variants.fields.length + 1}`, barcode: "", name: "", color: "", size: "", price: "", costPrice: "", weightGrams: "", imageUrl: "", isActive: true, lowStockThreshold: "5", openingStock: "" })}
              >
                <Plus className="size-4" /> Add variant
              </Button>
            }
          >
            {errors.variants?.root?.message || errors.variants?.message ? <p className="mb-2 text-sm text-red-600">{errors.variants?.root?.message ?? errors.variants?.message}</p> : null}
            <div className="space-y-3">
              {variants.fields.map((f, i) => {
                const v = watched.variants?.[i];
                const existing = product?.variants.find((x) => x.id === f.id);
                const eff = v?.price ? Number(v.price) : basePrice;
                const cost = v?.costPrice ? Number(v.costPrice) : productCost;
                const margin = eff > 0 ? ((eff - cost) / eff) * 100 : null;
                const e = errors.variants?.[i];
                return (
                  <div key={f._key} className={cn("rounded-lg border p-3", v && !v.isActive && "bg-muted/40")}>
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{v?.name || `Variant ${i + 1}`}</span>
                      {existing && <span className="text-xs text-muted-foreground">Stock: {existing.stock.available} available · {existing.stock.reserved} reserved</span>}
                      {!f.id && !isNew && <Pill tone="sky">New</Pill>}
                      <label className="ml-auto flex items-center gap-1.5 text-sm">
                        <input type="checkbox" className="size-4" {...register(`variants.${i}.isActive`)} /> Active
                      </label>
                      <Button
                        type="button" variant="ghost" size="icon" className="size-8 text-red-600" disabled={variants.fields.length === 1}
                        onClick={() => variants.remove(i)}
                        aria-label="Remove variant" title={f.id ? "Existing variants are deactivated, not deleted (order history keeps them)" : "Remove"}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                      <Field label="SKU" error={e?.sku?.message}><Input {...register(`variants.${i}.sku`)} className="h-8" aria-invalid={!!e?.sku} /></Field>
                      <Field label="Name" error={e?.name?.message}><Input {...register(`variants.${i}.name`)} className="h-8" placeholder="Maroon / 2.5 Hand" /></Field>
                      <Field label="Color" error={e?.color?.message}><Input {...register(`variants.${i}.color`)} className="h-8" /></Field>
                      <Field label="Size" error={e?.size?.message}><Input {...register(`variants.${i}.size`)} className="h-8" /></Field>
                      <Field label="Price override (৳)" error={e?.price?.message}><Input inputMode="decimal" {...register(`variants.${i}.price`)} className="h-8" placeholder={basePrice ? String(basePrice) : ""} /></Field>
                      {showCosts && <Field label="Cost override (৳)" error={e?.costPrice?.message}><Input inputMode="decimal" {...register(`variants.${i}.costPrice`)} className="h-8" placeholder={productCost ? String(productCost) : ""} /></Field>}
                      <Field label="Weight (g)" error={e?.weightGrams?.message}><Input inputMode="numeric" {...register(`variants.${i}.weightGrams`)} className="h-8" placeholder={watched.weightGrams} /></Field>
                      <Field label="Low-stock alert at" error={e?.lowStockThreshold?.message}><Input inputMode="numeric" {...register(`variants.${i}.lowStockThreshold`)} className="h-8" /></Field>
                      <Field label="Barcode" error={e?.barcode?.message}><Input {...register(`variants.${i}.barcode`)} className="h-8" /></Field>
                      <Field label="Image">
                        <NativeSelect {...register(`variants.${i}.imageUrl`)} className="h-8">
                          <option value="">Product main image</option>
                          {[...new Set([...imageUrls, ...(v?.imageUrl ? [v.imageUrl] : [])])].map((u, k) => <option key={u} value={u}>Image #{imageUrls.indexOf(u) + 1 || k + 1}</option>)}
                        </NativeSelect>
                      </Field>
                      {isNew && <Field label="Opening stock" error={e?.openingStock?.message}><Input inputMode="numeric" {...register(`variants.${i}.openingStock`)} className="h-8" placeholder="0" /></Field>}
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      Selling price <span className="font-medium text-foreground">{bdt(eff)}</span>
                      {showCosts && (
                        <>
                          {" "}· cost {bdt(cost)} · margin{" "}
                          <span className={cn("font-medium", margin === null ? "" : margin < 20 ? "text-red-700" : margin < 40 ? "text-amber-700" : "text-green-700")}>
                            {margin === null ? "—" : `${bdt(eff - cost)} (${margin.toFixed(1)}%)`}
                          </span>
                        </>
                      )}
                    </p>
                  </div>
                );
              })}
            </div>
            {!isNew && <p className="mt-2 text-xs text-muted-foreground">Removing an existing variant deactivates it (it stays in order history). Use Inventory to change stock.</p>}
          </Section>

          {showCosts && (
            <CostBreakdown control={control} register={register} errors={errors} costs={costs} watched={watched.costComponents ?? []} calc={calc} setValue={setValue} computed={computedCost} />
          )}

          <RelatedPicker
            excludeId={product?.id}
            items={related.fields.map((f) => ({ key: f.id, productId: f.productId, name: f.name, type: f.type }))}
            onAdd={(r) => related.append(r)}
            onRemove={(i) => related.remove(i)}
            register={register}
          />

          <Section title="SEO & sharing">
            <div className="grid gap-3">
              <Field label="SEO title" htmlFor="p-seot" error={errors.seoTitle?.message} hint={`${(watched.seoTitle ?? "").length}/60 recommended`}><Input id="p-seot" {...register("seoTitle")} placeholder={watched.name} /></Field>
              <Field label="SEO description" htmlFor="p-seod" error={errors.seoDescription?.message} hint={`${(watched.seoDescription ?? "").length}/160 recommended`}><Textarea id="p-seod" rows={2} {...register("seoDescription")} /></Field>
              <Field label="Social share image (OG)" htmlFor="p-og" error={errors.ogImageUrl?.message} hint="Defaults to the main product image when empty">
                <div className="flex gap-2">
                  <Input id="p-og" {...register("ogImageUrl")} placeholder="/uploads/…" />
                  {canManage && <ImageUploadButton compact onUploaded={(url) => setValue("ogImageUrl", url, { shouldDirty: true })} />}
                </div>
              </Field>
              {watched.ogImageUrl && <Thumb src={watched.ogImageUrl} alt="Social share preview" size={96} />}
            </div>
          </Section>
        </div>

        <div className="space-y-4">
          <Section title="Status">
            <div className="space-y-3">
              <Field label="Status" htmlFor="p-status">
                <NativeSelect id="p-status" {...register("status")}>
                  {Object.entries(PRODUCT_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </NativeSelect>
              </Field>
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-0.5 size-4" {...register("isPublished")} />
                <span>Published on the store{watched.status !== "ACTIVE" && <span className="block text-xs text-amber-700">Only active products can be published</span>}</span>
              </label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4" {...register("isFeatured")} /> Featured</label>
            </div>
          </Section>

          <Section title="Organisation">
            <div className="space-y-3">
              <Field label="Category" htmlFor="p-cat">
                <NativeSelect id="p-cat" key={`cat-${categories.data?.length ?? 0}`} {...register("categoryId")}>
                  <option value="">No category</option>
                  {categories.data?.map((c) => <option key={c.id} value={c.id}>{c.parentId ? `— ${c.name}` : c.name}</option>)}
                </NativeSelect>
              </Field>
              <fieldset>
                <legend className="mb-1.5 text-sm font-medium">Collections</legend>
                {collections.data?.length ? (
                  <div className="max-h-48 space-y-1.5 overflow-y-auto rounded-md border p-2">
                    {collections.data.map((c) => (
                      <label key={c.id} className="flex items-center gap-2 text-sm">
                        <input type="checkbox" className="size-4" value={c.id} {...register("collectionIds")} /> {c.name}
                      </label>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">No collections yet. <Link className="text-blue-700 underline" href="/admin/products/categories">Create one</Link>.</p>
                )}
              </fieldset>
            </div>
          </Section>

          <Section title="Pricing">
            <div className="space-y-3">
              <Field label="Regular price (৳)" htmlFor="p-reg" error={errors.regularPrice?.message}><Input id="p-reg" inputMode="decimal" {...register("regularPrice")} aria-invalid={!!errors.regularPrice} /></Field>
              <Field label="Sale price (৳)" htmlFor="p-sale" error={errors.salePrice?.message} hint="Optional; shown with the regular price struck through"><Input id="p-sale" inputMode="decimal" {...register("salePrice")} /></Field>
              {showCosts && (
                <Field label="Cost price (৳)" htmlFor="p-cost" error={errors.costPrice?.message} hint={hasComponents ? "Set automatically from the cost breakdown" : "Or build it from a cost breakdown below"}>
                  <Input id="p-cost" inputMode="decimal" {...register("costPrice")} readOnly={hasComponents} className={cn(hasComponents && "bg-muted")} />
                </Field>
              )}
              {showCosts && basePrice > 0 && (
                <div className="rounded-md bg-muted/50 p-2 text-sm">
                  <div className="flex justify-between"><span className="text-muted-foreground">Selling at</span><span className="tabular-nums">{bdt(basePrice)}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Gross margin</span><span className="font-medium tabular-nums">{bdt(basePrice - productCost)} ({(((basePrice - productCost) / basePrice) * 100).toFixed(1)}%)</span></div>
                </div>
              )}
            </div>
          </Section>

          <Section title="Shipping">
            <div className="space-y-3">
              <Field label="Weight (grams)" htmlFor="p-w" error={errors.weightGrams?.message}><Input id="p-w" inputMode="numeric" {...register("weightGrams")} /></Field>
              <div className="grid grid-cols-3 gap-2">
                <Field label="Length (cm)" error={errors.lengthCm?.message}><Input inputMode="decimal" {...register("lengthCm")} /></Field>
                <Field label="Width (cm)" error={errors.widthCm?.message}><Input inputMode="decimal" {...register("widthCm")} /></Field>
                <Field label="Height (cm)" error={errors.heightCm?.message}><Input inputMode="decimal" {...register("heightCm")} /></Field>
              </div>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4" {...register("freeShipping")} /> Free shipping</label>
              <Field label="Shipping note" htmlFor="p-sn" error={errors.shippingNote?.message}><Input id="p-sn" {...register("shippingNote")} placeholder="e.g. Ships in 3–5 days" /></Field>
            </div>
          </Section>

          <Section title="Product details">
            <div className="space-y-3">
              <Field label="Fabric" htmlFor="p-fab"><Input id="p-fab" {...register("fabric")} placeholder="Silk blend" /></Field>
              <Field label="Design" htmlFor="p-des"><Input id="p-des" {...register("design")} /></Field>
              <Field label="Embroidery" htmlFor="p-emb"><Input id="p-emb" {...register("embroidery")} placeholder="Hand embroidery, zari…" /></Field>
              <Field label="Care instructions" htmlFor="p-care"><Textarea id="p-care" rows={3} {...register("careInstructions")} /></Field>
            </div>
          </Section>
        </div>
      </fieldset>

      {canManage && (
        <div className="sticky bottom-0 z-20 -mx-4 flex items-center justify-end gap-2 border-t bg-white/95 px-4 py-3 backdrop-blur md:-mx-6 md:px-6">
          {formState.isDirty && <span className="mr-auto text-sm text-amber-700">Unsaved changes</span>}
          <Button type="button" variant="outline" onClick={() => router.push("/admin/products")}>Cancel</Button>
          <Button type="submit" disabled={saving}>{saving && <Loader2 className="size-4 animate-spin" />} {isNew ? "Create product" : "Save changes"}</Button>
        </div>
      )}
    </form>
  );
}

// ───────────── pieces ─────────────

export function ImageUploadButton({ onUploaded, disabled, compact }: { onUploaded: (url: string) => void; disabled?: boolean; compact?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <input
        ref={ref}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif,image/avif"
        multiple={!compact}
        className="hidden"
        onChange={async (e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = "";
          if (!files.length) return;
          setBusy(true);
          for (const f of files) {
            if (f.size > 5 * 1024 * 1024) {
              toast.error(`${f.name} is larger than 5 MB`);
              continue;
            }
            try {
              const r = await upload(f);
              onUploaded(r.url);
            } catch (err) {
              toast.error(`${f.name}: ${errorMessage(err)}`);
            }
          }
          setBusy(false);
        }}
      />
      <Button type="button" variant="outline" size={compact ? "icon" : "sm"} className={compact ? "size-9 shrink-0" : undefined} disabled={disabled || busy} onClick={() => ref.current?.click()} aria-label="Upload image">
        {busy ? <Loader2 className="size-4 animate-spin" /> : compact ? <Upload className="size-4" /> : <ImagePlus className="size-4" />}
        {!compact && "Upload images"}
      </Button>
    </>
  );
}

function CostBreakdown({
  register, errors, costs, watched, calc, setValue, computed,
}: {
  control: Control<ProductFormValues>;
  register: UseFormRegister<ProductFormValues>;
  errors: ReturnType<typeof useForm<ProductFormValues>>["formState"]["errors"];
  costs: ReturnType<typeof useFieldArray<ProductFormValues, "costComponents">>;
  watched: Partial<ProductFormValues["costComponents"][number]>[];
  calc: { data?: { lines: { lineTotal: string }[]; total: string }; isFetching: boolean; isError: boolean; error: unknown };
  setValue: ReturnType<typeof useForm<ProductFormValues>>["setValue"];
  computed: string | null;
}) {
  const { can } = useAuth();
  const materials = useMaterials(can("purchasing.view"));
  const mats = materials.data ?? [];
  return (
    <Section
      title={<span className="flex items-center gap-2"><Calculator className="size-4" /> Cost breakdown</span>}
      actions={<Button type="button" variant="outline" size="sm" onClick={() => costs.append({ type: "FABRIC", materialId: "", description: "", quantity: "1", unitCost: "" })}><Plus className="size-4" /> Add cost</Button>}
    >
      <p className="mb-3 text-sm text-muted-foreground">
        List what goes into one unit — fabric, lace, embroidery, labour, packaging. When any line is present, the total <strong>sets the product cost price</strong> used for margins and profit reports.
      </p>
      {costs.fields.length === 0 ? (
        <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">No cost breakdown. The cost price field is used as entered.</p>
      ) : (
        <div className="space-y-2">
          <div className="hidden grid-cols-[130px_minmax(0,1.2fr)_minmax(0,1.4fr)_80px_100px_90px_32px] gap-2 px-1 text-xs font-medium text-muted-foreground md:grid">
            <span>Type</span><span>Material</span><span>Description</span><span>Qty</span><span>Unit cost ৳</span><span className="text-right">Line total</span><span />
          </div>
          {costs.fields.map((f, i) => {
            const e = errors.costComponents?.[i];
            const line = calc.data?.lines;
            const w = watched[i];
            const localTotal = w?.quantity && w?.unitCost ? Number(w.quantity) * Number(w.unitCost) : 0;
            return (
              <div key={f.id} className="grid grid-cols-2 gap-2 rounded-lg border p-2 md:grid-cols-[130px_minmax(0,1.2fr)_minmax(0,1.4fr)_80px_100px_90px_32px] md:items-start md:border-0 md:p-0">
                <NativeSelect {...register(`costComponents.${i}.type`)} className="h-8" aria-label="Component type">
                  {COST_COMPONENT_TYPES.map((t) => <option key={t} value={t}>{t.charAt(0) + t.slice(1).toLowerCase()}</option>)}
                </NativeSelect>
                <NativeSelect
                  key={`mat-${mats.length}`}
                  {...register(`costComponents.${i}.materialId`, {
                    onChange: (ev) => {
                      const m = mats.find((x) => x.id === ev.target.value);
                      if (m) {
                        setValue(`costComponents.${i}.unitCost`, m.unitCost, { shouldValidate: true });
                        if (!w?.description) setValue(`costComponents.${i}.description`, `${m.name} (per ${m.unit})`, { shouldValidate: true });
                      }
                    },
                  })}
                  className="h-8"
                  aria-label="Material"
                  disabled={materials.isError}
                  title={materials.isError ? "Material list needs purchasing access" : undefined}
                >
                  <option value="">{materials.isError ? "Materials unavailable" : "No material"}</option>
                  {mats.map((m) => <option key={m.id} value={m.id}>{m.name} — {bdt(m.unitCost)}/{m.unit}</option>)}
                </NativeSelect>
                <div className="col-span-2 md:col-span-1">
                  <Input {...register(`costComponents.${i}.description`)} className="h-8" placeholder="e.g. Zari embroidery" aria-label="Description" aria-invalid={!!e?.description} />
                  {e?.description && <p className="mt-0.5 text-xs text-red-600">{e.description.message}</p>}
                </div>
                <div>
                  <Input {...register(`costComponents.${i}.quantity`)} inputMode="decimal" className="h-8" aria-label="Quantity" aria-invalid={!!e?.quantity} />
                  {e?.quantity && <p className="mt-0.5 text-xs text-red-600">{e.quantity.message}</p>}
                </div>
                <div>
                  <Input {...register(`costComponents.${i}.unitCost`)} inputMode="decimal" className="h-8" aria-label="Unit cost" aria-invalid={!!e?.unitCost} />
                  {e?.unitCost && <p className="mt-0.5 text-xs text-red-600">{e.unitCost.message}</p>}
                </div>
                <span className="self-center text-right text-sm tabular-nums">{bdt(line?.[i]?.lineTotal ?? localTotal)}</span>
                <Button type="button" variant="ghost" size="icon" className="size-8 justify-self-end text-red-600" onClick={() => costs.remove(i)} aria-label="Remove cost line"><X className="size-4" /></Button>
              </div>
            );
          })}
          <div className="flex items-center justify-end gap-3 border-t pt-2 text-sm">
            {calc.isFetching && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
            {calc.isError && <span className="text-red-600">{errorMessage(calc.error)}</span>}
            <span className="text-muted-foreground">Unit cost total</span>
            <span className="text-base font-semibold tabular-nums">{computed !== null ? bdt(computed) : "—"}</span>
          </div>
        </div>
      )}
    </Section>
  );
}

function RelatedPicker({
  excludeId, items, onAdd, onRemove, register,
}: {
  excludeId?: string;
  items: { key: string; productId: string; name: string; type: "RELATED" | "UPSELL" }[];
  onAdd: (r: { productId: string; name: string; type: "RELATED" | "UPSELL" }) => void;
  onRemove: (i: number) => void;
  register: UseFormRegister<ProductFormValues>;
}) {
  const [q, setQ] = useState("");
  const [type, setType] = useState<"RELATED" | "UPSELL">("RELATED");
  const dq = useDebounced(q.trim(), 250);
  const results = useQuery({
    queryKey: ["products", "picker", dq],
    enabled: dq.length >= 2,
    queryFn: () => request<{ id: string; name: string; sku: string; images: { url: string }[] }[]>("/products", { query: { search: dq, pageSize: 8 } }),
  });
  const taken = new Set(items.map((i) => `${i.productId}:${i.type}`));
  return (
    <Section title="Related & upsell products">
      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-52 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search products to link" className="h-9 pl-9" aria-label="Search products to link" />
        </div>
        <NativeSelect className="w-36" value={type} onChange={(e) => setType(e.target.value as "RELATED" | "UPSELL")} aria-label="Link type">
          <option value="RELATED">Related</option>
          <option value="UPSELL">Upsell</option>
        </NativeSelect>
      </div>
      {dq.length >= 2 && (
        <ul className="mt-2 max-h-56 overflow-y-auto rounded-md border">
          {results.isLoading && <li className="p-2 text-sm text-muted-foreground">Searching…</li>}
          {results.data?.data.filter((p) => p.id !== excludeId).map((p) => (
            <li key={p.id}>
              <button
                type="button"
                disabled={taken.has(`${p.id}:${type}`)}
                className="flex w-full items-center gap-2 p-2 text-left text-sm hover:bg-muted disabled:opacity-50"
                onClick={() => { onAdd({ productId: p.id, name: p.name, type }); setQ(""); }}
              >
                <Thumb src={p.images[0]?.url} alt={p.name} size={28} /> <span className="flex-1">{p.name}</span> <span className="text-xs text-muted-foreground">{p.sku}</span>
              </button>
            </li>
          ))}
          {results.data && results.data.data.filter((p) => p.id !== excludeId).length === 0 && <li className="p-2 text-sm text-muted-foreground">No products found</li>}
        </ul>
      )}
      {items.length > 0 ? (
        <ul className="mt-3 divide-y rounded-md border">
          {items.map((r, i) => (
            <li key={r.key} className="flex items-center gap-2 p-2 text-sm">
              <span className="flex-1">{r.name}</span>
              <NativeSelect className="h-8 w-28" {...register(`related.${i}.type`)} aria-label={`Link type for ${r.name}`}>
                <option value="RELATED">Related</option>
                <option value="UPSELL">Upsell</option>
              </NativeSelect>
              <Button type="button" variant="ghost" size="icon" className="size-8 text-red-600" onClick={() => onRemove(i)} aria-label={`Remove ${r.name}`}><X className="size-4" /></Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">Related products appear under “You may also like”; upsells are suggested as premium alternatives.</p>
      )}
    </Section>
  );
}
