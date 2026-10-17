import { courierFetch } from "../http.js";
import { CourierError, type CourierAdapter, type CourierContext } from "../types.js";
import { mapStatus, required, secretMatches, takaInt } from "./common.js";
import { money } from "../../../lib/money.js";

/**
 * RedX open API. Source: official developer page https://redx.com.bd/developer-api/
 * Webhooks carry no signature; RedX recommends a token in the callback URL query string.
 */
const base = (ctx: CourierContext) => (ctx.sandbox ? "https://sandbox.redx.com.bd/v1.0.0-beta" : "https://openapi.redx.com.bd/v1.0.0-beta");

const STATUS_MAP = {
  "pickup-pending": "BOOKED",
  "ready-for-delivery": "PICKED_UP",
  "delivery-in-progress": "IN_TRANSIT",
  delivered: "DELIVERED",
  "agent-hold": null,
  "agent-returning": "RETURNING",
  returned: "RETURNED",
  "agent-area-change": null,
  paid: null,
  cancelled: "CANCELLED",
} as const;

const headers = (ctx: CourierContext) => {
  required(ctx.credentials, "accessToken");
  return { "API-ACCESS-TOKEN": `Bearer ${ctx.credentials.accessToken}` };
};

type Area = { id: number; name: string; post_code?: number; division_name?: string; zone_id?: number };
const areaCache = new Map<string, { at: number; areas: Area[] }>();

/** Map our district/area to a RedX delivery area id: explicit config.areaMap first, then exact name match. */
async function resolveArea(ctx: CourierContext, district: string | null, area: string | null): Promise<Area> {
  const map = (ctx.config.areaMap ?? {}) as Record<string, number>;
  const mapped = (area && map[area]) || (district && map[district]);
  if (mapped) return { id: Number(mapped), name: area ?? district ?? "" };
  if (!district) throw new CourierError("District is required for RedX bookings", false);
  const key = `${ctx.providerId}:${district.toLowerCase()}`;
  let entry = areaCache.get(key);
  if (!entry || Date.now() - entry.at > 24 * 3_600_000) {
    const res = await courierFetch<{ areas: Area[] }>(ctx, "areas", `${base(ctx)}/areas?district_name=${encodeURIComponent(district)}`, { headers: headers(ctx) });
    entry = { at: Date.now(), areas: res.areas ?? [] };
    areaCache.set(key, entry);
  }
  const wanted = (area ?? district).toLowerCase();
  const hit = entry.areas.find((a) => a.name.toLowerCase() === wanted) ?? (area ? entry.areas.find((a) => a.name.toLowerCase().startsWith(wanted)) : undefined);
  if (!hit) throw new CourierError(`No RedX delivery area matches "${area ?? district}". Add it to the RedX area map in courier settings.`, false);
  return hit;
}

export const redxAdapter: CourierAdapter = {
  code: "REDX",
  name: "RedX",
  docsUrl: "https://redx.com.bd/developer-api/",
  capabilities: {
    createShipment: true, trackShipment: true, cancelShipment: true, webhooks: true, labels: false,
    returnPickup: false, settlementApi: false, sandbox: true, requiresLocationIds: true, lookupByReference: false,
  },
  credentialFields: [{ key: "accessToken", label: "API access token (JWT)", secret: true, required: true }],
  statusMap: STATUS_MAP,
  confirmWebhooksViaApi: true,
  notes: [
    "Each environment (sandbox / production) has its own token.",
    "Delivery areas are matched by name within the district; use config.areaMap {\"Our area\": redxAreaId} for exceptions.",
    "Optional config.pickupStoreId selects the pickup store.",
    "Webhook URL must include ?token=<our webhook secret> – RedX does not sign webhooks.",
  ],

  async createShipment(ctx, req) {
    const area = await resolveArea(ctx, req.districtName, req.areaName);
    const res = await courierFetch<{ tracking_id?: string; message?: string }>(ctx, "create", `${base(ctx)}/parcel`, {
      headers: headers(ctx),
      body: {
        customer_name: req.recipientName.slice(0, 100),
        customer_phone: req.recipientPhone,
        delivery_area: area.name,
        delivery_area_id: area.id,
        customer_address: req.recipientAddress,
        merchant_invoice_id: req.merchantReference,
        cash_collection_amount: String(takaInt(req.codAmount)),
        parcel_weight: String(req.weightGrams),
        instruction: req.note ?? "",
        value: String(takaInt(req.codAmount)),
        ...(ctx.config.pickupStoreId ? { pickup_store_id: Number(ctx.config.pickupStoreId) } : {}),
        parcel_details_json: [{ name: req.itemDescription.slice(0, 100), category: "Fashion", value: takaInt(req.codAmount) }],
      },
    });
    if (!res.tracking_id) throw new CourierError(res.message ?? "RedX did not return a tracking id", false);
    return { consignmentId: res.tracking_id, trackingCode: res.tracking_id, rawStatus: "pickup-pending", status: "BOOKED", raw: res };
  },

  async track(ctx, ref) {
    const id = ref.trackingCode ?? ref.consignmentId;
    if (!id) throw new CourierError("Missing tracking id", false);
    const res = await courierFetch<{ parcel?: { status: string; charge?: number | string } }>(ctx, "track", `${base(ctx)}/parcel/info/${encodeURIComponent(id)}`, { headers: headers(ctx) });
    const raw = res.parcel?.status ?? "";
    return {
      rawStatus: raw,
      status: mapStatus(STATUS_MAP, raw),
      occurredAt: new Date(),
      deliveryFee: res.parcel?.charge != null ? money(res.parcel.charge).toFixed(2) : null,
    };
  },

  async cancel(ctx, ref) {
    const id = ref.trackingCode ?? ref.consignmentId;
    const res = await courierFetch<{ success?: boolean; message?: string }>(ctx, "cancel", `${base(ctx)}/parcels`, {
      method: "PATCH",
      headers: headers(ctx),
      body: { entity_type: "parcel-tracking-id", entity_id: id, update_details: { property_name: "status", new_value: "cancelled", reason: "Cancelled by merchant" } },
    });
    if (res.success === false) throw new CourierError(res.message ?? "RedX refused the cancellation", false);
  },

  verifyWebhook(ctx, req) {
    const token = req.query?.token;
    return secretMatches(ctx.webhookSecret, token);
  },

  parseWebhook(_ctx, req) {
    const b = req.body as Record<string, unknown>;
    const raw = String(b.status ?? "");
    return [{
      trackingCode: b.tracking_number ? String(b.tracking_number) : null,
      consignmentId: b.tracking_number ? String(b.tracking_number) : null,
      merchantReference: b.invoice_number ? String(b.invoice_number) : null,
      rawStatus: raw,
      status: mapStatus(STATUS_MAP, raw),
      occurredAt: b.timestamp ? new Date(String(b.timestamp)) : new Date(),
      payload: b,
    }];
  },
};
