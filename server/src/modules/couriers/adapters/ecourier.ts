import { courierFetch } from "../http.js";
import { CourierError, type CourierAdapter, type CourierContext, type CreateShipmentResult } from "../types.js";
import { mapStatus, required, takaInt } from "./common.js";
import { money } from "../../../lib/money.js";

/**
 * eCourier merchant API v5.1 (official PDF, 2021):
 * https://ecourier.com.bd/wp-content/uploads/eCourier_Merchant_API_Document_General_v5.1.pdf
 * No webhooks are documented, so shipments are kept up to date by polling (worker job).
 */
const base = (ctx: CourierContext) => (ctx.sandbox ? "https://staging.ecourier.com.bd/api" : "https://backoffice.ecourier.com.bd/api");

const STATUS_MAP = {
  initiated: "BOOKED",
  initiated_api: "BOOKED",
  picked_up: "PICKED_UP",
  in_source_branch: "IN_TRANSIT",
  in_transit: "IN_TRANSIT",
  in_destination_branch: "IN_TRANSIT",
  on_the_way_to_delivery: "IN_TRANSIT",
  delivered: "DELIVERED",
  cancelled: "CANCELLED",
} as const;

const headers = (ctx: CourierContext) => {
  required(ctx.credentials, "apiKey", "apiSecret", "userId");
  return { "API-KEY": ctx.credentials.apiKey, "API-SECRET": ctx.credentials.apiSecret, "USER-ID": ctx.credentials.userId };
};

type TrackRow = { ecr?: string; product_id?: string; status?: [string, string, string][]; shipping_price?: string | number };

function latest(row: TrackRow | undefined) {
  const s = row?.status?.at(-1);
  return { raw: s?.[0] ?? "", at: s?.[2] ? new Date(s[2]) : new Date() };
}

/** eCourier's product_id (our reference) is limited to 20 characters. */
const ref20 = (reference: string) => reference.slice(0, 20);

export const ecourierAdapter: CourierAdapter = {
  code: "ECOURIER",
  name: "eCourier",
  docsUrl: "https://ecourier.com.bd/wp-content/uploads/eCourier_Merchant_API_Document_General_v5.1.pdf",
  capabilities: {
    createShipment: true, trackShipment: true, cancelShipment: true, webhooks: false, labels: true,
    returnPickup: false, settlementApi: false, sandbox: true, requiresLocationIds: true, lookupByReference: true,
  },
  credentialFields: [
    { key: "apiKey", label: "API key", secret: true, required: true },
    { key: "apiSecret", label: "API secret", secret: true, required: true },
    { key: "userId", label: "User ID", secret: false, required: true },
  ],
  statusMap: STATUS_MAP,
  notes: [
    "Set config.packageCode (from eCourier's /packages list) and config.defaultZip.",
    "City / thana / area are sent by name (our district / area); use config.thanaMap {\"Our area\": \"eCourier thana\"} for differences.",
    "No webhooks: statuses are refreshed by the background worker every 30 minutes, or with “Sync” on a shipment.",
    "Cancellation works only while the parcel is still “Initiated”.",
  ],

  async createShipment(ctx, req) {
    if (!ctx.config.packageCode) throw new CourierError("eCourier package code is not configured (config.packageCode)", false);
    const thanaMap = (ctx.config.thanaMap ?? {}) as Record<string, string>;
    const city = req.districtName ?? "Dhaka";
    const thana = (req.areaName && thanaMap[req.areaName]) || req.areaName || city;
    const res = await courierFetch<{ response_code?: number; message?: string; ID?: string; errors?: unknown[] }>(ctx, "create", `${base(ctx)}/order-place`, {
      headers: headers(ctx),
      body: {
        recipient_name: req.recipientName.slice(0, 250),
        recipient_mobile: req.recipientPhone,
        recipient_city: city.slice(0, 40),
        recipient_thana: thana.slice(0, 40),
        recipient_area: (req.areaName ?? thana).slice(0, 40),
        recipient_address: req.recipientAddress,
        recipient_zip: String(ctx.config.defaultZip ?? "1000"),
        package_code: String(ctx.config.packageCode),
        product_price: takaInt(req.codAmount),
        payment_method: "COD",
        parcel_type: "BOX",
        product_id: ref20(req.merchantReference),
        number_of_item: req.itemQuantity,
        comments: req.note ?? "",
      },
    });
    if (res.response_code !== 200 || !res.ID) throw new CourierError(res.message ?? `eCourier rejected the order ${JSON.stringify(res.errors ?? [])}`, false);
    return { consignmentId: res.ID, trackingCode: res.ID, rawStatus: "Initiated API", status: "BOOKED", raw: res };
  },

  async findByReference(ctx, reference): Promise<CreateShipmentResult | null> {
    const res = await courierFetch<{ query_data?: TrackRow[] }>(ctx, "lookup", `${base(ctx)}/track`, { headers: headers(ctx), body: { product_id: ref20(reference) } });
    const row = res.query_data?.[0];
    if (!row?.ecr) return null;
    const l = latest(row);
    return { consignmentId: row.ecr, trackingCode: row.ecr, rawStatus: l.raw, status: mapStatus(STATUS_MAP, l.raw) ?? "BOOKED" };
  },

  async track(ctx, ref) {
    const res = await courierFetch<{ query_data?: TrackRow[] }>(ctx, "track", `${base(ctx)}/track`, { headers: headers(ctx), body: { ecr: ref.trackingCode ?? ref.consignmentId } });
    const row = res.query_data?.[0];
    const l = latest(row);
    return { rawStatus: l.raw, status: mapStatus(STATUS_MAP, l.raw), occurredAt: l.at, deliveryFee: row?.shipping_price != null ? money(row.shipping_price).toFixed(2) : null };
  },

  async cancel(ctx, ref) {
    const res = await courierFetch<{ success?: string | boolean; message?: string }>(ctx, "cancel", `${base(ctx)}/cancel-order`, {
      headers: headers(ctx),
      body: { tracking: ref.trackingCode ?? ref.consignmentId, comment: "Cancelled by merchant" },
    });
    if (String(res.success) !== "true") throw new CourierError(res.message ?? "eCourier refused the cancellation (only possible while Initiated)", false);
  },

  async label(ctx, ref) {
    const res = await courierFetch<{ query_data?: string }>(ctx, "label", `${base(ctx)}/label-print`, { headers: headers(ctx), body: { tracking: ref.trackingCode ?? ref.consignmentId } });
    if (!res.query_data) throw new CourierError("eCourier did not return a label", false);
    return res.query_data;
  },
};
