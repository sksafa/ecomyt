import { logger } from "../../lib/logger.js";
import { sendMail } from "../../lib/mailer.js";

/**
 * Outbound channel adapters.
 *
 * Every adapter returns a DeliveryResult instead of pretending success:
 *   SENT    – handed to the real provider, which accepted it
 *   SKIPPED – deliberately not sent (provider not configured, logged only); `reason` says why
 * Thrown errors mean "failed, may be retried" (the notifications worker retries with backoff).
 */
export interface DeliveryResult {
  status: "SENT" | "SKIPPED";
  reason?: string;
  providerMessageId?: string;
}

/** Thrown for permanent failures that must not be retried (e.g. invalid number, rejected template). */
export class PermanentDeliveryError extends Error {}

// ───────────── SMS ─────────────

/**
 * SMS gateway adapter. To add a real Bangladesh gateway (e.g. a BTRC-licensed aggregator such as
 * SSL Wireless, BulkSMSBD, Alpha SMS, or a mobile operator's official A2P API):
 *   1. implement this interface in `sms-<provider>.ts` using ONLY the provider's documented HTTP API
 *      with a registered/approved sender id (masking or non-masking) – never scrape or use unofficial APIs;
 *   2. read the API key / sender id from environment variables (never commit them);
 *   3. call `setSmsProvider(new YourProvider(...))` at process start (src/worker.ts and src/index.ts).
 * `to` is E.164 (+8801XXXXXXXXX). Bengali text is sent as Unicode (70 chars per segment).
 * Throw PermanentDeliveryError for invalid numbers / rejected content, any other Error to retry.
 */
export interface SmsProvider {
  readonly name: string;
  send(to: string, text: string): Promise<DeliveryResult>;
}

/** Default provider: writes the SMS to the log only. Marked SKIPPED so nobody mistakes it for a delivery. */
export class LogSmsProvider implements SmsProvider {
  readonly name = "log";
  readonly sent: { to: string; text: string }[] = [];
  async send(to: string, text: string): Promise<DeliveryResult> {
    this.sent.push({ to, text });
    if (this.sent.length > 200) this.sent.shift();
    logger.info({ to, text }, "sms (no gateway configured – logged only)");
    return { status: "SKIPPED", reason: "No SMS gateway configured – logged only" };
  }
}

let smsProvider: SmsProvider = new LogSmsProvider();
export const getSmsProvider = () => smsProvider;
export const setSmsProvider = (p: SmsProvider) => {
  smsProvider = p;
};

// ───────────── WhatsApp (official Business Cloud API) ─────────────

export interface WhatsAppTemplateMessage {
  /** Name of a template approved in WhatsApp Manager (defaults to the notification key with '.' → '_'). */
  templateName: string;
  languageCode: string; // "en" | "bn" …
  bodyParams: string[];
}

export interface WhatsAppProvider {
  readonly name: string;
  isConfigured(): boolean;
  sendTemplate(toE164: string, msg: WhatsAppTemplateMessage): Promise<DeliveryResult>;
}

export const WHATSAPP_GRAPH_VERSION = "v21.0";

/**
 * WhatsApp Business Cloud API (Meta). Only active when both are set in the environment:
 *   WHATSAPP_ACCESS_TOKEN     – permanent system-user token with whatsapp_business_messaging
 *   WHATSAPP_PHONE_NUMBER_ID  – the sending phone number id from WhatsApp Manager
 * Business-initiated messages must use pre-approved templates, so only template messages are sent.
 */
export class WhatsAppCloudProvider implements WhatsAppProvider {
  readonly name = "whatsapp-cloud";
  constructor(
    private readonly token = process.env.WHATSAPP_ACCESS_TOKEN ?? "",
    private readonly phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID ?? "",
  ) {}

  isConfigured() {
    return Boolean(this.token && this.phoneNumberId);
  }

  async sendTemplate(toE164: string, msg: WhatsAppTemplateMessage): Promise<DeliveryResult> {
    if (!this.isConfigured()) return { status: "SKIPPED", reason: "WhatsApp Cloud API not configured (WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID)" };
    const url = `https://graph.facebook.com/${WHATSAPP_GRAPH_VERSION}/${encodeURIComponent(this.phoneNumberId)}/messages`;
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: toE164.replace(/^\+/, ""),
        type: "template",
        template: {
          name: msg.templateName,
          language: { code: msg.languageCode },
          components: msg.bodyParams.length ? [{ type: "body", parameters: msg.bodyParams.map((text) => ({ type: "text", text })) }] : [],
        },
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await res.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { message?: string } };
    if (!res.ok) {
      const message = `WhatsApp API ${res.status}: ${json.error?.message ?? "request failed"}`;
      if (res.status >= 400 && res.status < 500 && res.status !== 429) throw new PermanentDeliveryError(message);
      throw new Error(message);
    }
    return { status: "SENT", providerMessageId: json.messages?.[0]?.id };
  }
}

let whatsappProvider: WhatsAppProvider = new WhatsAppCloudProvider();
export const getWhatsAppProvider = () => whatsappProvider;
export const setWhatsAppProvider = (p: WhatsAppProvider) => {
  whatsappProvider = p;
};

// ───────────── Email ─────────────

export async function sendEmail(to: string, subject: string, text: string): Promise<DeliveryResult> {
  const r = await sendMail(to, subject, text);
  return r.delivered ? { status: "SENT" } : { status: "SKIPPED", reason: "SMTP not configured – logged only" };
}
