import { getDefaultUserId, prisma } from "../../lib/prisma.js";
import { NormalizedProduct } from "./index.js";

export const UNIT_TYPES = ["each", "lb", "oz", "gallon", "quart", "pint", "fl_oz", "pack", "case", "count"] as const;
export type UnitType = (typeof UNIT_TYPES)[number];

/** Best-effort parse of a provider size string ("1 gal", "12 oz") into quantity + unit. */
export function parseSize(size?: string): { quantity: number; unit: UnitType } {
  if (!size) return { quantity: 1, unit: "each" };
  const s = size.toLowerCase();
  const num = parseFloat(s.replace(/[^0-9.]/g, " ").trim().split(/\s+/)[0]);
  const quantity = Number.isFinite(num) && num > 0 ? num : 1;
  let unit: UnitType = "each";
  if (/fl\.?\s*oz|fluid/.test(s)) unit = "fl_oz";
  else if (/\bgal|gallon/.test(s)) unit = "gallon";
  else if (/\bqt|quart/.test(s)) unit = "quart";
  else if (/\bpt|pint/.test(s)) unit = "pint";
  else if (/\boz|ounce/.test(s)) unit = "oz";
  else if (/\blb|pound/.test(s)) unit = "lb";
  else if (/\bpk|pack/.test(s)) unit = "pack";
  else if (/\bct|count|ea\b|each/.test(s)) unit = "count";
  return { quantity, unit };
}

/** Derive the package size for a price entry. For weight items where the store gives
 *  a per-unit price, the true package weight is price ÷ unit price — accurate even when
 *  the size string is a range (e.g. "12.3 - 28 lb") so the $/lb matches the store. */
export function derivePackage(product: NormalizedProduct): { quantity: number; unit: UnitType } {
  const sized = parseSize(product.size);
  const isWeight = sized.unit === "lb" || sized.unit === "oz";
  if (isWeight && product.unitPrice && product.unitPrice > 0 && product.price && product.price > 0) {
    const qty = product.price / product.unitPrice;
    if (Number.isFinite(qty) && qty > 0) return { quantity: Number(qty.toFixed(2)), unit: sized.unit };
  }
  return sized;
}

export async function upsertItem(userId: string, product: NormalizedProduct) {
  const existing = await prisma.groceryItem.findFirst({
    where: { userId, source: product.source, externalProductId: product.externalProductId }
  });
  const data = {
    name: product.title,
    category: product.category || "Imported",
    preferredBrand: product.brand ?? null,
    upc: product.externalProductId,
    source: product.source,
    externalProductId: product.externalProductId,
    imageUrl: product.imageUrl ?? null,
    productUrl: product.productUrl ?? null
  };
  if (existing) {
    return prisma.groceryItem.update({ where: { id: existing.id }, data });
  }
  return prisma.groceryItem.create({
    data: { userId, quantityNeeded: 1, unitType: "each", ...data }
  });
}

export async function upsertPrice(
  userId: string,
  groceryItemId: string,
  storeId: string,
  product: NormalizedProduct,
  priceEntryId?: string
) {
  const data = {
    price: product.price ?? 0,
    brand: product.brand ?? null,
    source: product.source,
    externalProductId: product.externalProductId,
    regularPrice: product.regularPrice ?? null,
    promoPrice: product.promoPrice ?? null,
    imageUrl: product.imageUrl ?? null,
    productUrl: product.productUrl ?? null,
    available: product.available,
    couponEligible: product.couponEligible,
    couponData: (product.couponData ?? undefined) as any,
    rawApiData: (product.raw ?? undefined) as any,
    salePrice: product.promoPrice != null,
    lastSyncedAt: new Date(),
    recordedAt: new Date(),
    confidence: "confirmed" as const
  };

  const existing =
    (priceEntryId && (await prisma.priceEntry.findUnique({ where: { id: priceEntryId } }))) ||
    (await prisma.priceEntry.findFirst({
      where: { userId, groceryItemId, storeId, source: product.source, externalProductId: product.externalProductId }
    }));

  if (existing) {
    return prisma.priceEntry.update({ where: { id: existing.id }, data });
  }
  // On first import, derive package size from the product and keep the full
  // product description in notes so it stays visible on the price entry.
  const sized = derivePackage(product);
  return prisma.priceEntry.create({
    data: {
      userId,
      groceryItemId,
      storeId,
      packageQuantity: sized.quantity,
      packageUnit: sized.unit,
      notes: [product.title, product.size].filter(Boolean).join(" · ") || null,
      ...data
    }
  });
}
