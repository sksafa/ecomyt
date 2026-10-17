import { courierFetch } from "../http.js";
import { CourierError, type CourierAdapter, type CourierContext } from "../types.js";
import { header, mapStatus, required, secretMatches, takaInt } from "./common.js";

/**
 * Pathao Courier merchant API ("Aladdin").
 * Source: Pathao's official WooCommerce plugin https://github.com/pathao-eng/courier-woocommerce-plugin
 * (the developer docs portal requires a merchant login). Order-info and cancel paths come from community
 * SDKs and are flagged "unverified".
 */
const base = (ctx: CourierContext) => (ctx.sandbox ? "https://courier-api-sandbox.pathao.com" : "https://api-hermes.pathao.com");

/** Fixed handshake value from Pathao's official plugin (webhook integration check). */
const INTEGRATION_HEADER = "X-Pathao-Merchant-Webhook-Integration-Secret";
const INTEGRATION_VALUE = "f3992ecc-59da-4cbe-a049-a13da2018d51";

const STATUS_MAP = {
  "order.created": "BOOKED", order_created: "BOOKED", pending: "BOOKED",
  "order.updated": null, order_updated: null,
  "order.pickup-requested": "BOOKED", pickup_requested: "BOOKED",
  "order.assigned-for-pickup": "BOOKED", assigned_for_pickup: "BOOKED",
  "order.picked": "PICKED_UP", picked: "PICKED_UP",
  "order.pickup-failed": null, pickup_failed: null,
  "order.pickup-cancelled": "CANCELLED", pickup_cancelled: "CANCELLED",
  "order.at-the-sorting-hub": "IN_TRANSIT", at_the_sorting_hub: "IN_TRANSIT",
  "order.in-transit": "IN_TRANSIT", in_transit: "IN_TRANSIT",
  "order.received-at-last-mile-hub": "IN_TRANSIT", received_at_last_mile_hub: "IN_TRANSIT",
  "order.assigned-for-delivery": "IN_TRANSIT", assigned_for_delivery: "IN_TRANSIT",
  "order.delivered": "DELIVERED", delivered: "DELIVERED",
  "order.partial-delivery": "PARTIALLY_DELIVERED", partial_delivery: "PARTIALLY_DELIVERED",
  "order.return-in-transit": "RETURNING",
  "order.returned": "RETURNED", return: "RETURNED", returned: "RETURNED",
  "order.returned-to-merchant": "RETURNED",
  "order.paid-return": "RETURNED", paid_return: "RETURNED",
  "order.delivery-failed": null, delivery_failed: null,
  "order.on-hold": null, on_hold: null,
  "order.exchanged": null, exchange: null,
  "order.paid": null, payment_invoice: null,
} as const;

const tokens = new Map<string, { token: string; expiresAt: number }>();

async function token(ctx: CourierContext): Promise<string> {
  const cached = tokens.get(ctx.providerId);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
  required(ctx.credentials, "clientId", "clientSecret");
  const { clientId, clientSecret, username, password } = ctx.credentials;
  // username/password → classic password grant; otherwise the client-credential login used by Pathao's current plugin
  const res = username && password
    ? await courierFetch<{ access_token: string; expires_in?: number }>(ctx, "auth", `${base(ctx)}/aladdin/api/v1/issue-token`, {
        body: { client_id: clientId, client_secret: clientSecret, username, password, grant_type: "password" },
      })
    : await courierFetch<{ access_token: string; expires_in?: number }>(ctx, "auth", `${base(ctx)}/aladdin/api/v1/external/login`, {
        body: { client_id: clientId, client_secret: clientSecret },
      });
  if (!res.access_token) throw new CourierError("Pathao authentication failed", false);
  tokens.set(ctx.providerId, { token: res.access_token, expiresAt: Date.now() + (res.expires_in ?? 3600) * 1000 });
  return res.access_token;
}

const auth = async (ctx: CourierContext) => ({ Authorization: `Bearer ${await token(ctx)}` });

export const pathaoAdapter: CourierAdapter = {
  code: "PATHAO",
  name: "Pathao Courier",
  docsUrl: "https://github.com/pathao-eng/courier-woocommerce-plugin",
  capabilities: {
    createShipment: true, trackShipment: true, cancelShipment: false, webhooks: true, labels: false,
    returnPickup: false, settlementApi: false, sandbox: true, requiresLocationIds: false, lookupByReference: false,
  },
  unverified: ["trackShipment"],
  credentialFields: [
    { key: "clientId", label: "Client ID", secret: false, required: true },
    { key: "clientSecret", label: "Client secret", secret: true, required: true },
    { key: "username", label: "Merchant email (password grant, optional)", secret: false, required: false },
    { key: "password", label: "Merchant password (password grant, optional)", secret: true, required: false },
  ],
  statusMap: STATUS_MAP,
  confirmWebhooksViaApi: true,
  notes: [
    "Set config.storeId to your Pathao store id (Merchant panel → Stores).",
    "Recipient city/zone/area are auto-detected by Pathao from the address.",
    "Cancellation is not available through the official API – cancel in the Pathao portal, then mark it cancelled here.",
    "Webhook: set the URL and a webhook secret in Merchant panel → Developer API; paste our webhook secret there.",
  ],

  async createShipment(ctx, req) {
    const storeId = Number(ctx.config.storeId);
    if (!storeId) throw new CourierError("Pathao store id is not configured (config.storeId)", false);
    const res = await courierFetch<{ data?: { consignment_id: string; merchant_order_id: string; order_status: string; delivery_fee?: number } ; message?: string }>(
      ctx, "create", `${base(ctx)}/aladdin/api/v1/orders`,
      {
        headers: await auth(ctx),
        body: {
          store_id: storeId,
          merchant_order_id: req.merchantReference,
          recipient_name: req.recipientName.slice(0, 100),
          recipient_phone: req.recipientPhone,
          recipient_address: req.recipientAddress.slice(0, 220),
          delivery_type: 48, // normal delivery
          item_type: 2, // parcel
          special_instruction: req.note ?? "",
          item_quantity: req.itemQuantity,
          item_weight: Math.min(10, Math.max(0.5, Math.round(req.weightGrams / 100) / 10)),
          item_description: req.itemDescription,
          amount_to_collect: takaInt(req.codAmount),
        },
      },
    );
    if (!res.data?.consignment_id) throw new CourierError(res.message ?? "Pathao did not return a consignment id", false);
    return {
      consignmentId: res.data.consignment_id,
      trackingCode: res.data.consignment_id,
      rawStatus: res.data.order_status ?? "Pending",
      status: "BOOKED",
      deliveryFee: res.data.delivery_fee != null ? String(res.data.delivery_fee) : null,
      raw: res,
    };
  },

  async track(ctx, ref) {
    if (!ref.consignmentId) throw new CourierError("Missing consignment id", false);
    const res = await courierFetch<{ data?: { order_status?: string; order_status_slug?: string; updated_at?: string } }>(
      ctx, "track", `${base(ctx)}/aladdin/api/v1/orders/${encodeURIComponent(ref.consignmentId)}/info`, { headers: await auth(ctx) },
    );
    const raw = res.data?.order_status_slug ?? res.data?.order_status ?? "";
    return { rawStatus: raw, status: mapStatus(STATUS_MAP, raw), occurredAt: res.data?.updated_at ? new Date(res.data.updated_at) : new Date() };
  },

  webhookHandshake(_ctx, req) {
    const b = req.body as Record<string, unknown>;
    if (b?.event === "webhook_integration") return { status: 202, headers: { [INTEGRATION_HEADER]: INTEGRATION_VALUE }, body: { ok: true } };
    return null;
  },

  verifyWebhook(ctx, req) {
    // Pathao sends the configured secret verbatim (no HMAC); it defaults to the client secret.
    const given = header(req, "x-pathao-signature");
    return secretMatches(ctx.webhookSecret ?? ctx.credentials.clientSecret ?? null, given);
  },

  parseWebhook(_ctx, req) {
    const b = req.body as Record<string, unknown>;
    const raw = String(b.event ?? b.order_status ?? "");
    return [{
      eventId: null,
      consignmentId: b.consignment_id ? String(b.consignment_id) : null,
      merchantReference: b.merchant_order_id ? String(b.merchant_order_id) : null,
      rawStatus: raw,
      status: mapStatus(STATUS_MAP, raw),
      occurredAt: b.updated_at ? new Date(String(b.updated_at)) : b.timestamp ? new Date(String(b.timestamp)) : new Date(),
      payload: b,
    }];
  },
};
