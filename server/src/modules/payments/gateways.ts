import { env, isProd } from "../../config/env.js";
import { money } from "../../lib/money.js";
import { hmacSha256, safeEqual } from "../../lib/crypto.js";

/**
 * Online payment gateways. The browser only ever gets a redirect URL; whether money was received is
 * decided server-side by the gateway's own validation API (never by the redirect alone).
 */
export interface InitInput {
  transactionId: string; // our unique tran_id (Payment.transactionId)
  amount: string;
  orderNumber: string;
  customerName: string;
  customerPhone: string;
  customerEmail?: string | null;
  address: string;
  successUrl: string;
  failUrl: string;
  cancelUrl: string;
  ipnUrl: string;
}

export interface ValidationResult {
  valid: boolean;
  transactionId: string;
  amount: string | null;
  currency: string | null;
  gatewayRef: string | null; // bank / gateway transaction id
  raw: unknown;
  reason?: string;
}

export interface PaymentGateway {
  code: string;
  name: string;
  configured(): boolean;
  init(input: InitInput): Promise<{ redirectUrl: string; sessionKey?: string; raw?: unknown }>;
  /** Validate a callback payload with the gateway itself. */
  validate(payload: Record<string, unknown>): Promise<ValidationResult>;
}

// ───────────── SSLCommerz (covers cards, bKash, Nagad, Rocket via its aggregator) ─────────────
// Docs: https://developer.sslcommerz.com/doc/v4/
const sslBase = () => (env.SSLCOMMERZ_SANDBOX ? "https://sandbox.sslcommerz.com" : "https://securepay.sslcommerz.com");

export const sslcommerz: PaymentGateway = {
  code: "sslcommerz",
  name: "SSLCommerz",
  configured: () => !!env.SSLCOMMERZ_STORE_ID && !!env.SSLCOMMERZ_STORE_PASSWORD,

  async init(input) {
    const form = new URLSearchParams({
      store_id: env.SSLCOMMERZ_STORE_ID,
      store_passwd: env.SSLCOMMERZ_STORE_PASSWORD,
      total_amount: money(input.amount).toFixed(2),
      currency: "BDT",
      tran_id: input.transactionId,
      success_url: input.successUrl,
      fail_url: input.failUrl,
      cancel_url: input.cancelUrl,
      ipn_url: input.ipnUrl,
      shipping_method: "Courier",
      product_name: `Order ${input.orderNumber}`,
      product_category: "Fashion",
      product_profile: "physical-goods",
      cus_name: input.customerName,
      cus_email: input.customerEmail || "noreply@bentandbound.com",
      cus_add1: input.address.slice(0, 200),
      cus_city: "Dhaka",
      cus_country: "Bangladesh",
      cus_phone: input.customerPhone,
      ship_name: input.customerName,
      ship_add1: input.address.slice(0, 200),
      ship_city: "Dhaka",
      ship_postcode: "1000",
      ship_country: "Bangladesh",
      value_a: input.orderNumber,
    });
    const res = await fetch(`${sslBase()}/gwprocess/v4/api.php`, { method: "POST", body: form, signal: AbortSignal.timeout(20_000) });
    const body = (await res.json()) as { status?: string; GatewayPageURL?: string; sessionkey?: string; failedreason?: string };
    if (body.status !== "SUCCESS" || !body.GatewayPageURL) throw new Error(`SSLCommerz init failed: ${body.failedreason ?? body.status ?? res.status}`);
    return { redirectUrl: body.GatewayPageURL, sessionKey: body.sessionkey, raw: { status: body.status, sessionkey: body.sessionkey } };
  },

  async validate(payload) {
    const valId = String(payload.val_id ?? "");
    const tranId = String(payload.tran_id ?? "");
    if (!valId) return { valid: false, transactionId: tranId, amount: null, currency: null, gatewayRef: null, raw: payload, reason: "missing val_id" };
    const url = new URL(`${sslBase()}/validator/api/validationserverAPI.php`);
    url.search = new URLSearchParams({ val_id: valId, store_id: env.SSLCOMMERZ_STORE_ID, store_passwd: env.SSLCOMMERZ_STORE_PASSWORD, format: "json" }).toString();
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    const body = (await res.json()) as Record<string, string>;
    const valid = body.status === "VALID" || body.status === "VALIDATED";
    return {
      valid,
      transactionId: body.tran_id ?? tranId,
      amount: body.amount ?? null,
      currency: body.currency_type ?? body.currency ?? null,
      gatewayRef: body.bank_tran_id ?? null,
      raw: { status: body.status, tran_id: body.tran_id, amount: body.amount, currency: body.currency_type, card_type: body.card_type, bank_tran_id: body.bank_tran_id, risk_level: body.risk_level },
      reason: valid ? undefined : `gateway status ${body.status}`,
    };
  },
};

// ───────────── Sandbox gateway (development / tests only) ─────────────
const sandboxSecret = () => `${env.SESSION_SECRET}:sandbox-gateway`;
export const sandboxSignature = (tranId: string, amount: string, status: string) => hmacSha256(sandboxSecret(), `${tranId}|${money(amount).toFixed(2)}|${status}`);

export const sandboxGateway: PaymentGateway = {
  code: "sandbox",
  name: "Sandbox gateway (no real money)",
  configured: () => !isProd,
  async init(input) {
    const q = new URLSearchParams({ tran_id: input.transactionId, amount: money(input.amount).toFixed(2), success: input.successUrl, fail: input.failUrl });
    return { redirectUrl: `${env.CLIENT_URL.split(",")[0]}/checkout/sandbox-pay?${q}` };
  },
  async validate(payload) {
    const tranId = String(payload.tran_id ?? "");
    const amount = String(payload.amount ?? "");
    const status = String(payload.status ?? "");
    const sig = String(payload.signature ?? "");
    const ok = !!sig && safeEqual(sig, sandboxSignature(tranId, amount || "0", status)) && status === "VALID";
    return { valid: ok, transactionId: tranId, amount, currency: "BDT", gatewayRef: `SANDBOX-${tranId}`, raw: payload, reason: ok ? undefined : "invalid sandbox signature or status" };
  },
};

const gateways = new Map([sslcommerz, sandboxGateway].map((g) => [g.code, g]));
export const getGateway = (code: string) => gateways.get(code) ?? null;

export const gatewayStatus = () => [
  { code: sslcommerz.code, name: sslcommerz.name, configured: sslcommerz.configured(), sandbox: env.SSLCOMMERZ_SANDBOX },
  { code: sandboxGateway.code, name: sandboxGateway.name, configured: sandboxGateway.configured(), sandbox: true },
  { code: "bkash", name: "bKash (direct)", configured: false, note: "Not implemented – use SSLCommerz (includes bKash) or record bKash payments manually with the transaction id" },
  { code: "nagad", name: "Nagad (direct)", configured: false, note: "Not implemented – use SSLCommerz (includes Nagad) or record Nagad payments manually" },
];
