import { prisma, type Tx } from "../../lib/prisma.js";
import { AppError, assertFound, badRequest, conflict, forbidden, unprocessable } from "../../lib/errors.js";
import { money, sum, ZERO, type Decimal } from "../../lib/money.js";
import { audit, diff } from "../../lib/audit.js";
import { getSetting } from "../../lib/settings.js";
import { nextOrderNumber, nextReturnNumber } from "../../lib/numbering.js";
import type { DeliveryOption, OrderStatus, PaymentMethod, SalesChannel, StatusSource } from "../../generated/prisma/enums.js";
import { deliveryChargeFor } from "../shipping/delivery-options.js";
import type { Permission } from "../../rbac/permissions.js";
import { assessRisk, recomputeCustomerStats, requirePhone, upsertCustomer } from "../customers/customers.service.js";
import { calculateDeliveryCharge, resolveLocation } from "../shipping/shipping.service.js";
import { fulfillForOrder, receiveReturned, releaseForOrder, reserveForOrder } from "../inventory/inventory.service.js";
import { recognizeDelivery, recognizeRtoPackaging } from "../finance/ledger.service.js";
import { EDITABLE, isSystemOnly, permissionFor, TRANSITIONS } from "./order-status.js";
import { emitOrderEvent } from "./order-events.js";

export interface Actor {
  userId: string | null;
  permissions: Set<Permission> | "system";
  source: StatusSource;
  ip?: string | null;
}

export const systemActor = (source: StatusSource = "SYSTEM"): Actor => ({ userId: null, permissions: "system", source });
const can = (actor: Actor, p: Permission) => actor.permissions === "system" || actor.permissions.has(p);

export interface ItemInput {
  variantId: string;
  quantity: number;
  unitPrice?: string; // staff override
  discount?: string;
}

export interface AttributionInput {
  firstSource?: string; firstMedium?: string; firstCampaign?: string; firstContent?: string; firstTerm?: string; firstLandingPage?: string; firstTouchAt?: string;
  lastSource?: string; lastMedium?: string; lastCampaign?: string; lastContent?: string; lastTerm?: string; lastLandingPage?: string; lastTouchAt?: string;
  referrer?: string; fbclid?: string; fbc?: string; fbp?: string; campaignId?: string; adsetId?: string; adId?: string;
  clientIpAddress?: string; clientUserAgent?: string; eventSourceUrl?: string;
}

export interface CreateOrderInput {
  customer: { name: string; phone: string; email?: string | null };
  shipping: { name?: string; phone?: string; addressLine: string; districtId?: string | null; areaId?: string | null; districtName?: string | null; areaName?: string | null; note?: string | null };
  items: ItemInput[];
  discount?: string;
  deliveryCharge?: string; // override (permission orders.override_delivery)
  /** Website checkout: flat Inside/Outside Dhaka charge from Settings (takes precedence over zone pricing). */
  deliveryOption?: DeliveryOption | null;
  paymentMethod?: PaymentMethod;
  channel?: SalesChannel;
  isPreorder?: boolean;
  scheduledFor?: string | null;
  assignedToId?: string | null;
  note?: string | null;
  attribution?: AttributionInput;
  idempotencyKey?: string | null;
  requirePublished?: boolean; // storefront
}

// ───────────── pricing ─────────────

async function priceLines(tx: Tx, items: ItemInput[], actor: Actor, requirePublished: boolean) {
  if (!items.length) throw badRequest("An order needs at least one item");
  const ids = [...new Set(items.map((i) => i.variantId))];
  const variants = await tx.productVariant.findMany({
    where: { id: { in: ids } },
    include: { product: { include: { images: { orderBy: { sortOrder: "asc" }, take: 1 } } } },
  });
  const byId = new Map(variants.map((v) => [v.id, v]));

  return items.map((item) => {
    const v = byId.get(item.variantId);
    if (!v) throw badRequest(`Unknown product variant ${item.variantId}`);
    if (!v.isActive || v.product.status === "ARCHIVED") throw unprocessable("ITEM_UNAVAILABLE", `${v.product.name} (${v.sku}) is not available`);
    if (requirePublished && (!v.product.isPublished || v.product.status !== "ACTIVE")) {
      throw unprocessable("ITEM_UNAVAILABLE", `${v.product.name} is not available`);
    }
    if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 999) throw badRequest("Quantity must be between 1 and 999");

    const listPrice = money(v.price ?? v.product.salePrice ?? v.product.regularPrice);
    let unitPrice = listPrice;
    if (item.unitPrice !== undefined && !money(item.unitPrice).equals(listPrice)) {
      if (!can(actor, "orders.edit")) throw forbidden("Changing item prices requires the orders.edit permission");
      unitPrice = money(item.unitPrice);
      if (unitPrice.isNegative()) throw badRequest("Price cannot be negative");
    }
    const discount = money(item.discount);
    const gross = unitPrice.times(item.quantity);
    if (discount.isNegative() || discount.greaterThan(gross)) throw badRequest("Line discount must be between 0 and the line amount");
    const unitCost = money(v.costPrice ?? v.product.costPrice);
    return {
      productId: v.productId,
      variantId: v.id,
      productName: v.product.name,
      variantName: v.name,
      sku: v.sku,
      color: v.color,
      size: v.size,
      imageUrl: v.imageUrl ?? v.product.images[0]?.url ?? null,
      quantity: item.quantity,
      unitPrice,
      discount,
      lineTotal: gross.minus(discount),
      unitCost,
      costTotal: unitCost.times(item.quantity),
      weight: (v.weightGrams ?? v.product.weightGrams) * item.quantity,
      freeShipping: v.product.freeShipping,
    };
  });
}

type PricedLine = Awaited<ReturnType<typeof priceLines>>[number];

async function computeTotals(
  tx: Tx,
  lines: PricedLine[],
  opts: { zoneId: string | null; discount?: string; deliveryOverride?: string; paidAmount: Decimal },
  actor: Actor,
) {
  const subtotal = sum(lines.map((l) => l.lineTotal));
  const discountTotal = money(opts.discount);
  if (discountTotal.isNegative() || discountTotal.greaterThan(subtotal)) throw badRequest("Discount must be between 0 and the subtotal");
  const weightGrams = lines.reduce((s, l) => s + l.weight, 0);
  const merchandise = subtotal.minus(discountTotal);

  let deliveryCharge = await calculateDeliveryCharge(tx, opts.zoneId, weightGrams, merchandise, lines.every((l) => l.freeShipping));
  if (opts.deliveryOverride !== undefined && !money(opts.deliveryOverride).equals(deliveryCharge)) {
    if (!can(actor, "orders.override_delivery")) throw forbidden("Overriding the delivery charge requires orders.override_delivery");
    deliveryCharge = money(opts.deliveryOverride);
    if (deliveryCharge.isNegative()) throw badRequest("Delivery charge cannot be negative");
  }
  const total = merchandise.plus(deliveryCharge);
  if (opts.paidAmount.greaterThan(total)) throw conflict("Paid amount exceeds the new order total; record a refund first");
  return {
    subtotal,
    discountTotal,
    deliveryCharge,
    total,
    codAmount: total.minus(opts.paidAmount),
    productCostTotal: sum(lines.map((l) => l.costTotal)),
    weightGrams,
  };
}

const lineData = (l: PricedLine) => ({
  productId: l.productId, variantId: l.variantId, productName: l.productName, variantName: l.variantName, sku: l.sku,
  color: l.color, size: l.size, imageUrl: l.imageUrl, quantity: l.quantity, unitPrice: l.unitPrice, discount: l.discount,
  lineTotal: l.lineTotal, unitCost: l.unitCost, costTotal: l.costTotal,
});

const lockOrder = (tx: Tx, id: string) => tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${id} FOR UPDATE`;

// ───────────── create ─────────────

export async function createOrder(input: CreateOrderInput, actor: Actor) {
  if (input.idempotencyKey) {
    const existing = await prisma.order.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (existing) return { order: existing, duplicate: true };
  }
  const phone = requirePhone(input.customer.phone);
  const shippingPhone = input.shipping.phone ? requirePhone(input.shipping.phone) : phone;
  const [inventoryCfg, ordersCfg] = await Promise.all([getSetting("inventory"), getSetting("orders")]);

  try {
    const order = await prisma.$transaction(
      async (tx) => {
        // Inside Dhaka orders without a picked district still belong to the Dhaka zone (courier fee estimates, reports)
        const location = await resolveLocation(tx, {
          ...input.shipping,
          districtName: input.shipping.districtName ?? (input.deliveryOption === "INSIDE_DHAKA" && !input.shipping.districtId && !input.shipping.areaId ? "Dhaka" : null),
        });
        const lines = await priceLines(tx, input.items, actor, input.requirePublished ?? false);
        // the delivery option's charge is read from the database here – never taken from the client
        const optionCharge = input.deliveryOption ? (await deliveryChargeFor(input.deliveryOption, tx)).toFixed(2) : undefined;
        const totals = await computeTotals(
          tx,
          lines,
          { zoneId: location.zoneId, discount: input.discount, deliveryOverride: optionCharge ?? input.deliveryCharge, paidAmount: ZERO },
          optionCharge ? { ...actor, permissions: "system" } : actor,
        );

        const customer = await upsertCustomer(tx, {
          name: input.customer.name.trim(),
          phone,
          email: input.customer.email ?? null,
          address: {
            recipientName: (input.shipping.name ?? input.customer.name).trim(),
            addressLine: input.shipping.addressLine.trim(),
            districtId: location.districtId, areaId: location.areaId, districtName: location.districtName, areaName: location.areaName,
          },
        });

        const paymentMethod = input.paymentMethod ?? "COD";
        const risk = await assessRisk(tx, { phone: shippingPhone, customerId: customer.id, addressLine: input.shipping.addressLine, total: totals.total, paymentMethod });
        const status: OrderStatus = risk.score >= ordersCfg.confirmationRiskThreshold ? "CONFIRMATION_REQUIRED" : "PENDING";
        const reserveNow = inventoryCfg.reserveOn === "ORDER_CREATED" && !input.isPreorder;

        if (input.assignedToId) {
          if (!can(actor, "orders.assign")) throw forbidden("Assigning orders requires orders.assign");
          assertFound(await tx.user.findFirst({ where: { id: input.assignedToId, status: "ACTIVE" } }), "Assignee");
        }

        const created = await tx.order.create({
          data: {
            orderNumber: await nextOrderNumber(tx),
            customerId: customer.id,
            status,
            paymentMethod,
            channel: input.channel ?? (actor.source === "STOREFRONT" ? "WEBSITE" : "MANUAL"),
            shippingName: (input.shipping.name ?? input.customer.name).trim(),
            shippingPhone,
            shippingAddress: input.shipping.addressLine.trim(),
            divisionName: location.divisionName,
            districtId: location.districtId,
            districtName: location.districtName,
            areaId: location.areaId,
            areaName: location.areaName,
            zoneId: location.zoneId,
            deliveryNote: input.shipping.note ?? null,
            deliveryOption: input.deliveryOption ?? null,
            ...totals,
            packagingCost: money(ordersCfg.defaultPackagingCost),
            riskScore: risk.score,
            riskFlags: risk.flags.map((f) => f.code),
            isPreorder: input.isPreorder ?? false,
            scheduledFor: input.scheduledFor ? new Date(input.scheduledFor) : null,
            stockReserved: reserveNow,
            assignedToId: input.assignedToId ?? null,
            createdById: actor.userId,
            idempotencyKey: input.idempotencyKey ?? null,
            items: { create: lines.map(lineData) },
            statusHistory: {
              create: {
                toStatus: status,
                source: actor.source,
                userId: actor.userId,
                reason: risk.flags.length ? `Risk: ${risk.flags.map((f) => f.message).join("; ")}` : null,
              },
            },
            ...(input.note ? { notes: { create: { body: input.note, userId: actor.userId } } } : {}),
            ...(input.attribution ? { attribution: { create: attributionData(input.attribution) } } : {}),
          },
          include: { items: true },
        });

        if (reserveNow) {
          if (inventoryCfg.allowBackorder) {
            // back-orders allowed: reserve what exists, leave the rest unreserved → treated as pre-order
            try {
              await reserveForOrder(tx, created.id, created.items, actor.userId);
            } catch (err) {
              if ((err as AppError).code !== "INSUFFICIENT_STOCK") throw err;
              await tx.order.update({ where: { id: created.id }, data: { stockReserved: false, isPreorder: true } });
            }
          } else {
            await reserveForOrder(tx, created.id, created.items, actor.userId);
          }
        }

        // customer website orders get one persistent Meta Purchase event id (shared by Pixel and Conversions API)
        if (actor.source === "STOREFRONT" && created.channel === "WEBSITE") {
          await tx.order.update({ where: { id: created.id }, data: { metaPurchaseEventId: `purchase:${created.id}` } });
        }

        await recomputeCustomerStats(tx, customer.id);
        await audit(tx, {
          userId: actor.userId, action: "order.created", entityType: "Order", entityId: created.id,
          after: { orderNumber: created.orderNumber, total: created.total.toFixed(2), items: lines.length, channel: created.channel, status, risk: risk.flags.map((f) => f.code) },
          ip: actor.ip,
        });
        return created;
      },
      { maxWait: 10_000, timeout: 30_000 },
    );
    emitOrderEvent({ type: "order.created", orderId: order.id });
    return { order, duplicate: false };
  } catch (err) {
    // two concurrent requests with the same idempotency key: return the winner
    if (input.idempotencyKey && (err as { code?: string }).code === "P2002") {
      const existing = await prisma.order.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (existing) return { order: existing, duplicate: true };
    }
    throw err;
  }
}

function attributionData(a: AttributionInput) {
  const date = (v?: string) => (v ? new Date(v) : null);
  const trim = (v?: string) => (v ? v.slice(0, 500) : null);
  return {
    firstSource: trim(a.firstSource), firstMedium: trim(a.firstMedium), firstCampaign: trim(a.firstCampaign), firstContent: trim(a.firstContent),
    firstTerm: trim(a.firstTerm), firstLandingPage: trim(a.firstLandingPage), firstTouchAt: date(a.firstTouchAt),
    lastSource: trim(a.lastSource), lastMedium: trim(a.lastMedium), lastCampaign: trim(a.lastCampaign), lastContent: trim(a.lastContent),
    lastTerm: trim(a.lastTerm), lastLandingPage: trim(a.lastLandingPage), lastTouchAt: date(a.lastTouchAt),
    referrer: trim(a.referrer), fbclid: trim(a.fbclid), fbc: trim(a.fbc), fbp: trim(a.fbp),
    campaignId: trim(a.campaignId), adsetId: trim(a.adsetId), adId: trim(a.adId),
    clientIpAddress: trim(a.clientIpAddress), clientUserAgent: trim(a.clientUserAgent), eventSourceUrl: trim(a.eventSourceUrl),
  };
}

// ───────────── edit ─────────────

export interface UpdateOrderInput {
  customerName?: string;
  shipping?: Partial<CreateOrderInput["shipping"]>;
  items?: ItemInput[];
  discount?: string;
  deliveryCharge?: string;
  paymentMethod?: PaymentMethod;
  channel?: SalesChannel;
  scheduledFor?: string | null;
  packagingCost?: string;
  reason?: string;
}

export async function updateOrder(orderId: string, input: UpdateOrderInput, actor: Actor) {
  const result = await prisma.$transaction(async (tx) => {
    await lockOrder(tx, orderId);
    const order = assertFound(await tx.order.findUnique({ where: { id: orderId }, include: { items: true } }), "Order");
    if (!EDITABLE.includes(order.status)) {
      throw unprocessable("ORDER_LOCKED", `Orders in status ${order.status} can no longer be edited`);
    }

    const shipping = { ...input.shipping };
    const locationChanged = shipping.districtId !== undefined || shipping.areaId !== undefined || shipping.districtName !== undefined || shipping.areaName !== undefined;
    const location = locationChanged
      ? await resolveLocation(tx, { districtId: shipping.districtId ?? null, areaId: shipping.areaId ?? null, districtName: shipping.districtName ?? null, areaName: shipping.areaName ?? null })
      : null;
    const zoneId = location ? location.zoneId : order.zoneId;

    // re-price: new items if given, otherwise keep existing lines (prices are snapshots and stay as sold)
    let lines: PricedLine[] | null = null;
    if (input.items) lines = await priceLines(tx, input.items, actor, false);

    const pricingChanged = lines || input.discount !== undefined || input.deliveryCharge !== undefined || locationChanged;
    let totals: Awaited<ReturnType<typeof computeTotals>> | null = null;
    if (pricingChanged) {
      const currentLines: PricedLine[] = lines ?? order.items.map((i) => ({
        ...i, productId: i.productId, variantId: i.variantId!, unitPrice: money(i.unitPrice), discount: money(i.discount), lineTotal: money(i.lineTotal),
        unitCost: money(i.unitCost), costTotal: money(i.costTotal), weight: 0, freeShipping: false,
      })) as unknown as PricedLine[];
      if (!lines) {
        // weight for the delivery charge comes from the catalog for existing lines
        const variants = await tx.productVariant.findMany({ where: { id: { in: order.items.map((i) => i.variantId!).filter(Boolean) } }, include: { product: true } });
        const w = new Map(variants.map((v) => [v.id, { weight: v.weightGrams ?? v.product.weightGrams, free: v.product.freeShipping }]));
        for (const l of currentLines) {
          const info = w.get(l.variantId);
          l.weight = (info?.weight ?? 250) * l.quantity;
          l.freeShipping = info?.free ?? false;
        }
      }
      totals = await computeTotals(
        tx,
        currentLines,
        {
          zoneId,
          discount: input.discount ?? order.discountTotal.toFixed(2),
          // keep a previously overridden delivery charge unless location/items changed or a new override is given
          deliveryOverride: input.deliveryCharge ?? (lines || locationChanged ? undefined : order.deliveryCharge.toFixed(2)),
          paidAmount: money(order.paidAmount),
        },
        { ...actor, permissions: input.deliveryCharge === undefined ? "system" : actor.permissions },
      );
    }

    if (lines) {
      if (order.stockReserved) await releaseForOrder(tx, order.id, order.items, actor.userId, "Order items edited");
      await tx.orderItem.deleteMany({ where: { orderId: order.id } });
      await tx.orderItem.createMany({ data: lines.map((l) => ({ ...lineData(l), orderId: order.id })) });
      if (order.stockReserved) await reserveForOrder(tx, order.id, lines, actor.userId);
    }

    const data = {
      ...(shipping.name !== undefined ? { shippingName: shipping.name } : {}),
      ...(shipping.phone !== undefined ? { shippingPhone: requirePhone(shipping.phone) } : {}),
      ...(shipping.addressLine !== undefined ? { shippingAddress: shipping.addressLine } : {}),
      ...(shipping.note !== undefined ? { deliveryNote: shipping.note } : {}),
      ...(location
        ? { districtId: location.districtId, districtName: location.districtName, divisionName: location.divisionName, areaId: location.areaId, areaName: location.areaName, zoneId: location.zoneId }
        : {}),
      ...(totals ?? {}),
      ...(input.paymentMethod ? { paymentMethod: input.paymentMethod } : {}),
      ...(input.channel ? { channel: input.channel } : {}),
      ...(input.scheduledFor !== undefined ? { scheduledFor: input.scheduledFor ? new Date(input.scheduledFor) : null } : {}),
      ...(input.packagingCost !== undefined ? { packagingCost: money(input.packagingCost) } : {}),
    };

    const updated = await tx.order.update({ where: { id: order.id }, data, include: { items: true } });
    if (input.customerName) await tx.customer.update({ where: { id: order.customerId }, data: { name: input.customerName } });

    const snapshot = (o: typeof order) => ({
      shippingName: o.shippingName, shippingPhone: o.shippingPhone, shippingAddress: o.shippingAddress, districtName: o.districtName, areaName: o.areaName,
      subtotal: o.subtotal.toFixed(2), discountTotal: o.discountTotal.toFixed(2), deliveryCharge: o.deliveryCharge.toFixed(2), total: o.total.toFixed(2),
      paymentMethod: o.paymentMethod, channel: o.channel, packagingCost: o.packagingCost.toFixed(2),
      items: o.items.map((i) => `${i.sku}×${i.quantity}@${money(i.unitPrice).toFixed(2)}`).sort(),
    });
    const d = diff(snapshot(order), snapshot(updated));
    if (d.changed || input.customerName) {
      await audit(tx, { userId: actor.userId, action: "order.updated", entityType: "Order", entityId: order.id, before: d.before, after: { ...d.after, ...(input.customerName ? { customerName: input.customerName } : {}) }, reason: input.reason, ip: actor.ip });
    }
    return updated;
  });
  emitOrderEvent({ type: "order.updated", orderId });
  return result;
}

// ───────────── status machine ─────────────

export interface StatusChangeOptions {
  reason?: string | null;
  collectedAmount?: string | null; // courier-reported COD collection on delivery
  occurredAt?: Date;
}

export async function changeStatus(orderId: string, to: OrderStatus, actor: Actor, opts: StatusChangeOptions = {}, outerTx?: Tx) {
  const run = async (tx: Tx) => {
    await lockOrder(tx, orderId);
    const order = assertFound(await tx.order.findUnique({ where: { id: orderId }, include: { items: true, shipments: true } }), "Order");
    const from = order.status;
    if (from === to) return { order, changed: false };

    if (!TRANSITIONS[from].includes(to)) {
      throw unprocessable("INVALID_TRANSITION", `Cannot move an order from ${from} to ${to}`, { from, to, allowed: TRANSITIONS[from] });
    }
    if (actor.permissions !== "system") {
      if (isSystemOnly(from, to)) {
        throw unprocessable("WORKFLOW_REQUIRED", `${from} → ${to} happens through the ${to === "COURIER_BOOKED" ? "courier booking" : "returns / exchange"} workflow`);
      }
      if (!can(actor, permissionFor(to))) throw forbidden(`Changing status to ${to} requires ${permissionFor(to)}`);
    }
    if (to === "CANCELLED" && !opts.reason?.trim()) throw badRequest("A cancellation reason is required");

    const activeShipment = order.shipments.find((s) => !s.isReturn && !["CANCELLED", "FAILED"].includes(s.status));
    if ((to === "CANCELLED" || to === "READY_TO_SHIP") && from === "COURIER_BOOKED" && activeShipment) {
      throw unprocessable("SHIPMENT_ACTIVE", "Cancel the courier shipment before changing this order");
    }

    const now = opts.occurredAt ?? new Date();
    const inventoryCfg = await getSetting("inventory", tx);
    const lines = order.items;
    const data: Record<string, unknown> = { status: to };

    // reservation on confirm (when configured)
    if (to === "CONFIRMED") {
      data.confirmedAt = order.confirmedAt ?? now;
      if (!order.stockReserved && !order.stockDeducted && !order.isPreorder && inventoryCfg.reserveOn === "CONFIRMED") {
        await reserveForOrder(tx, order.id, lines, actor.userId);
        data.stockReserved = true;
      }
    }

    // stock leaves the warehouse
    const deductTriggers: OrderStatus[] = inventoryCfg.deductOn === "COURIER_BOOKED"
      ? ["COURIER_BOOKED", "SHIPPED", "DELIVERED", "RETURN_IN_TRANSIT", "RETURNED"]
      : ["SHIPPED", "DELIVERED", "RETURN_IN_TRANSIT", "RETURNED"];
    if (deductTriggers.includes(to) && !order.stockDeducted && from !== "DELIVERED" && from !== "RETURN_REQUESTED") {
      await fulfillForOrder(tx, order.id, lines, order.stockReserved, actor.userId);
      data.stockDeducted = true;
      data.stockReserved = false;
      data.shippedAt = order.shippedAt ?? now;
    }
    if (to === "SHIPPED") data.shippedAt = order.shippedAt ?? now;

    if (to === "CANCELLED") {
      if (order.stockReserved && !order.stockDeducted) {
        await releaseForOrder(tx, order.id, lines, actor.userId, "Order cancelled");
        data.stockReserved = false;
      }
      data.cancelledAt = now;
      data.cancelReason = opts.reason;
      data.codAmount = ZERO;
      if (money(order.paidAmount).greaterThan(0)) {
        // advance must be returned – raise a refund request that still needs approval
        await tx.refund.create({
          data: { orderId: order.id, amount: order.paidAmount, method: order.paymentMethod === "COD" ? "CASH" : order.paymentMethod, status: "PENDING", reason: `Order cancelled: ${opts.reason}`, requestedById: actor.userId },
        });
      }
    }

    if (to === "DELIVERED" && from !== "RETURN_REQUESTED" && from !== "EXCHANGE_REQUESTED") {
      data.deliveredAt = now;
      // COD collected by the courier on our behalf (cash arrives later with the settlement)
      const collected = opts.collectedAmount != null ? money(opts.collectedAmount) : money(order.codAmount);
      if (collected.greaterThan(0)) {
        const txnId = `COD-${order.orderNumber}`;
        const exists = await tx.payment.findUnique({ where: { method_transactionId: { method: "COD", transactionId: txnId } } });
        if (!exists) {
          await tx.payment.create({
            data: { orderId: order.id, method: "COD", kind: "COD_COLLECTION", provider: "courier", amount: collected, status: "COMPLETED", transactionId: txnId, note: "Collected by courier on delivery" },
          });
        }
        const paid = money(order.paidAmount).plus(exists ? 0 : collected);
        data.paidAmount = paid;
        data.paymentStatus = paid.greaterThanOrEqualTo(order.total) ? "PAID" : paid.greaterThan(0) ? "PARTIALLY_PAID" : "UNPAID";
      } else if (money(order.paidAmount).greaterThanOrEqualTo(order.total)) {
        data.paymentStatus = "PAID";
      }
      data.revenueRecognized = true;
      await recognizeDelivery(tx, order, now, actor.userId);
    }

    // undelivered parcel back at the warehouse (RTO): stock awaits inspection through a return record
    // only parcels that never reached the customer are RTO; delivered-then-returned goods go through the returns module
    if (to === "RETURNED" && !order.deliveredAt && (from === "SHIPPED" || from === "COURIER_BOOKED" || from === "RETURN_IN_TRANSIT")) {
      data.returnedAt = now;
      data.codAmount = ZERO;
      await createRtoReturn(tx, order, actor, now);
      await recognizeRtoPackaging(tx, order, now);
    }
    if (to === "RETURNED") data.returnedAt = order.returnedAt ?? now;

    const updated = await tx.order.update({ where: { id: order.id }, data });
    await tx.orderStatusHistory.create({
      data: { orderId: order.id, fromStatus: from, toStatus: to, source: actor.source, userId: actor.userId, reason: opts.reason ?? null, createdAt: now },
    });
    await recomputeCustomerStats(tx, order.customerId);
    await audit(tx, {
      userId: actor.userId, action: "order.status_changed", entityType: "Order", entityId: order.id,
      before: { status: from }, after: { status: to }, reason: opts.reason ?? null, ip: actor.ip,
    });
    return { order: updated, changed: true, from };
  };

  const result = outerTx ? await run(outerTx) : await prisma.$transaction(run, { maxWait: 10_000, timeout: 30_000 });
  if (result.changed && result.from) emitOrderEvent({ type: "order.status_changed", orderId, from: result.from, to });
  return result;
}

async function createRtoReturn(tx: Tx, order: { id: string; items: { id: string; variantId: string | null; quantity: number }[] }, actor: Actor, now: Date) {
  const existing = await tx.returnRequest.findFirst({ where: { orderId: order.id, isRto: true } });
  if (existing) return existing;
  const ret = await tx.returnRequest.create({
    data: {
      returnNumber: await nextReturnNumber(tx),
      orderId: order.id,
      type: "RETURN",
      status: "RECEIVED",
      isRto: true,
      reason: "Returned to origin (undelivered)",
      requestedById: actor.userId,
      receivedAt: now,
      items: { create: order.items.map((i) => ({ orderItemId: i.id, quantity: i.quantity })) },
      history: { create: { toStatus: "RECEIVED", userId: actor.userId, note: "Parcel returned by courier" } },
    },
  });
  await receiveReturned(tx, ret.id, order.id, order.items, actor.userId);
  return ret;
}

// ───────────── misc actions ─────────────

export async function assignOrders(orderIds: string[], assigneeId: string | null, actor: Actor) {
  if (assigneeId) assertFound(await prisma.user.findFirst({ where: { id: assigneeId, status: "ACTIVE" } }), "Assignee");
  return prisma.$transaction(async (tx) => {
    const orders = await tx.order.findMany({ where: { id: { in: orderIds } }, select: { id: true, assignedToId: true } });
    await tx.order.updateMany({ where: { id: { in: orders.map((o) => o.id) } }, data: { assignedToId: assigneeId } });
    for (const o of orders) {
      if (o.assignedToId !== assigneeId) {
        await audit(tx, { userId: actor.userId, action: "order.assigned", entityType: "Order", entityId: o.id, before: { assignedToId: o.assignedToId }, after: { assignedToId: assigneeId }, ip: actor.ip });
      }
    }
    return { updated: orders.length };
  });
}

/** Copy an order's customer/address/items into a new PENDING order (re-priced at current prices). */
export async function duplicateOrder(orderId: string, actor: Actor, reason: string) {
  const source = assertFound(await prisma.order.findUnique({ where: { id: orderId }, include: { items: true, customer: true } }), "Order");
  const items = source.items.filter((i) => i.variantId).map((i) => ({ variantId: i.variantId!, quantity: i.quantity }));
  if (!items.length) throw unprocessable("NOTHING_TO_COPY", "The original items no longer exist in the catalog");
  const { order } = await createOrder(
    {
      customer: { name: source.customer.name, phone: source.customer.phone, email: source.customer.email },
      shipping: { name: source.shippingName, phone: source.shippingPhone, addressLine: source.shippingAddress, districtId: source.districtId, areaId: source.areaId, districtName: source.districtName, areaName: source.areaName, note: source.deliveryNote },
      items,
      paymentMethod: source.paymentMethod,
      channel: source.channel,
      note: `Duplicated from ${source.orderNumber}: ${reason}`,
    },
    actor,
  );
  await prisma.order.update({ where: { id: order.id }, data: { sourceOrderId: source.id } });
  await audit(prisma, { userId: actor.userId, action: "order.duplicated", entityType: "Order", entityId: order.id, after: { sourceOrderId: source.id }, reason, ip: actor.ip });
  return order;
}

/** Apply one status to many orders; each order succeeds or fails independently. */
export async function bulkChangeStatus(orderIds: string[], to: OrderStatus, actor: Actor, reason?: string) {
  const results: { orderId: string; ok: boolean; error?: string }[] = [];
  for (const id of orderIds) {
    try {
      await changeStatus(id, to, actor, { reason });
      results.push({ orderId: id, ok: true });
    } catch (err) {
      results.push({ orderId: id, ok: false, error: err instanceof AppError ? err.message : "Unexpected error" });
    }
  }
  return { succeeded: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results };
}
