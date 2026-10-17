import { courierFetch } from "../http.js";
import { CourierError, type CourierAdapter, type CourierContext } from "../types.js";
import { header, mapStatus, required, secretMatches, takaInt } from "./common.js";

/**
 * Steadfast Courier (Packzy) merchant API.
 * Source: official Postman collection https://documenter.getpostman.com/view/26211192/2sAYJ1mhpk
 * and the official WordPress plugin "steadfast-api". No sandbox exists – use with care.
 */
const BASE = "https://portal.packzy.com/api/v1";

const STATUS_MAP = {
  pending: "BOOKED",
  in_review: "BOOKED",
  hold: null,
  delivered_approval_pending: null, // courier admin has not approved yet; wait for "delivered"
  partial_delivered_approval_pending: null,
  cancelled_approval_pending: null,
  unknown_approval_pending: null,
  delivered: "DELIVERED",
  partial_delivered: "PARTIALLY_DELIVERED",
  cancelled: "CANCELLED", // after pickup this means the parcel is returning to us (handled by the shipment service)
  unknown: null,
} as const;

const headers = (ctx: CourierContext) => {
  required(ctx.credentials, "apiKey", "secretKey");
  return { "Api-Key": ctx.credentials.apiKey, "Secret-Key": ctx.credentials.secretKey };
};

type Consignment = { consignment_id: number | string; tracking_code: string; status: string; invoice: string };

export const steadfastAdapter: CourierAdapter = {
  code: "STEADFAST",
  name: "Steadfast Courier",
  docsUrl: "https://documenter.getpostman.com/view/26211192/2sAYJ1mhpk",
  capabilities: {
    createShipment: true, trackShipment: true, cancelShipment: false, webhooks: true, labels: false,
    returnPickup: true, settlementApi: false, sandbox: false, requiresLocationIds: false, lookupByReference: false,
  },
  credentialFields: [
    { key: "apiKey", label: "API key", secret: true, required: true },
    { key: "secretKey", label: "Secret key", secret: true, required: true },
  ],
  statusMap: STATUS_MAP,
  confirmWebhooksViaApi: true,
  notes: [
    "Steadfast has no sandbox: bookings are real parcels.",
    "Cancellation is not available through the API – cancel in the Steadfast portal, then mark the shipment cancelled here.",
    "Invoices must be unique, so a retried booking can never create a second parcel; a duplicate is reported as a failure to check in the portal.",
    "Webhook: set the callback URL and an Authorization token (our webhook secret) under API → Webhook in the merchant dashboard.",
  ],

  async createShipment(ctx, req) {
    const res = await courierFetch<{ status: number; message?: string; consignment?: Consignment }>(ctx, "create", `${BASE}/create_order`, {
      headers: headers(ctx),
      body: {
        invoice: req.merchantReference,
        recipient_name: req.recipientName.slice(0, 100),
        recipient_phone: req.recipientPhone,
        recipient_address: req.recipientAddress.slice(0, 250),
        cod_amount: takaInt(req.codAmount),
        note: req.note ?? "",
        item_description: req.itemDescription,
      },
    });
    if (res.status !== 200 || !res.consignment) {
      const msg = res.message ?? "Steadfast rejected the order";
      // duplicate invoice means a parcel already exists – never retry blindly
      throw new CourierError(/exist/i.test(msg) ? `${msg} – check the Steadfast portal for invoice ${req.merchantReference}` : msg, false);
    }
    const c = res.consignment;
    return { consignmentId: String(c.consignment_id), trackingCode: c.tracking_code, rawStatus: c.status, status: mapStatus(STATUS_MAP, c.status) ?? "BOOKED", raw: res };
  },

  async track(ctx, ref) {
    if (!ref.consignmentId) throw new CourierError("Missing consignment id", false);
    const res = await courierFetch<{ status: number; delivery_status: string }>(ctx, "track", `${BASE}/status_by_cid/${encodeURIComponent(ref.consignmentId)}`, { headers: headers(ctx) });
    return { rawStatus: res.delivery_status, status: mapStatus(STATUS_MAP, res.delivery_status), occurredAt: new Date() };
  },

  verifyWebhook(ctx, req) {
    const auth = header(req, "authorization");
    const bearer = auth?.startsWith("Bearer ") ? auth.slice(7).trim() : undefined;
    // the official plugin also accepts ?token= when a proxy strips the header
    const query = req.query?.token;
    return secretMatches(ctx.webhookSecret, bearer) || secretMatches(ctx.webhookSecret, query);
  },

  parseWebhook(_ctx, req) {
    const b = req.body as Record<string, unknown>;
    const raw = String(b.status ?? b.delivery_status ?? "");
    return [{
      consignmentId: b.consignment_id != null ? String(b.consignment_id) : null,
      trackingCode: b.tracking_code ? String(b.tracking_code) : null,
      merchantReference: b.invoice ? String(b.invoice) : null,
      rawStatus: raw,
      status: mapStatus(STATUS_MAP, raw),
      occurredAt: b.updated_at ? new Date(String(b.updated_at)) : new Date(),
      payload: b,
    }];
  },
};
