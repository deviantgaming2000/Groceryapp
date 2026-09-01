import { getDefaultUserId, prisma } from "../lib/prisma.js";
import type { NormalizedDeal } from "./deals/types.js";
import { matchDealsToGroceryList } from "./deals/match.js";
import { flippDealsProvider } from "./deals/flipp.js";
import { fetchSafewayCoupons, type SafewayCoupon } from "./providers/safeway.js";

// Automatic coupons. Provenance is the whole design: every row written here
// carries source + externalId, upserts by them, and never touches "manual"
// rows the user typed in. Expiry cleanup only ever deactivates its own source.

export interface IngestSummary {
  source: string;
  created: number;
  updated: number;
  deactivated: number;
  skipped: number;
}

export function dealExternalId(deal: NormalizedDeal): string {
  const rawId = (deal.raw as { id?: string | number } | undefined)?.id;
  if (rawId != null && String(rawId).trim()) return String(rawId);
  return [deal.storeName ?? "", deal.productName, deal.validTo ?? ""]
    .join("|")
    .toLowerCase()
    .replace(/[^a-z0-9|]+/g, "-")
    .slice(0, 120);
}

export function dealCouponFields(deal: NormalizedDeal) {
  const expiresAt = deal.validTo ? new Date(deal.validTo) : null;
  const name = deal.productName;
  const description =
    [deal.dealText, deal.description].filter(Boolean).join(" · ") ||
    (deal.salePrice != null ? `Sale ${deal.salePrice.toFixed(2)}${deal.regularPrice != null ? ` (reg ${deal.regularPrice.toFixed(2)})` : ""}` : null);

  if (deal.digitalCoupon) {
    return { couponType: "digital_coupon" as const, amountOff: deal.discountAmount ?? null, percentOff: null, name, description, expiresAt };
  }
  if (deal.dealText && /\bb(uy)?\s*\d*\s*g(et)?\s*\d*\s*(free|\bfor\b)|\bbogo\b/i.test(deal.dealText)) {
    return { couponType: "bogo" as const, amountOff: null, percentOff: null, name, description, expiresAt };
  }
  const pct = deal.dealText?.match(/(\d{1,2})\s*%/);
  if (pct) {
    return { couponType: "percent_off" as const, amountOff: null, percentOff: Number(pct[1]), name, description, expiresAt };
  }
  const amount =
    deal.discountAmount ??
    (deal.salePrice != null && deal.regularPrice != null && deal.regularPrice > deal.salePrice
      ? Number((deal.regularPrice - deal.salePrice).toFixed(2))
      : null);
  if (amount != null && amount > 0) {
    return { couponType: "dollar_off" as const, amountOff: amount, percentOff: null, name, description, expiresAt };
  }
  return null;
}

export async function ingestDealsAsCoupons(opts: {
  source: string;
  deals: NormalizedDeal[];
  storeIdFor: (deal: NormalizedDeal) => string | null;
  itemIdFor: (deal: NormalizedDeal) => string | null;
}): Promise<IngestSummary> {
  const userId = await getDefaultUserId();
  const summary: IngestSummary = { source: opts.source, created: 0, updated: 0, deactivated: 0, skipped: 0 };

  for (const deal of opts.deals) {
    const fields = dealCouponFields(deal);
    const storeId = opts.storeIdFor(deal);
    if (!fields || !storeId) {
      summary.skipped += 1;
      continue;
    }
    const externalId = dealExternalId(deal);
    const groceryItemId = opts.itemIdFor(deal);
    const data = {
      userId,
      storeId,
      groceryItemId,
      name: fields.name,
      couponType: fields.couponType,
      scope: (groceryItemId ? "item" : "store") as "item" | "store",
      amountOff: fields.amountOff,
      percentOff: fields.percentOff,
      description: fields.description,
      expiresAt: fields.expiresAt,
      isActive: fields.expiresAt == null || fields.expiresAt.getTime() > Date.now(),
      source: opts.source,
      externalId
    };
    const existing = await prisma.coupon.findFirst({ where: { userId, source: opts.source, externalId } });
    if (existing) {
      await prisma.coupon.update({ where: { id: existing.id }, data });
      summary.updated += 1;
    } else {
      await prisma.coupon.create({ data });
      summary.created += 1;
    }
  }

  // Expire this source's own leftovers; manual rows are structurally excluded.
  const expired = await prisma.coupon.updateMany({
    where: { userId, source: opts.source, isActive: true, expiresAt: { lt: new Date() } },
    data: { isActive: false }
  });
  summary.deactivated = expired.count;
  return summary;
}

const INGEST_MAX_CALLS = 40;
const INGEST_DELAY_MS = 300;
const norm = (x?: string | null) => (x ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

export async function runFlippCouponIngest(
  deps: { searchDeals?: (query: string, zip: string) => Promise<NormalizedDeal[]>; sleep?: (ms: number) => Promise<void> } = {}
): Promise<IngestSummary> {
  const userId = await getDefaultUserId();
  const search =
    deps.searchDeals ?? ((query: string, zip: string) => flippDealsProvider.searchDeals({ query, zip, limit: 40 }));
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  const stores = await prisma.store.findMany({ where: { userId, zip: { not: "" } } });
  const items = await prisma.groceryItem.findMany({ where: { userId }, select: { id: true, name: true } });
  const zips = [...new Set(stores.map((s) => s.zip))];

  const collected: NormalizedDeal[] = [];
  let calls = 0;
  for (const zip of zips) {
    for (const item of items) {
      if (calls >= INGEST_MAX_CALLS) break;
      calls += 1;
      const deals = await search(item.name, zip).catch(() => [] as NormalizedDeal[]);
      collected.push(...deals);
      await sleep(INGEST_DELAY_MS);
    }
  }

  // Only deals from stores the user actually tracks, matched back to items with
  // the shared token matcher so a "cheerios" search result about granola bars
  // does not become a Cheerios coupon.
  const matched = matchDealsToGroceryList({ deals: collected, groceryItems: items });
  return ingestDealsAsCoupons({
    source: "flipp",
    deals: matched,
    storeIdFor: (deal) => {
      const key = norm(deal.storeName);
      if (!key) return null;
      const store = stores.find((s) => {
        const n = norm(s.name);
        return n !== "" && (n.includes(key) || key.includes(n));
      });
      return store?.id ?? null;
    },
    itemIdFor: (deal) => (deal as { matchedItemIds?: string[] }).matchedItemIds?.[0] ?? null
  });
}

function j4uToDeal(coupon: SafewayCoupon): NormalizedDeal {
  const amount = coupon.savingsText?.match(/\$([0-9]+(?:\.[0-9]{1,2})?)/);
  return {
    source: "safeway-j4u",
    storeName: "Safeway",
    productName: coupon.title,
    brand: coupon.brand ?? undefined,
    salePrice: null,
    regularPrice: null,
    discountAmount: amount ? Number(amount[1]) : null,
    dealText: coupon.savingsText ?? undefined,
    couponRequired: true,
    digitalCoupon: true,
    loyaltyRequired: true,
    description: coupon.description ?? undefined,
    validTo: coupon.expiresAt,
    category: coupon.category ?? undefined,
    confidence: 0.9,
    raw: { id: coupon.id }
  };
}

export async function runSafewayCouponIngest(
  deps: { fetchCoupons?: () => Promise<SafewayCoupon[]> } = {}
): Promise<IngestSummary> {
  const userId = await getDefaultUserId();
  const fetchCoupons = deps.fetchCoupons ?? fetchSafewayCoupons;

  let coupons: SafewayCoupon[];
  try {
    coupons = await fetchCoupons();
  } catch {
    // Isolation is the point: a signed-out session or a changed page must
    // never take the nightly run or other coupon sources down with it.
    return { source: "safeway-j4u", created: 0, updated: 0, deactivated: 0, skipped: 0 };
  }

  const safewayStore = await prisma.store.findFirst({
    where: { userId, name: { contains: "safeway", mode: "insensitive" } }
  });
  const items = await prisma.groceryItem.findMany({ where: { userId }, select: { id: true, name: true } });
  const deals = coupons.map(j4uToDeal);
  const matched = matchDealsToGroceryList({ deals, groceryItems: items });

  return ingestDealsAsCoupons({
    source: "safeway-j4u",
    deals: matched,
    storeIdFor: () => safewayStore?.id ?? null,
    itemIdFor: (deal) => (deal as { matchedItemIds?: string[] }).matchedItemIds?.[0] ?? null
  });
}
