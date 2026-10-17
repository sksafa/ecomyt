import { prisma } from "../../lib/prisma.js";
import type { NotificationChannel } from "../../generated/prisma/enums.js";

export type Lang = "en" | "bn";

export interface DefaultTemplate {
  /** Subject (email) / title (in-app). */
  subject: { en: string; bn: string };
  body: { en: string; bn: string };
  /** Variables the template uses, in order. Also the parameter order for WhatsApp template messages. */
  vars: string[];
}

/**
 * Built-in templates used when no active NotificationTemplate row exists for (key, channel).
 * Bengali variants are looked up in the DB as `<key>.bn` (NotificationTemplate has no language column).
 * Customer-facing templates are strictly transactional (never marketing).
 */
export const DEFAULT_TEMPLATES: Record<string, DefaultTemplate> = {
  "order.confirmed": {
    subject: { en: "Order {{orderNumber}} confirmed", bn: "অর্ডার {{orderNumber}} নিশ্চিত হয়েছে" },
    body: {
      en: "Dear {{customerName}}, your Bent & Bound order {{orderNumber}} ({{total}}) is confirmed. We will let you know when it ships.",
      bn: "প্রিয় {{customerName}}, আপনার Bent & Bound অর্ডার {{orderNumber}} ({{total}}) নিশ্চিত হয়েছে। পাঠানোর সময় আমরা জানিয়ে দেব।",
    },
    vars: ["customerName", "orderNumber", "total"],
  },
  "order.shipped": {
    subject: { en: "Order {{orderNumber}} shipped", bn: "অর্ডার {{orderNumber}} পাঠানো হয়েছে" },
    body: {
      en: "Dear {{customerName}}, your order {{orderNumber}} has been handed to {{courier}}. Tracking code: {{trackingCode}}. Please keep {{codAmount}} ready for cash on delivery.",
      bn: "প্রিয় {{customerName}}, আপনার অর্ডার {{orderNumber}} {{courier}}-এর কাছে হস্তান্তর করা হয়েছে। ট্র্যাকিং কোড: {{trackingCode}}। ক্যাশ অন ডেলিভারির জন্য {{codAmount}} প্রস্তুত রাখুন।",
    },
    vars: ["customerName", "orderNumber", "courier", "trackingCode", "codAmount"],
  },
  "order.delivered": {
    subject: { en: "Order {{orderNumber}} delivered", bn: "অর্ডার {{orderNumber}} ডেলিভারি হয়েছে" },
    body: {
      en: "Dear {{customerName}}, your order {{orderNumber}} has been delivered. Thank you for shopping with Bent & Bound!",
      bn: "প্রিয় {{customerName}}, আপনার অর্ডার {{orderNumber}} ডেলিভারি হয়েছে। Bent & Bound-এর সাথে থাকার জন্য ধন্যবাদ!",
    },
    vars: ["customerName", "orderNumber"],
  },
  "daily.summary": {
    subject: { en: "Bent & Bound daily summary – {{date}}", bn: "Bent & Bound দৈনিক সারাংশ – {{date}}" },
    body: {
      en: [
        "Daily summary for {{date}} (Asia/Dhaka)",
        "Orders placed: {{placedCount}} ({{placedValue}})",
        "Confirmed: {{confirmedCount}}",
        "Shipped: {{shippedCount}}",
        "Delivered: {{deliveredCount}} ({{deliveredValue}})",
        "Cancelled: {{cancelledCount}}",
        "Returned: {{returnedCount}}",
        "Awaiting confirmation now: {{awaitingConfirmation}}",
        "Low-stock variants: {{lowStockCount}}",
      ].join("\n"),
      bn: [
        "{{date}} তারিখের দৈনিক সারাংশ",
        "নতুন অর্ডার: {{placedCount}} ({{placedValue}})",
        "নিশ্চিত: {{confirmedCount}}",
        "পাঠানো: {{shippedCount}}",
        "ডেলিভারি: {{deliveredCount}} ({{deliveredValue}})",
        "বাতিল: {{cancelledCount}}",
        "ফেরত: {{returnedCount}}",
        "নিশ্চিতকরণের অপেক্ষায়: {{awaitingConfirmation}}",
        "কম স্টক ভ্যারিয়েন্ট: {{lowStockCount}}",
      ].join("\n"),
    },
    vars: ["date", "placedCount", "placedValue", "confirmedCount", "shippedCount", "deliveredCount", "deliveredValue", "cancelledCount", "returnedCount", "awaitingConfirmation", "lowStockCount"],
  },
};

export type TemplateVars = Record<string, string | number | null | undefined>;

/** `{{ var }}` interpolation. Unknown variables render as an empty string; no code execution. */
export function interpolate(text: string, vars: TemplateVars): string {
  return text.replace(/\{\{\s*([A-Za-z0-9_.]+)\s*\}\}/g, (_m, name: string) => {
    const v = vars[name];
    return v === null || v === undefined ? "" : String(v);
  });
}

export interface RenderedTemplate {
  subject: string;
  body: string;
  source: "db" | "default";
  /** Ordered parameter values (WhatsApp template body parameters). */
  params: string[];
}

/** DB template (key[.bn], channel) if active, otherwise the built-in default. Throws for unknown keys. */
export async function renderTemplate(key: string, channel: NotificationChannel, vars: TemplateVars, lang: Lang = "en"): Promise<RenderedTemplate> {
  const keys = lang === "bn" ? [`${key}.bn`, key] : [key];
  const rows = await prisma.notificationTemplate.findMany({ where: { key: { in: keys }, channel, isActive: true } });
  const row = keys.map((k) => rows.find((r) => r.key === k)).find(Boolean);
  const def = DEFAULT_TEMPLATES[key];
  const params = (def?.vars ?? []).map((v) => (vars[v] === null || vars[v] === undefined ? "" : String(vars[v])));
  if (row) {
    return { subject: interpolate(row.subject ?? def?.subject[lang] ?? key, vars), body: interpolate(row.body, vars), source: "db", params };
  }
  if (!def) throw new Error(`Unknown notification template: ${key}`);
  return { subject: interpolate(def.subject[lang], vars), body: interpolate(def.body[lang], vars), source: "default", params };
}
