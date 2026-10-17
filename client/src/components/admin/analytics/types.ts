import type { Money } from "@/lib/types";

export type Granularity = "day" | "week" | "month";

export interface DashboardSummary {
  range: { from: string; to: string; today: string; timezone: string };
  filters: { channel: string[] | null; productId: string | null };
  financeVisible: boolean;
  totalOrders: number;
  ordersToday: number;
  pending: number;
  awaitingConfirmation: number;
  confirmed: number;
  everConfirmed: number;
  processing: number;
  courierBooked: number;
  shipped: number;
  delivered: number;
  deliveredInRange: number;
  cancelled: number;
  returned: number;
  onHold: number;
  statusCounts: Record<string, number>;
  grossSales?: Money;
  deliveredSales?: Money;
  collectedPayments?: Money;
  outstandingCod?: Money;
  outstandingCodShipments?: number;
  advertisingSpend?: Money;
  productCost?: Money;
  courierExpenses?: Money;
  returnCosts?: Money;
  refundsPaid?: Money;
  grossProfit?: Money;
  estimatedNetProfit?: Money | null;
  grossMarginPct?: string | null;
  netMarginPct?: string | null;
  definitions: Record<string, string>;
}

interface Bucket { bucket: string; start: string }
export interface ProductRow { productId: string | null; name: string; units: number; revenue?: Money }

export interface DashboardCharts {
  range: { from: string; to: string; timezone: string; granularity: Granularity };
  financeVisible: boolean;
  series: {
    ordersOverTime: (Bucket & { placed: number; delivered: number })[];
    ordersByStatus: { status: string; count: number }[];
    ordersByChannel: { channel: string; orders: number }[];
    deliverySuccess: { delivered: number; returned: number; successRatePct: number | null; byCourier: { providerId: string; courier: string; delivered: number; returned: number; successRatePct: number | null }[] };
    returnRate: { returned: number; delivered: number; ratePct: number | null };
    cancellationRate: { cancelled: number; placed: number; ratePct: number | null };
    bestSelling: ProductRow[];
    slowMoving: { variantId: string; sku: string; product: string; variant: string; available: number; unitsSold: number; lastSoldAt: string | null }[];
    salesOverTime?: (Bucket & { placedValue: Money; deliveredRevenue: Money })[];
    salesVsExpenses?: (Bucket & { revenue: Money; expenses: Money; net: Money })[];
    revenueByProduct?: (ProductRow & { revenue: Money })[];
    revenueByChannel?: { channel: string; orders: number; revenue: Money }[];
    revenueByCourier?: { courier: string; orders: number; revenue: Money }[];
    averageOrderValue?: { placed: Money | null; delivered: Money | null };
    adCostPerDeliveredOrder?: { adSpend: Money; deliveredOrders: number; value: Money | null };
    customerAcquisitionCost?: { adSpend: Money; newCustomers: number; value: Money | null };
    productProfitability?: { productId: string; name: string; units: number; revenue: Money; cost: Money; profit: Money; marginPct: string | null }[];
  };
  definitions: Record<string, string>;
}
