// Order / shipment / payment status presentation (English + Bengali), mirroring the server's labels.
export const ORDER_STATUSES = [
  "PENDING", "CONFIRMATION_REQUIRED", "CONFIRMED", "PROCESSING", "READY_TO_SHIP", "COURIER_BOOKED", "SHIPPED", "DELIVERED",
  "CANCELLED", "RETURN_REQUESTED", "RETURN_IN_TRANSIT", "RETURNED", "EXCHANGE_REQUESTED", "EXCHANGED", "ON_HOLD",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_STATUS: Record<OrderStatus, { en: string; bn: string; tone: Tone }> = {
  PENDING: { en: "Pending", bn: "পেন্ডিং", tone: "sky" },
  CONFIRMATION_REQUIRED: { en: "Needs confirmation", bn: "নিশ্চিতকরণ প্রয়োজন", tone: "amber" },
  CONFIRMED: { en: "Confirmed", bn: "নিশ্চিত", tone: "emerald" },
  PROCESSING: { en: "Processing", bn: "প্রসেসিং", tone: "indigo" },
  READY_TO_SHIP: { en: "Ready to ship", bn: "শিপের জন্য প্রস্তুত", tone: "violet" },
  COURIER_BOOKED: { en: "Courier booked", bn: "কুরিয়ার বুকড", tone: "purple" },
  SHIPPED: { en: "In transit", bn: "পথে আছে", tone: "blue" },
  DELIVERED: { en: "Delivered", bn: "ডেলিভারড", tone: "green" },
  CANCELLED: { en: "Cancelled", bn: "বাতিল", tone: "red" },
  RETURN_REQUESTED: { en: "Return requested", bn: "ফেরতের অনুরোধ", tone: "orange" },
  RETURN_IN_TRANSIT: { en: "Return in transit", bn: "ফেরত পথে", tone: "orange" },
  RETURNED: { en: "Returned / RTO", bn: "ফেরত এসেছে", tone: "rose" },
  EXCHANGE_REQUESTED: { en: "Exchange requested", bn: "এক্সচেঞ্জের অনুরোধ", tone: "cyan" },
  EXCHANGED: { en: "Exchanged", bn: "এক্সচেঞ্জড", tone: "teal" },
  ON_HOLD: { en: "On hold", bn: "হোল্ডে আছে", tone: "gray" },
};

/** Tabs on the order screen (like the brand's existing workflow). */
export const ORDER_TABS: { key: string; label: string; statuses: OrderStatus[] | null }[] = [
  { key: "all", label: "All", statuses: null },
  { key: "pending", label: "Pending", statuses: ["PENDING"] },
  { key: "confirm", label: "Needs confirmation", statuses: ["CONFIRMATION_REQUIRED"] },
  { key: "confirmed", label: "Confirmed", statuses: ["CONFIRMED"] },
  { key: "processing", label: "Processing", statuses: ["PROCESSING", "READY_TO_SHIP"] },
  { key: "booked", label: "Courier booked", statuses: ["COURIER_BOOKED"] },
  { key: "shipped", label: "In transit", statuses: ["SHIPPED"] },
  { key: "delivered", label: "Delivered", statuses: ["DELIVERED"] },
  { key: "hold", label: "On hold", statuses: ["ON_HOLD"] },
  { key: "cancelled", label: "Cancelled", statuses: ["CANCELLED"] },
  { key: "returns", label: "Returns", statuses: ["RETURN_REQUESTED", "RETURN_IN_TRANSIT", "RETURNED", "EXCHANGE_REQUESTED", "EXCHANGED"] },
];

export type Tone = "sky" | "amber" | "emerald" | "indigo" | "violet" | "purple" | "blue" | "green" | "red" | "orange" | "rose" | "cyan" | "teal" | "gray";

export const TONE_CLASS: Record<Tone, string> = {
  sky: "border-sky-300 bg-sky-50 text-sky-700",
  amber: "border-amber-300 bg-amber-50 text-amber-800",
  emerald: "border-emerald-300 bg-emerald-50 text-emerald-700",
  indigo: "border-indigo-300 bg-indigo-50 text-indigo-700",
  violet: "border-violet-300 bg-violet-50 text-violet-700",
  purple: "border-purple-300 bg-purple-50 text-purple-700",
  blue: "border-blue-300 bg-blue-50 text-blue-700",
  green: "border-green-300 bg-green-50 text-green-700",
  red: "border-red-300 bg-red-50 text-red-700",
  orange: "border-orange-300 bg-orange-50 text-orange-700",
  rose: "border-rose-300 bg-rose-50 text-rose-700",
  cyan: "border-cyan-300 bg-cyan-50 text-cyan-700",
  teal: "border-teal-300 bg-teal-50 text-teal-700",
  gray: "border-gray-300 bg-gray-50 text-gray-700",
};

export const SHIPMENT_TONE: Record<string, Tone> = {
  PENDING: "amber", BOOKED: "purple", PICKED_UP: "indigo", IN_TRANSIT: "blue", DELIVERED: "green", PARTIALLY_DELIVERED: "teal",
  RETURNING: "orange", RETURNED: "rose", CANCELLED: "gray", FAILED: "red",
};

export const PAYMENT_TONE: Record<string, Tone> = { UNPAID: "gray", PARTIALLY_PAID: "amber", PAID: "green", PARTIALLY_REFUNDED: "orange", REFUNDED: "rose" };

export const CHANNELS = ["WEBSITE", "FACEBOOK", "INSTAGRAM", "WHATSAPP", "PHONE", "MANUAL", "OTHER"] as const;
export const PAYMENT_METHODS = ["COD", "BKASH", "NAGAD", "ROCKET", "SSLCOMMERZ", "CARD", "BANK_TRANSFER", "CASH"] as const;
