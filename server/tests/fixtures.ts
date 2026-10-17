import { prisma } from "../src/lib/prisma.js";
import { unique, type Client } from "./helpers.js";

/** Creates an ACTIVE, published product with one variant per entry and opening stock. */
export async function makeProduct(
  admin: Client,
  opts: { price?: string; cost?: string; stock?: number[]; weightGrams?: number; name?: string } = {},
) {
  const u = unique().toUpperCase();
  const stock = opts.stock ?? [10];
  const res = await admin.post("/api/v1/products", {
    name: opts.name ?? `Embroidered Orna ${u}`,
    sku: `ORN-${u}`,
    status: "ACTIVE",
    isPublished: true,
    regularPrice: opts.price ?? "2270",
    costPrice: opts.cost ?? "1120",
    weightGrams: opts.weightGrams ?? 300,
    variants: stock.map((s, i) => ({ sku: `ORN-${u}-${i}`, name: `Free size / Colour ${i}`, color: `Colour ${i}`, size: "Free", openingStock: s })),
  });
  if (res.status !== 201) throw new Error(`product create failed: ${JSON.stringify(res.body)}`);
  return res.body.data as { id: string; variants: { id: string; sku: string }[] };
}

export async function dhakaArea(name = "Gulshan") {
  return prisma.area.findFirstOrThrow({ where: { name }, include: { district: true } });
}

// random start: test files share one database, so numbers must not repeat across files
let phoneSeq = 10_000_000 + Math.floor(Math.random() * 80_000_000);
/** Unique valid BD mobile numbers for tests. */
export const testPhone = () => `017${String(phoneSeq++).padStart(8, "0")}`;

export async function makeOrder(client: Client, variantId: string, extra: Record<string, unknown> = {}, quantity = 1) {
  const area = await dhakaArea();
  return client.post("/api/v1/orders", {
    customer: { name: "Md. Safawat Hossain", phone: testPhone() },
    shipping: { addressLine: "Jobbar Molla Tower, Khanbari Koborostan, Kalachadpur", areaId: area.id },
    items: [{ variantId, quantity }],
    ...extra,
  });
}

export const stockOf = (variantId: string) => prisma.inventoryLevel.findUniqueOrThrow({ where: { variantId } });
