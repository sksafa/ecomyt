import { randomBytes } from "node:crypto";
import { hmacSha256, safeEqual } from "../../../lib/crypto.js";
import { money } from "../../../lib/money.js";
import { CourierError, type CourierAdapter, type CreateShipmentResult } from "../types.js";
import { logCourierCall } from "../http.js";

/**
 * Sandbox courier for development and automated tests. Never contacts a real courier.
 * Behaviour can be steered through provider config:
 *   failMode: "none" | "retryable" | "fatal" | "lost_response"
 *   ("lost_response" creates the parcel but throws, simulating a timeout after success)
 * Status changes are simulated through POST /couriers/mock/simulate, which emits a signed webhook.
 */
const parcels = new Map<string, { result: CreateShipmentResult; reference: string; status: string }>();

export const MOCK_STATUS_MAP = {
  pending: "BOOKED",
  picked_up: "PICKED_UP",
  in_transit: "IN_TRANSIT",
  delivered: "DELIVERED",
  partial_delivered: "PARTIALLY_DELIVERED",
  returning: "RETURNING",
  returned: "RETURNED",
  cancelled: "CANCELLED",
  hold: null,
} as const;

export const mockAdapter: CourierAdapter = {
  code: "MOCK",
  name: "Sandbox Courier (mock)",
  capabilities: {
    createShipment: true, trackShipment: true, cancelShipment: true, webhooks: true, labels: true,
    returnPickup: false, settlementApi: false, sandbox: true, requiresLocationIds: false, lookupByReference: true,
  },
  credentialFields: [],
  statusMap: MOCK_STATUS_MAP,

  async createShipment(ctx, req) {
    const started = Date.now();
    const failMode = String(ctx.config.failMode ?? "none");
    if (failMode === "retryable") {
      await logCourierCall(ctx, "create", { request: req, success: false, durationMs: 1, statusCode: 503, error: "Mock: service unavailable" });
      throw new CourierError("Mock courier temporarily unavailable", true, 503);
    }
    if (failMode === "fatal") {
      await logCourierCall(ctx, "create", { request: req, success: false, durationMs: 1, statusCode: 422, error: "Mock: invalid address" });
      throw new CourierError("Mock courier rejected the parcel: invalid recipient address", false, 422);
    }
    const existing = [...parcels.values()].find((p) => p.reference === req.merchantReference);
    if (existing) throw new CourierError(`Invoice ${req.merchantReference} already exists`, false, 409);

    const insideDhaka = (req.districtName ?? "").toLowerCase() === "dhaka";
    const extraKg = Math.max(0, Math.ceil((req.weightGrams - 1000) / 1000));
    const deliveryFee = money(insideDhaka ? 60 : 110).plus(extraKg * 15);
    const consignmentId = `MOCK-${randomBytes(4).toString("hex").toUpperCase()}`;
    const result: CreateShipmentResult = {
      consignmentId,
      trackingCode: `MK${Date.now().toString().slice(-8)}${randomBytes(1).readUInt8(0) % 10}`,
      rawStatus: "pending",
      status: "BOOKED",
      deliveryFee: deliveryFee.toFixed(2),
      codCharge: money(req.codAmount).times("0.01").toFixed(2),
      labelUrl: null,
    };
    parcels.set(consignmentId, { result, reference: req.merchantReference, status: "pending" });
    await logCourierCall(ctx, "create", { request: req, response: result, statusCode: 200, success: true, durationMs: Date.now() - started });
    if (failMode === "lost_response") throw new CourierError("Mock: response lost (timeout after the parcel was created)", true);
    return result;
  },

  async findByReference(_ctx, reference) {
    const hit = [...parcels.values()].find((p) => p.reference === reference);
    return hit ? hit.result : null;
  },

  async track(_ctx, ref) {
    const p = ref.consignmentId ? parcels.get(ref.consignmentId) : undefined;
    if (!p) throw new CourierError("Mock: consignment not found", false, 404);
    return { rawStatus: p.status, status: MOCK_STATUS_MAP[p.status as keyof typeof MOCK_STATUS_MAP] ?? null, occurredAt: new Date() };
  },

  async cancel(_ctx, ref) {
    const p = ref.consignmentId ? parcels.get(ref.consignmentId) : undefined;
    if (!p) throw new CourierError("Mock: consignment not found", false, 404);
    if (!["pending"].includes(p.status)) throw new CourierError("Mock: parcel already picked up, cannot cancel", false, 409);
    p.status = "cancelled";
  },

  verifyWebhook(ctx, req) {
    if (!ctx.webhookSecret) return false;
    const header = req.headers["x-mock-signature"];
    const signature = Array.isArray(header) ? header[0] : header;
    if (!signature) return false;
    return safeEqual(signature, hmacSha256(ctx.webhookSecret, req.rawBody));
  },

  parseWebhook(_ctx, req) {
    const b = req.body as Record<string, unknown>;
    const raw = String(b.status ?? "");
    const p = parcels.get(String(b.consignment_id ?? ""));
    if (p) p.status = raw;
    return [
      {
        eventId: b.event_id ? String(b.event_id) : null,
        consignmentId: b.consignment_id ? String(b.consignment_id) : null,
        trackingCode: b.tracking_code ? String(b.tracking_code) : null,
        merchantReference: b.invoice ? String(b.invoice) : null,
        rawStatus: raw,
        status: MOCK_STATUS_MAP[raw as keyof typeof MOCK_STATUS_MAP] ?? null,
        occurredAt: b.updated_at ? new Date(String(b.updated_at)) : new Date(),
        deliveryFee: b.delivery_charge != null ? String(b.delivery_charge) : null,
        codCharge: b.cod_charge != null ? String(b.cod_charge) : null,
        returnFee: b.return_charge != null ? String(b.return_charge) : null,
        collectedAmount: b.collected_amount != null ? String(b.collected_amount) : null,
        payload: b,
      },
    ];
  },
};

/** Test helper: forget simulated parcels. */
export const resetMockCourier = () => parcels.clear();
