import type { Db, Tx } from "../../lib/prisma.js";
import { normalizeBdPhone } from "../../lib/phone.js";
import { badRequest } from "../../lib/errors.js";
import { money, sum } from "../../lib/money.js";
import { getSetting } from "../../lib/settings.js";
import type { OrderStatus } from "../../generated/prisma/enums.js";

export function requirePhone(raw: string): string {
  const phone = normalizeBdPhone(raw);
  if (!phone) throw badRequest(`"${raw}" is not a valid Bangladeshi mobile number (01XXXXXXXXX)`);
  return phone;
}

interface CustomerInput {
  name: string;
  phone: string; // already normalised
  email?: string | null;
  address?: { recipientName: string; addressLine: string; districtId?: string | null; areaId?: string | null; districtName?: string | null; areaName?: string | null };
}

/** Find the customer by phone (the natural key in BD e-commerce) or create one; remember new addresses. */
export async function upsertCustomer(tx: Tx, input: CustomerInput) {
  let customer = await tx.customer.findUnique({ where: { phone: input.phone } });
  if (!customer) {
    customer = await tx.customer.create({ data: { name: input.name, phone: input.phone, email: input.email ?? null } });
  } else if (customer.deletedAt || customer.anonymizedAt) {
    // a previously erased customer ordering again starts a fresh profile under the same phone
    customer = await tx.customer.update({ where: { id: customer.id }, data: { name: input.name, email: input.email ?? null, deletedAt: null, anonymizedAt: null } });
  } else if (!customer.email && input.email) {
    customer = await tx.customer.update({ where: { id: customer.id }, data: { email: input.email } });
  }

  if (input.address) {
    const a = input.address;
    const exists = await tx.customerAddress.findFirst({
      where: { customerId: customer.id, addressLine: a.addressLine, districtName: a.districtName ?? null, areaName: a.areaName ?? null },
    });
    if (!exists) {
      const count = await tx.customerAddress.count({ where: { customerId: customer.id } });
      await tx.customerAddress.create({
        data: {
          customerId: customer.id, recipientName: a.recipientName, phone: input.phone, addressLine: a.addressLine,
          districtId: a.districtId ?? null, areaId: a.areaId ?? null, districtName: a.districtName ?? null, areaName: a.areaName ?? null,
          isDefault: count === 0,
        },
      });
    }
  }
  return customer;
}

const RETURNED: OrderStatus[] = ["RETURNED", "RETURN_IN_TRANSIT"];

/** Denormalised counters on Customer, recomputed from orders after every order change. */
export async function recomputeCustomerStats(db: Db, customerId: string) {
  const orders = await db.order.findMany({
    where: { customerId },
    select: { status: true, total: true, refundedAmount: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  const delivered = orders.filter((o) => o.status === "DELIVERED" || o.status === "EXCHANGED" || o.status === "RETURN_REQUESTED" || o.status === "EXCHANGE_REQUESTED");
  await db.customer.update({
    where: { id: customerId },
    data: {
      totalOrders: orders.length,
      deliveredOrders: delivered.length,
      cancelledOrders: orders.filter((o) => o.status === "CANCELLED").length,
      returnedOrders: orders.filter((o) => RETURNED.includes(o.status)).length,
      lifetimeValue: sum(delivered.map((o) => money(o.total).minus(money(o.refundedAmount)))),
      firstOrderAt: orders[0]?.createdAt ?? null,
      lastOrderAt: orders.at(-1)?.createdAt ?? null,
    },
  });
}

export interface RiskFlag {
  code: string;
  points: number;
  message: string;
  messageBn: string;
}

/**
 * Transparent, explainable risk indicators – a prompt to call the customer, never an automatic
 * fraud verdict. Repeat buyers are not penalised for ordering again; only overlapping open orders,
 * a history of returns/cancellations, or an unusable address raise the score.
 */
export async function assessRisk(
  db: Db,
  input: { phone: string; customerId?: string | null; addressLine: string; total: ReturnType<typeof money>; paymentMethod: string; excludeOrderId?: string },
): Promise<{ score: number; flags: RiskFlag[] }> {
  const cfg = await getSetting("orders", db);
  const flags: RiskFlag[] = [];
  const since = new Date(Date.now() - cfg.duplicateWindowHours * 3_600_000);

  const openRecent = await db.order.count({
    where: {
      shippingPhone: input.phone,
      createdAt: { gte: since },
      status: { notIn: ["CANCELLED", "DELIVERED", "RETURNED", "EXCHANGED"] },
      ...(input.excludeOrderId ? { id: { not: input.excludeOrderId } } : {}),
    },
  });
  if (openRecent > 0) {
    flags.push({
      code: "POSSIBLE_DUPLICATE",
      points: 40,
      message: `${openRecent} other open order(s) from this phone in the last ${cfg.duplicateWindowHours}h`,
      messageBn: `এই নম্বর থেকে গত ${cfg.duplicateWindowHours} ঘণ্টায় আরও ${openRecent}টি অর্ডার আছে`,
    });
  }

  const customer = input.customerId ? await db.customer.findUnique({ where: { id: input.customerId } }) : null;
  if (customer) {
    const finished = customer.deliveredOrders + customer.returnedOrders;
    if (customer.returnedOrders > 0) {
      const ratio = finished ? customer.returnedOrders / finished : 1;
      flags.push({
        code: "PRIOR_RETURNS",
        points: ratio >= 0.5 ? 30 : 15,
        message: `${customer.returnedOrders} of ${finished} completed orders were returned`,
        messageBn: `আগের ${finished}টি অর্ডারের মধ্যে ${customer.returnedOrders}টি ফেরত এসেছে`,
      });
    }
    if (customer.cancelledOrders >= 2) {
      flags.push({
        code: "PRIOR_CANCELLATIONS",
        points: 15,
        message: `${customer.cancelledOrders} previous orders were cancelled`,
        messageBn: `আগের ${customer.cancelledOrders}টি অর্ডার বাতিল হয়েছে`,
      });
    }
  }

  if (input.addressLine.trim().length < 12) {
    flags.push({ code: "INCOMPLETE_ADDRESS", points: 20, message: "Delivery address looks incomplete", messageBn: "ঠিকানা অসম্পূর্ণ মনে হচ্ছে" });
  }
  if (input.paymentMethod === "COD" && input.total.greaterThanOrEqualTo(10_000)) {
    flags.push({ code: "HIGH_VALUE_COD", points: 10, message: "High value cash-on-delivery order", messageBn: "উচ্চ মূল্যের ক্যাশ অন ডেলিভারি অর্ডার" });
  }

  return { score: Math.min(100, flags.reduce((s, f) => s + f.points, 0)), flags };
}

export const RISK_FLAG_TEXT: Record<string, { en: string; bn: string }> = {
  POSSIBLE_DUPLICATE: { en: "Possible duplicate order", bn: "সম্ভাব্য ডুপ্লিকেট অর্ডার" },
  PRIOR_RETURNS: { en: "Customer has returned orders before", bn: "গ্রাহক আগে অর্ডার ফেরত দিয়েছেন" },
  PRIOR_CANCELLATIONS: { en: "Customer has cancelled orders before", bn: "গ্রাহক আগে অর্ডার বাতিল করেছেন" },
  INCOMPLETE_ADDRESS: { en: "Address looks incomplete", bn: "ঠিকানা অসম্পূর্ণ" },
  HIGH_VALUE_COD: { en: "High value COD", bn: "উচ্চ মূল্যের COD" },
};
