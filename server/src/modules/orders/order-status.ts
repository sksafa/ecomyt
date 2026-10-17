import type { OrderStatus } from "../../generated/prisma/enums.js";
import type { Permission } from "../../rbac/permissions.js";

/**
 * Allowed transitions. Targets marked system-only can only be reached through the module that owns
 * the workflow (courier booking, returns/exchanges) so financial and inventory records stay consistent.
 */
export const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  PENDING: ["CONFIRMATION_REQUIRED", "CONFIRMED", "ON_HOLD", "CANCELLED"],
  CONFIRMATION_REQUIRED: ["CONFIRMED", "ON_HOLD", "CANCELLED"],
  ON_HOLD: ["PENDING", "CONFIRMATION_REQUIRED", "CONFIRMED", "PROCESSING", "CANCELLED"],
  CONFIRMED: ["PROCESSING", "READY_TO_SHIP", "ON_HOLD", "CANCELLED"],
  PROCESSING: ["READY_TO_SHIP", "ON_HOLD", "CANCELLED"],
  READY_TO_SHIP: ["PROCESSING", "COURIER_BOOKED", "SHIPPED", "ON_HOLD", "CANCELLED"],
  COURIER_BOOKED: ["SHIPPED", "DELIVERED", "READY_TO_SHIP", "RETURN_IN_TRANSIT", "RETURNED", "CANCELLED"],
  SHIPPED: ["DELIVERED", "RETURN_IN_TRANSIT", "RETURNED"],
  DELIVERED: ["RETURN_REQUESTED", "EXCHANGE_REQUESTED"],
  RETURN_REQUESTED: ["RETURN_IN_TRANSIT", "RETURNED", "DELIVERED"],
  EXCHANGE_REQUESTED: ["EXCHANGED", "DELIVERED"],
  RETURN_IN_TRANSIT: ["RETURNED"],
  RETURNED: [],
  EXCHANGED: [],
  CANCELLED: [],
};

/** Reachable only via courier / returns workflows, never via the generic status endpoint. */
export const SYSTEM_ONLY: Partial<Record<OrderStatus, OrderStatus[]>> = {
  READY_TO_SHIP: ["COURIER_BOOKED"],
  DELIVERED: ["RETURN_REQUESTED", "EXCHANGE_REQUESTED"],
  RETURN_REQUESTED: ["RETURN_IN_TRANSIT", "RETURNED", "DELIVERED"],
  EXCHANGE_REQUESTED: ["EXCHANGED", "DELIVERED"],
};

export function isSystemOnly(from: OrderStatus, to: OrderStatus) {
  return SYSTEM_ONLY[from]?.includes(to) ?? false;
}

export function permissionFor(to: OrderStatus): Permission {
  if (to === "CONFIRMED" || to === "CONFIRMATION_REQUIRED") return "orders.confirm";
  if (to === "CANCELLED") return "orders.cancel";
  return "orders.status";
}

/** Statuses in which items, prices and address may still be edited. */
export const EDITABLE: OrderStatus[] = ["PENDING", "CONFIRMATION_REQUIRED", "CONFIRMED", "PROCESSING", "READY_TO_SHIP", "ON_HOLD"];

/** After this point the parcel has left (or is leaving) the warehouse. */
export const SHIPPED_STATES: OrderStatus[] = ["SHIPPED", "DELIVERED", "RETURN_IN_TRANSIT", "RETURNED", "RETURN_REQUESTED", "EXCHANGE_REQUESTED", "EXCHANGED"];

export const STATUS_LABELS: Record<OrderStatus, { en: string; bn: string; color: string }> = {
  PENDING: { en: "Pending", bn: "পেন্ডিং", color: "sky" },
  CONFIRMATION_REQUIRED: { en: "Needs confirmation", bn: "নিশ্চিতকরণ প্রয়োজন", color: "amber" },
  CONFIRMED: { en: "Confirmed", bn: "নিশ্চিত", color: "emerald" },
  PROCESSING: { en: "Processing", bn: "প্রসেসিং", color: "indigo" },
  READY_TO_SHIP: { en: "Ready to ship", bn: "শিপের জন্য প্রস্তুত", color: "violet" },
  COURIER_BOOKED: { en: "Courier booked", bn: "কুরিয়ার বুকড", color: "purple" },
  SHIPPED: { en: "In transit", bn: "পথে আছে", color: "blue" },
  DELIVERED: { en: "Delivered", bn: "ডেলিভারড", color: "green" },
  CANCELLED: { en: "Cancelled", bn: "বাতিল", color: "red" },
  RETURN_REQUESTED: { en: "Return requested", bn: "ফেরতের অনুরোধ", color: "orange" },
  RETURN_IN_TRANSIT: { en: "Return in transit", bn: "ফেরত পথে", color: "orange" },
  RETURNED: { en: "Returned / RTO", bn: "ফেরত এসেছে", color: "rose" },
  EXCHANGE_REQUESTED: { en: "Exchange requested", bn: "এক্সচেঞ্জের অনুরোধ", color: "cyan" },
  EXCHANGED: { en: "Exchanged", bn: "এক্সচেঞ্জড", color: "teal" },
  ON_HOLD: { en: "On hold", bn: "হোল্ডে আছে", color: "gray" },
};
