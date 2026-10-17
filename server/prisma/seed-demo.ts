/**
 * DEMO DATA – development only. Refuses to run unless DEMO_MODE=true and NODE_ENV is not production.
 * Everything is created through the real services (orders, inventory, couriers, returns, payments,
 * expenses) so stock, ledger and customer statistics stay consistent. Demo records are identifiable:
 * products/SKUs start with "DEMO-", customers carry the "demo" tag, staff emails end in @demo.bentbound.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "../src/lib/prisma.js";
import { env, isProd } from "../src/config/env.js";
import { UPLOAD_DIR } from "../src/config/paths.js";
import { money } from "../src/lib/money.js";
import { dateOnly, dhakaDate } from "../src/lib/time.js";
import { applyMovement } from "../src/modules/inventory/inventory.service.js";
import { changeStatus, createOrder, systemActor } from "../src/modules/orders/orders.service.js";
import { applyShipmentUpdate, bookShipment } from "../src/modules/couriers/shipments.service.js";
import { createReturn, decideReturn, inspectReturn, markInTransit, receiveReturn } from "../src/modules/returns/returns.service.js";
import { postEntries } from "../src/modules/finance/ledger.service.js";
import { hashPassword } from "../src/modules/auth/auth.service.js";
import { seedBase } from "../src/seed/base.js";

if (isProd || !env.DEMO_MODE) {
  console.error("Refusing to seed demo data: set DEMO_MODE=true and use a non-production database.");
  process.exit(1);
}
if (await prisma.product.count({ where: { sku: { startsWith: "DEMO-" } } })) {
  console.log("Demo data already present – nothing to do.");
  process.exit(0);
}

await seedBase(prisma, { isProduction: false });

// deterministic pseudo-random generator so every run produces the same demo shop
let seed = 20261017;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const pick = <T>(a: T[]) => a[Math.floor(rnd() * a.length)];

// ── images (generated SVG swatches so no external assets are needed)
const PALETTE: Record<string, [string, string]> = {
  "Off-White": ["#f6f1e7", "#c9b48a"], Maroon: ["#7a1c2b", "#e8c07a"], "Bottle Green": ["#1f4d3a", "#e9d8a6"], "Royal Blue": ["#23408e", "#f1d48a"],
  Mustard: ["#d4a017", "#5b2a1a"], Peach: ["#f4b69a", "#8a3b2b"], Black: ["#1c1c1c", "#d9b45a"], Lavender: ["#b9a6d6", "#4b2c6b"],
};
async function swatch(name: string, color: string) {
  const [bg, fg] = PALETTE[color];
  const dir = path.join(UPLOAD_DIR, "demo");
  await mkdir(dir, { recursive: true });
  const file = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${color.toLowerCase().replace(/\s+/g, "-")}.svg`;
  const motif = Array.from({ length: 6 }, (_, i) => `<circle cx="${60 + i * 56}" cy="${330 + (i % 2) * 24}" r="14" fill="none" stroke="${fg}" stroke-width="3"/>`).join("");
  await writeFile(path.join(dir, file), `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400"><rect width="400" height="400" fill="${bg}"/><path d="M0 300 Q100 260 200 300 T400 300" stroke="${fg}" stroke-width="6" fill="none"/>${motif}<text x="200" y="190" font-family="Georgia" font-size="30" text-anchor="middle" fill="${fg}">${name}</text><text x="200" y="230" font-family="Georgia" font-size="18" text-anchor="middle" fill="${fg}">${color}</text></svg>`);
  return `/uploads/demo/${file}`;
}

// ── catalog
const cat = await prisma.category.upsert({ where: { slug: "embroidered-orna" }, create: { name: "Embroidered Orna", slug: "embroidered-orna" }, update: {} });
const cat2 = await prisma.category.upsert({ where: { slug: "nakshi-kantha" }, create: { name: "Nakshi Kantha Orna", slug: "nakshi-kantha" }, update: {} });
const eid = await prisma.collection.upsert({ where: { slug: "eid-collection" }, create: { name: "Eid Collection", slug: "eid-collection", isFeatured: true }, update: {} });
const best = await prisma.collection.upsert({ where: { slug: "bestsellers" }, create: { name: "Bestsellers", slug: "bestsellers", isFeatured: true }, update: {} });

const PRODUCTS = [
  { name: "Offwhite Hand Embroidery Orna", price: 2270, cost: 1120, colors: ["Off-White", "Peach"], cat: cat.id, fabric: "Half-silk", embroidery: "Hand embroidery" },
  { name: "Maroon Zari Work Orna", price: 2650, cost: 1380, colors: ["Maroon", "Black"], cat: cat.id, fabric: "Georgette", embroidery: "Zari work" },
  { name: "Bottle Green Kantha Stitch Orna", price: 1990, cost: 940, colors: ["Bottle Green", "Mustard"], cat: cat2.id, fabric: "Cotton", embroidery: "Nakshi kantha" },
  { name: "Royal Blue Mirror Work Orna", price: 2450, cost: 1250, colors: ["Royal Blue", "Lavender"], cat: cat.id, fabric: "Chiffon", embroidery: "Mirror work" },
  { name: "Mustard Floral Kantha Orna", price: 1850, cost: 860, colors: ["Mustard", "Peach"], cat: cat2.id, fabric: "Cotton", embroidery: "Floral kantha" },
  { name: "Black Gold Thread Party Orna", price: 3200, cost: 1700, colors: ["Black", "Maroon"], cat: cat.id, fabric: "Silk blend", embroidery: "Gold thread" },
];

const variantIds: string[] = [];
for (const [i, p] of PRODUCTS.entries()) {
  const sku = `DEMO-ORN-${100 + i}`;
  const images = await Promise.all(p.colors.map((c) => swatch(p.name.split(" ").slice(0, 2).join(" "), c)));
  const product = await prisma.product.create({
    data: {
      name: p.name, slug: p.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"), sku, categoryId: p.cat, status: "ACTIVE", isPublished: true, isFeatured: i < 3,
      regularPrice: money(p.price + 300), salePrice: money(p.price), costPrice: money(p.cost), weightGrams: 250,
      shortDescription: `Premium ${p.embroidery.toLowerCase()} orna in ${p.fabric.toLowerCase()}.`,
      description: `Handcrafted in Bangladesh. ${p.embroidery} on soft ${p.fabric.toLowerCase()}, 2.5 hand (approx. 90 × 225 cm). Dry clean recommended.`,
      fabric: p.fabric, embroidery: p.embroidery, design: "Bent & Bound signature",
      images: { create: images.map((url, k) => ({ url, alt: `${p.name} – ${p.colors[k]}`, sortOrder: k })) },
      collections: { create: [{ collectionId: eid.id }, ...(i % 2 === 0 ? [{ collectionId: best.id }] : [])] },
      costComponents: {
        create: [
          { type: "FABRIC", description: `${p.fabric} 2.5 hand`, quantity: 1, unitCost: money(p.cost * 0.45) },
          { type: "EMBROIDERY", description: p.embroidery, quantity: 1, unitCost: money(p.cost * 0.4) },
          { type: "PACKAGING", description: "Gift box + tissue", quantity: 1, unitCost: money(p.cost * 0.15) },
        ],
      },
    },
  });
  for (const [k, color] of p.colors.entries()) {
    const v = await prisma.productVariant.create({
      data: { productId: product.id, sku: `${sku}-${k}`, name: `${color} / 2.5 Hand`, color, size: "2.5 Hand", imageUrl: images[k], lowStockThreshold: 5 },
    });
    await prisma.inventoryLevel.create({ data: { variantId: v.id } });
    const qty = 30 + Math.floor(rnd() * 30);
    await prisma.$transaction((tx) => applyMovement(tx, { variantId: v.id, type: "ADJUST", quantity: qty, deltas: { available: qty }, reason: "Demo opening stock" }));
    variantIds.push(v.id);
  }
}
// one low-stock item for the alerts
{
  const lvl = await prisma.inventoryLevel.findUniqueOrThrow({ where: { variantId: variantIds[3] } });
  const remove = lvl.available - 3;
  await prisma.$transaction((tx) => applyMovement(tx, { variantId: variantIds[3], type: "ADJUST", quantity: remove, deltas: { available: -remove }, reason: "Demo: stock count correction" }));
}

// ── demo staff (password = SEED_ADMIN_PASSWORD)
const pw = await hashPassword(process.env.SEED_ADMIN_PASSWORD || "DemoPassw0rd");
for (const [key, name] of [["order_manager", "Rafi (Order Manager)"], ["confirmation_agent", "Nusrat (Confirmation)"], ["warehouse", "Karim (Warehouse)"], ["accountant", "Farhana (Accounts)"]] as const) {
  const role = await prisma.role.findUniqueOrThrow({ where: { key } });
  await prisma.user.upsert({ where: { email: `${key}@demo.bentbound` }, create: { email: `${key}@demo.bentbound`, name, passwordHash: pw, roles: { create: [{ roleId: role.id }] } }, update: {} });
}
const agentUser = await prisma.user.findUniqueOrThrow({ where: { email: "confirmation_agent@demo.bentbound" } });

// ── orders across the last 30 days
const NAMES = ["Md. Safawat Hossain", "Nusrat Jahan", "Tahmina Akter", "Rumana Islam", "Sadia Rahman", "Farzana Haque", "Mitu Sultana", "Shirin Akhter", "Jannatul Ferdous", "Anika Tabassum", "Sharmin Sultana", "Lamia Chowdhury", "Ritu Barua", "Puja Das", "Maliha Karim"];
const ADDR = ["House 12, Road 5, Block C", "Jobbar Molla Tower, Khanbari Koborostan, Kalachadpur", "Flat 4B, Rupayan Tower", "Shapla Housing, Lane 3", "Holding 77, College Road", "Bashundhara R/A, Road 8, House 21"];
const dhakaAreas = await prisma.area.findMany({ where: { district: { name: "Dhaka" } } });
const outside = await prisma.district.findMany({ where: { name: { in: ["Chattogram", "Sylhet", "Rajshahi", "Khulna", "Cumilla", "Gazipur", "Narayanganj"] } } });
const mock = await prisma.courierProvider.findUniqueOrThrow({ where: { code: "MOCK" } });
await prisma.courierProvider.update({ where: { id: mock.id }, data: { config: {} } });
const sys = systemActor("SYSTEM");
const channels = ["FACEBOOK", "FACEBOOK", "WEBSITE", "WEBSITE", "INSTAGRAM", "WHATSAPP", "PHONE"] as const;
const campaigns = ["eid-orna-2026", "kantha-launch", "retargeting-oct"];

let created = 0;
for (let n = 0; n < 60; n++) {
  const daysAgo = Math.floor(rnd() * 30);
  const when = new Date(Date.now() - daysAgo * 86_400_000 - Math.floor(rnd() * 10) * 3_600_000);
  const inDhaka = rnd() < 0.6;
  const phone = `01${pick(["7", "8", "9", "3", "5", "6"])}${String(10_000_000 + Math.floor(rnd() * 89_999_999)).slice(0, 8)}`;
  const channel = pick([...channels]);
  const items = [{ variantId: pick(variantIds), quantity: rnd() < 0.8 ? 1 : 2 }];
  if (rnd() < 0.25) items.push({ variantId: pick(variantIds), quantity: 1 });
  const uniqueItems = [...new Map(items.map((i) => [i.variantId, i])).values()];
  let order;
  try {
    const area = inDhaka ? pick(dhakaAreas) : null;
    ({ order } = await createOrder(
      {
        customer: { name: pick(NAMES), phone },
        shipping: { addressLine: pick(ADDR), areaId: area?.id ?? null, districtId: inDhaka ? area!.districtId : pick(outside).id },
        items: uniqueItems,
        channel,
        paymentMethod: "COD",
        attribution: channel === "FACEBOOK" || channel === "WEBSITE" ? { lastSource: "facebook", lastMedium: "paid_social", lastCampaign: pick(campaigns), firstSource: "facebook", firstCampaign: pick(campaigns) } : undefined,
      },
      { ...sys, source: channel === "WEBSITE" ? "STOREFRONT" : "USER" },
    ));
  } catch (err) {
    console.warn("skipped order:", (err as Error).message);
    continue;
  }
  created++;
  await prisma.order.update({ where: { id: order.id }, data: { createdAt: when } });
  await prisma.orderStatusHistory.updateMany({ where: { orderId: order.id }, data: { createdAt: when } });
  await prisma.customer.update({ where: { id: order.customerId }, data: { tags: { push: "demo" } } });

  const at = (h: number) => new Date(when.getTime() + h * 3_600_000);
  const roll = rnd();
  if (daysAgo <= 1 && roll < 0.7) continue; // recent orders stay pending
  if (roll < 0.08) {
    await changeStatus(order.id, "CANCELLED", { ...sys, userId: agentUser.id }, { reason: "Customer did not answer after 3 calls", occurredAt: at(5) });
    continue;
  }
  await changeStatus(order.id, "CONFIRMED", { ...sys, userId: agentUser.id }, { reason: "Confirmed on call", occurredAt: at(2) });
  if (daysAgo <= 2) continue;
  const { shipment } = await bookShipment(order.id, { providerId: mock.id }, { ...sys, userId: agentUser.id });
  if (shipment.status !== "BOOKED" || daysAgo <= 3) continue;
  await applyShipmentUpdate(shipment.id, { rawStatus: "picked_up", status: "PICKED_UP", occurredAt: at(20) }, "demo");
  const fate = rnd();
  if (fate < 0.12) {
    await applyShipmentUpdate(shipment.id, { rawStatus: "returning", status: "RETURNING", occurredAt: at(60) }, "demo");
    await applyShipmentUpdate(shipment.id, { rawStatus: "returned", status: "RETURNED", occurredAt: at(96), deliveryFee: inDhaka ? "60" : "110", returnFee: inDhaka ? "30" : "55" }, "demo");
  } else if (daysAgo > 5 || fate > 0.5) {
    await applyShipmentUpdate(shipment.id, { rawStatus: "delivered", status: "DELIVERED", occurredAt: at(inDhaka ? 30 : 60), deliveryFee: inDhaka ? "60" : "110", codCharge: money(order.codAmount).times("0.01").toFixed(2) }, "demo");
  } else {
    await applyShipmentUpdate(shipment.id, { rawStatus: "in_transit", status: "IN_TRANSIT", occurredAt: at(30) }, "demo");
  }
}

// one customer return with restock
const delivered = await prisma.order.findFirst({ where: { status: "DELIVERED", items: { some: {} } }, include: { items: true } });
if (delivered) {
  const actor = { ...sys, userId: agentUser.id };
  const ret = await createReturn({ orderId: delivered.id, type: "RETURN", reason: "Colour looked different from the photo", items: [{ orderItemId: delivered.items[0].id, quantity: 1 }] }, actor);
  await decideReturn(ret.id, true, actor, "Approved – within 3 days");
  await markInTransit(ret.id, actor, { note: "Customer sending via Steadfast" });
  await receiveReturn(ret.id, actor, { returnShippingCost: "60" });
  const items = await prisma.returnItem.findMany({ where: { returnId: ret.id } });
  await inspectReturn(ret.id, items.map((i) => ({ returnItemId: i.id, condition: "GOOD" as const, disposition: "RESTOCK" as const })), actor);
}

// ── expenses & ad spend (last 30 days)
const fb = await prisma.expenseCategory.findUniqueOrThrow({ where: { name: "Facebook Ads" } });
const pack = await prisma.expenseCategory.findUniqueOrThrow({ where: { name: "Packaging" } });
const rent = await prisma.expenseCategory.findUniqueOrThrow({ where: { name: "Rent" } });
const bank = await prisma.account.findFirstOrThrow({ where: { type: "BANK" } });
for (let d = 0; d < 30; d++) {
  const date = dhakaDate(new Date(Date.now() - d * 86_400_000));
  for (const c of campaigns) {
    const spend = money(400 + Math.floor(rnd() * 900));
    await prisma.adSpendRecord.create({ data: { platform: "META", date: dateOnly(date), campaignId: `demo-${c}`, campaignName: c, spend, impressions: 8000 + Math.floor(rnd() * 9000), clicks: 150 + Math.floor(rnd() * 300), reportedPurchases: Math.floor(rnd() * 6), reportedRevenue: money(Math.floor(rnd() * 12000)), source: "DEMO", importBatch: "demo" } });
  }
  if (d % 7 === 0) {
    const e = await prisma.expense.create({ data: { categoryId: fb.id, amount: money(7500), date: dateOnly(date), description: "Meta ads weekly billing (demo)", accountId: bank.id } });
    await postEntries(prisma, [{ type: "AD_SPEND", amount: money(-7500), date: dateOnly(date), isCash: true, accountId: bank.id, expenseId: e.id, description: "Facebook Ads: weekly billing (demo)", key: `expense:${e.id}:v1` }]);
  }
}
for (const [cat, amt, desc] of [[pack, 4200, "Gift boxes & tissue (demo)"], [rent, 18000, "Studio rent (demo)"]] as const) {
  const date = dhakaDate(new Date(Date.now() - 10 * 86_400_000));
  const e = await prisma.expense.create({ data: { categoryId: cat.id, amount: money(amt), date: dateOnly(date), description: desc, accountId: bank.id } });
  await postEntries(prisma, [{ type: "EXPENSE", amount: money(-amt), date: dateOnly(date), isCash: true, accountId: bank.id, expenseId: e.id, description: desc, key: `expense:${e.id}:v1` }]);
}

console.log(`Demo data ready: ${PRODUCTS.length} products, ${variantIds.length} variants, ${created} orders, staff logins *@demo.bentbound (password = SEED_ADMIN_PASSWORD).`);
await prisma.$disconnect();
process.exit(0);
