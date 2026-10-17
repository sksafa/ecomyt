import sanitize from "sanitize-html";
import { z } from "zod";

// ───────────── URL / HTML safety ─────────────

const UNSAFE_SCHEME = /^\s*(javascript|vbscript|data)\s*:/i;

/** Relative paths, anchors, http(s), mailto and tel only. */
export const safeUrl = z
  .string()
  .trim()
  .max(1000)
  .refine((v) => !UNSAFE_SCHEME.test(v.replace(/[\u0000-\u001F\u007F\s]/g, "")), { message: "Unsafe URL scheme" });

const decodeEntities = (s: string) =>
  s
    .replace(/&#x([0-9a-f]+);?/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);?/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&colon;/gi, ":")
    .replace(/&tab;/gi, "\t")
    .replace(/&newline;/gi, "\n");

const DANGEROUS_BLOCKS = /<\s*(script|style|iframe|object|embed|noscript|template)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi;
const DANGEROUS_TAGS = /<\s*\/?\s*(script|style|iframe|object|embed|noscript|template|base|meta|link|form)\b[^>]*>/gi;
const EVENT_HANDLERS = /\s+on[a-z0-9_-]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi;
const URL_ATTRS = /\s+(href|src|xlink:href|action|formaction|srcset|poster|background)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi;
const MD_LINK = /(\]\(\s*)([^)\s]+)/g;

const isUnsafe = (url: string) => UNSAFE_SCHEME.test(decodeEntities(url).replace(/[\u0000-\u001F\u007F\s]/g, ""));

/**
 * Output sanitiser for CMS rich text (HTML or Markdown with inline HTML): removes script-like
 * elements, inline event handlers (on*) and javascript:/vbscript:/data: URLs.
 * Content authors are trusted staff; this is defence in depth for the storefront renderer.
 */
export function sanitizeHtml(input: string): string {
  // Real HTML goes through an allow-list sanitiser; markdown keeps the regex pass (its text must not be entity-encoded).
  if (/<[a-z!/]/i.test(input)) {
    return sanitize(regexClean(input), {
      allowedTags: [...sanitize.defaults.allowedTags, "img", "h1", "h2", "span"],
      allowedAttributes: { a: ["href", "title", "target", "rel"], img: ["src", "alt", "width", "height"], "*": ["class"] },
      allowedSchemes: ["http", "https", "mailto", "tel"],
      allowedSchemesAppliedToAttributes: ["href", "src"],
      transformTags: { a: sanitize.simpleTransform("a", { rel: "noopener noreferrer" }) },
    });
  }
  return regexClean(input);
}

function regexClean(input: string): string {
  let s = input;
  // repeat until stable so nested/obfuscated fragments ("<scr<script>ipt>") cannot reassemble
  for (let i = 0; i < 5; i++) {
    const before = s;
    s = s
      .replace(DANGEROUS_BLOCKS, "")
      .replace(DANGEROUS_TAGS, "")
      .replace(EVENT_HANDLERS, "")
      .replace(URL_ATTRS, (m, attr: string, _q, dq?: string, sq?: string, bare?: string) => (isUnsafe(dq ?? sq ?? bare ?? "") ? ` ${attr}="#"` : m))
      .replace(MD_LINK, (m, open: string, url: string) => (isUnsafe(url) ? `${open}#` : m));
    if (s === before) break;
  }
  return s;
}

// ───────────── page section blocks ─────────────

const text = (max: number) => z.string().trim().max(max);
const optText = (max: number) => text(max).nullish();

export const sectionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("hero"),
    id: optText(60),
    title: text(200).min(1),
    subtitle: optText(500),
    imageUrl: safeUrl.nullish(),
    ctaLabel: optText(60),
    ctaUrl: safeUrl.nullish(),
  }),
  z
    .object({ type: z.literal("rich_text"), id: optText(60), html: z.string().max(100_000).nullish(), markdown: z.string().max(100_000).nullish() })
    .refine((b) => !!b.html || !!b.markdown, { message: "rich_text needs html or markdown" }),
  z
    .object({
      type: z.literal("product_grid"),
      id: optText(60),
      title: optText(200),
      collectionSlug: optText(100),
      productIds: z.array(z.string().min(1)).max(48).nullish(),
      limit: z.number().int().min(1).max(48).default(8),
    })
    .refine((b) => !!b.collectionSlug || !!b.productIds?.length, { message: "product_grid needs collectionSlug or productIds" }),
  z.object({
    type: z.literal("image_banner"),
    id: optText(60),
    imageUrl: safeUrl.pipe(z.string().min(1)),
    mobileImageUrl: safeUrl.nullish(),
    alt: optText(200),
    linkUrl: safeUrl.nullish(),
    title: optText(200),
  }),
  z.object({ type: z.literal("testimonials"), id: optText(60), title: optText(200), limit: z.number().int().min(1).max(50).default(6) }),
  z.object({ type: z.literal("faq"), id: optText(60), title: optText(200), category: optText(80) }),
  z.object({ type: z.literal("countdown"), id: optText(60), title: text(200).min(1), endsAt: z.string().datetime({ offset: true }) }),
  z.object({ type: z.literal("order_form"), id: optText(60), title: optText(200), productId: z.string().min(1) }),
  z.object({
    type: z.literal("features"),
    id: optText(60),
    title: optText(200),
    items: z.array(z.object({ icon: optText(60), title: text(120).min(1), text: optText(500) })).min(1).max(12),
  }),
  z.object({ type: z.literal("video"), id: optText(60), title: optText(200), youtubeId: z.string().regex(/^[A-Za-z0-9_-]{11}$/, "Invalid YouTube video id") }),
]);

export type Section = z.infer<typeof sectionSchema>;
export const sectionsSchema = z.array(sectionSchema).max(50);

/** Sanitise text blocks for output. Unknown/legacy shapes are passed through unchanged except rich text. */
export function sanitizeSections(raw: unknown): Section[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((b) => {
    const block = b as Section;
    if (block?.type === "rich_text") {
      return { ...block, html: block.html ? sanitizeHtml(block.html) : block.html, markdown: block.markdown ? sanitizeHtml(block.markdown) : block.markdown };
    }
    return block;
  });
}

/**
 * `.partial()` keeps `.default()` values in Zod 4, so an update would silently reset omitted fields.
 * This strips defaults first so omitted fields stay undefined (= unchanged).
 */
export function partialNoDefaults<S extends z.ZodRawShape>(schema: z.ZodObject<S>) {
  const shape: Record<string, z.ZodType> = {};
  for (const [k, v] of Object.entries(schema.shape)) {
    const field = v as z.ZodType;
    shape[k] = (field instanceof z.ZodDefault ? (field.unwrap() as z.ZodType) : field).optional();
  }
  return z.object(shape) as unknown as ReturnType<z.ZodObject<S>["partial"]>;
}
