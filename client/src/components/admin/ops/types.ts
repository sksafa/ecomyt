import type { Money } from "@/lib/types";

export interface ProviderRef { id: string; name: string; code: string }

export interface ShipmentRow {
  id: string; orderId: string; providerId: string; isReturn: boolean; status: string; rawStatus: string | null;
  consignmentId: string | null; trackingCode: string | null; codAmount: Money; weightGrams: number | null;
  deliveryFee: Money | null; codCharge: Money | null; returnFee: Money | null; collectedAmount: Money | null;
  attempts: number; lastError: string | null; nextRetryAt: string | null; labelUrl: string | null; note: string | null;
  bookedAt: string | null; pickedUpAt: string | null; deliveredAt: string | null; returnedAt: string | null; lastEventAt: string | null;
  createdAt: string; updatedAt: string;
  provider: ProviderRef;
  order: { id: string; orderNumber: string; shippingName?: string; shippingPhone?: string; status: string };
  settlementItem?: { settlementId: string } | null;
}

export interface CourierEventRow {
  id: string; rawStatus: string; mappedStatus: string | null; payload: unknown; occurredAt: string; receivedAt: string;
  processedAt: string | null; applied: boolean; error: string | null;
}

export interface CourierApiLog {
  id: string; operation: string; request: unknown; response: unknown; statusCode: number | null; success: boolean;
  durationMs: number | null; error: string | null; createdAt: string; shipmentId: string | null;
}

export interface ShipmentDetail extends ShipmentRow {
  events: CourierEventRow[];
  apiLogs?: CourierApiLog[];
}

export interface CourierProviderFull {
  id: string; code: string; name: string; isEnabled: boolean; isDefault: boolean; sandbox: boolean; implemented: boolean;
  docsUrl: string | null; capabilities: Record<string, boolean> | null; unverified: string[]; notes: string[];
  webhookConfirmedViaApi: boolean; statusMap: Record<string, string | null> | null;
  credentialFields: { key: string; label: string; secret: boolean; required: boolean; configured: boolean }[];
  webhookConfigured: boolean; webhookUrl: string; config: Record<string, unknown> | null;
}

export interface PerformanceRow {
  provider: ProviderRef; shipments: number; delivered: number; returned: number; inFlight: number; failedBookings: number;
  successRate: number | null; deliveryFees?: Money; codCharges?: Money; returnFees?: Money; avgCostPerDelivered?: Money | null;
}

export interface CodSummaryRow {
  provider: ProviderRef; unsettledShipments: number; codCollected: Money; knownFees: Money; expectedPayout: Money; oldestUnsettledAt: string | null;
}

export interface SettlementRow {
  id: string; providerId: string; reference: string; periodStart: string | null; periodEnd: string | null;
  totalCollected: Money; totalFees: Money; netPayable: Money; receivedAmount: Money; status: string; accountId: string | null;
  receivedAt: string | null; note: string | null; createdAt: string;
  provider: { name: string; code: string }; account: { name: string } | null; _count?: { items: number };
}

export interface SettlementDetail extends SettlementRow {
  items: {
    id: string; shipmentId: string; collected: Money; deliveryFee: Money; codCharge: Money; returnFee: Money; net: Money;
    shipment: { trackingCode: string | null; consignmentId: string | null; order: { id: string; orderNumber: string } };
  }[];
}

export interface AccountRow { id: string; name: string; type: string; isActive: boolean; balance: Money }

export const CAPABILITY_LABELS: Record<string, string> = {
  createShipment: "Book shipments",
  trackShipment: "Track status",
  cancelShipment: "Cancel via API",
  webhooks: "Status webhooks",
  labels: "Shipping labels",
  returnPickup: "Return pickup",
  settlementApi: "Settlement API",
  sandbox: "Sandbox mode",
  requiresLocationIds: "Needs courier area ids",
  lookupByReference: "Lookup by order ref (safe retries)",
};

export const SHIPMENT_STATUSES = ["PENDING", "BOOKED", "PICKED_UP", "IN_TRANSIT", "DELIVERED", "PARTIALLY_DELIVERED", "RETURNING", "RETURNED", "CANCELLED", "FAILED"] as const;
