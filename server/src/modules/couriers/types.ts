import type { ShipmentStatus } from "../../generated/prisma/enums.js";

/** What a provider can actually do. Anything false is shown as "unsupported" in the UI – never faked. */
export interface CourierCapabilities {
  createShipment: boolean;
  trackShipment: boolean;
  cancelShipment: boolean;
  webhooks: boolean;
  labels: boolean;
  returnPickup: boolean;
  settlementApi: boolean;
  sandbox: boolean;
  /** Needs provider-specific city/zone/area ids for the recipient address. */
  requiresLocationIds: boolean;
  /** Can look up a parcel by our merchant reference (used to make booking retries safe). */
  lookupByReference: boolean;
}

/** Capabilities implemented from community SDKs only – shown as "unverified" until checked against the merchant portal docs. */
export type UnverifiedCapability = keyof CourierCapabilities;

export interface CredentialField {
  key: string;
  label: string;
  secret: boolean;
  required: boolean;
}

export interface CreateShipmentRequest {
  merchantReference: string; // our order number (+ attempt suffix)
  recipientName: string;
  recipientPhone: string;
  recipientAddress: string;
  districtName: string | null;
  areaName: string | null;
  codAmount: string; // decimal string, BDT
  weightGrams: number;
  itemDescription: string;
  itemQuantity: number;
  note?: string | null;
  /** provider specific ids resolved by the caller when requiresLocationIds */
  location?: Record<string, string | number>;
}

export interface ShipmentUpdate {
  rawStatus: string;
  status: ShipmentStatus | null; // null = informational / unmapped
  occurredAt: Date;
  deliveryFee?: string | null;
  codCharge?: string | null;
  returnFee?: string | null;
  collectedAmount?: string | null;
  note?: string | null;
}

export interface CreateShipmentResult extends Partial<ShipmentUpdate> {
  consignmentId: string;
  trackingCode: string | null;
  labelUrl?: string | null;
  raw?: unknown;
}

export interface WebhookEvent extends ShipmentUpdate {
  consignmentId?: string | null;
  trackingCode?: string | null;
  merchantReference?: string | null;
  /** provider event id when available (strongest dedupe key) */
  eventId?: string | null;
  payload: unknown;
}

export interface WebhookRequest {
  headers: Record<string, string | string[] | undefined>;
  query?: Record<string, string | undefined>;
  rawBody: Buffer;
  body: unknown;
}

export interface CourierContext {
  providerId: string;
  shipmentId?: string | null;
  sandbox: boolean;
  credentials: Record<string, string>;
  config: Record<string, unknown>;
  webhookSecret: string | null;
}

export interface ShipmentRef {
  consignmentId: string | null;
  trackingCode: string | null;
  merchantReference: string;
}

export interface CourierAdapter {
  code: string;
  name: string;
  docsUrl?: string;
  capabilities: CourierCapabilities;
  credentialFields: CredentialField[];
  createShipment(ctx: CourierContext, req: CreateShipmentRequest): Promise<CreateShipmentResult>;
  track?(ctx: CourierContext, ref: ShipmentRef): Promise<ShipmentUpdate>;
  findByReference?(ctx: CourierContext, merchantReference: string): Promise<CreateShipmentResult | null>;
  cancel?(ctx: CourierContext, ref: ShipmentRef): Promise<void>;
  verifyWebhook?(ctx: CourierContext, req: WebhookRequest): boolean;
  parseWebhook?(ctx: CourierContext, req: WebhookRequest): WebhookEvent[];
  /** Provider status vocabulary → internal status (documented mapping, shown in settings). */
  statusMap: Record<string, ShipmentStatus | null>;
  unverified?: UnverifiedCapability[];
  /**
   * Webhooks from this provider are not cryptographically signed, so a webhook is only a hint:
   * the status (and any fee) is re-read from the courier API before it is applied.
   */
  confirmWebhooksViaApi?: boolean;
  /** Special handshake responses (e.g. Pathao's integration check). Return null for normal events. */
  webhookHandshake?(ctx: CourierContext, req: WebhookRequest): { status: number; headers?: Record<string, string>; body?: unknown } | null;
  label?(ctx: CourierContext, ref: ShipmentRef): Promise<string>;
  /** Free-form notes shown in the courier settings screen. */
  notes?: string[];
}

/** retryable = timeout / network / 5xx / 429 → booking may be retried safely after a lookup. */
export class CourierError extends Error {
  constructor(
    message: string,
    public retryable: boolean,
    public statusCode?: number,
  ) {
    super(message);
  }
}

export class UnsupportedCapabilityError extends Error {
  constructor(provider: string, capability: string) {
    super(`${provider} does not support ${capability} through its API`);
  }
}
