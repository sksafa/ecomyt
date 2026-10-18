import type { OrderStatus } from "./status";

export type Money = string;

export interface OrderListItem {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  paymentStatus: string;
  paymentMethod: string;
  channel: string;
  createdAt: string;
  scheduledFor: string | null;
  isPreorder: boolean;
  customer: { id: string; name: string; phone: string; totalOrders: number; deliveredOrders: number; returnedOrders: number; cancelledOrders: number };
  shipping: { name: string; phone: string; address: string; district: string | null; area: string | null; division: string | null; note: string | null; deliveryOption?: "INSIDE_DHAKA" | "OUTSIDE_DHAKA" | null };
  items: {
    id: string; productId: string | null; variantId: string | null; productName: string; variantName: string | null; sku: string;
    color: string | null; size: string | null; imageUrl: string | null; quantity: number; unitPrice: Money; discount: Money; lineTotal: Money;
    unitCost?: Money; costTotal?: Money;
  }[];
  amounts: { subtotal: Money; discount: Money; deliveryCharge: Money; total: Money; paid: Money; due: Money; cod: Money; refunded: Money; productCost?: Money; productMargin?: Money; packagingCost?: Money };
  risk: { score: number; flags: { code: string; en: string; bn: string }[] };
  assignedTo: { id: string; name: string } | null;
  shipment: { id: string; status: string; trackingCode: string | null; consignmentId: string | null; provider: { id: string; code: string; name: string }; lastError: string | null } | null;
  attribution: { lastSource: string | null; lastCampaign: string | null; lastMedium: string | null } | null;
}

export interface ProfitLine {
  amount: Money;
  estimated: boolean;
}

export interface OrderDetail extends OrderListItem {
  zone: { code: string; name: string } | null;
  shipments: {
    id: string; status: string; rawStatus: string | null; trackingCode: string | null; consignmentId: string | null; isReturn: boolean; codAmount: Money;
    deliveryFee: Money | null; codCharge: Money | null; returnFee: Money | null; attempts: number; lastError: string | null; nextRetryAt: string | null;
    createdAt: string; bookedAt: string | null; deliveredAt: string | null; labelUrl: string | null; provider: { id: string; code: string; name: string };
  }[];
  statusHistory: { id: string; fromStatus: OrderStatus | null; toStatus: OrderStatus; source: string; reason: string | null; createdAt: string; user: { id: string; name: string } | null }[];
  notes: { id: string; body: string; createdAt: string; user: { id: string; name: string } | null }[];
  communications: { id: string; channel: string; direction: string; summary: string; outcome: string | null; createdAt: string; user: { id: string; name: string } | null }[];
  payments: { id: string; method: string; kind: string; amount: Money; status: string; transactionId: string | null; senderNumber: string | null; createdAt: string; verifiedAt: string | null; note: string | null }[];
  refunds: { id: string; amount: Money; method: string; status: string; reason: string; createdAt: string; paidAt: string | null }[];
  returns: { id: string; returnNumber: string; type: string; status: string; isRto: boolean; createdAt: string }[];
  createdBy: { id: string; name: string } | null;
  sourceOrder: { id: string; orderNumber: string } | null;
  timestamps: { confirmedAt: string | null; shippedAt: string | null; deliveredAt: string | null; cancelledAt: string | null; returnedAt: string | null };
  cancelReason: string | null;
  stock: { reserved: boolean; deducted: boolean };
  nextStatuses: { to: OrderStatus; systemOnly: boolean; allowed: boolean }[];
  profit?: {
    productRevenue: ProfitLine; shippingRevenue: ProfitLine; productCost: ProfitLine; grossMargin: ProfitLine; packagingCost: ProfitLine;
    courierFee: ProfitLine; codFee: ProfitLine; returnFee: ProfitLine; refunds: ProfitLine; adCost: ProfitLine; netProfit: ProfitLine;
    status: "ESTIMATED" | "RECONCILED"; basis: string;
  };
  financeStatus?: string;
  metaTracking?: {
    eventId: string;
    browserClaimedAt: string | null;
    server: { id: string; status: string; attempts: number; error: string | null; eventsReceived: number | null; fbtraceId: string | null; testEventCode: string | null; sentAt: string | null; updatedAt: string } | null;
  };
  deliveryNote?: string | null;
}

export interface CourierProvider {
  id: string; code: string; name: string; isEnabled: boolean; isDefault: boolean; sandbox: boolean; implemented: boolean;
  capabilities: Record<string, boolean> | null; unverified: string[]; notes: string[];
}
