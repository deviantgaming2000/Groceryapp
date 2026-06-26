import { DealsProvider, DealsSearchParams, NormalizedDeal, ProviderError } from "./types.js";

// Flipp deals via the unofficial backflipp endpoint used by flipp.com / the Flipp app.
// No API key; returns flyer items for a postal code, aggregating many chains' weekly ads
// (including Safeway and Fry's/Kroger). Unofficial — the shape may change without notice,
// so parsing is defensive, results are briefly cached, and failures degrade gracefully.
const BASE = process.env.FLIPP_BASE ?? "https://backflipp.wishabi.com/flipp";
const TTL_MS = 10 * 60 * 1000;

const cache = new Map<string, { at: number; deals: NormalizedDeal[] }>();

interface FlippItem {
  flyer_item_id?: number;
  name?: string;
  current_price?: string | number;
  original_price?: string | number;
  pre_price_text?: string;
  sale_story?: string;
  valid_from?: string;
  valid_to?: string;
  merchant?: string;
  merchant_name?: string;
  brand?: string;
  category?: string;
  clipping_image_url?: string;
  large_image_url?: string;
  flyer_id?: number;
}

function num(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parsePostPriceText(text?: string | null): { digitalCoupon: boolean; loyaltyRequired: boolean } {
  if (!text) return { digitalCoupon: false, loyaltyRequired: false };
  const t = text.toLowerCase();
  return {
    digitalCoupon: t.includes("digital coupon") || t.includes("digital deal") || t.includes("e-coupon"),
    loyaltyRequired: t.includes("with card") || t.includes("member") || t.includes("loyalty") || t.includes("rewards")
  };
}

function normalize(item: FlippItem, zip?: string): NormalizedDeal {
  const sale = num(item.current_price);
  const regular = num(item.original_price);
  const { digitalCoupon, loyaltyRequired } = parsePostPriceText((item as any).post_price_text);
  // sale_story carries the actual offer for promo deals that have no numeric price
  // (e.g. "BUY 3, GET 3 FREE", "Buy 2 get 2 FREE with myWalgreens").
  const dealText = item.sale_story?.trim() || undefined;
  const description = [item.sale_story, item.pre_price_text, (item as any).post_price_text]
    .filter(Boolean).join(" · ") || undefined;
  return {
    source: "flipp",
    storeName: item.merchant_name || item.merchant,
    location: zip,
    productName: item.name || "Flyer deal",
    brand: item.brand,
    salePrice: sale,
    regularPrice: regular,
    discountAmount: regular != null && sale != null && regular > sale ? Number((regular - sale).toFixed(2)) : null,
    dealText,
    couponRequired: digitalCoupon,
    digitalCoupon,
    loyaltyRequired,
    description,
    imageUrl: item.clipping_image_url || item.large_image_url,
    // Deep-link to the specific item. Flipp's current router uses /items/{flyer_item_id};
    // the old /flyers/{flyer_id} path 404s. Fall back to the flyer, then the homepage.
    sourceUrl: item.flyer_item_id
      ? `https://flipp.com/items/${item.flyer_item_id}`
      : item.flyer_id
        ? `https://flipp.com/flyers/${item.flyer_id}`
        : "https://flipp.com",
    validFrom: item.valid_from ?? null,
    validTo: item.valid_to ?? null,
    category: item.category,
    confidence: item.name && (sale || item.sale_story) ? 0.6 : 0.4,
    raw: item
  };
}

/** Shared GET against the backflipp API with timeout + clean error mapping. */
async function flippGet(url: string): Promise<any> {
  let res: Response;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 9000);
    res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0", "Accept-Language": "en-US,en;q=0.9" }
    });
    clearTimeout(timeout);
  } catch {
    throw new ProviderError("Couldn't reach the Flipp flyer service. Try again shortly.", "network", 502);
  }
  if (res.status === 429) throw new ProviderError("Flipp rate limit reached. Try again in a bit.", "rate_limited", 429);
  if (!res.ok) throw new ProviderError(`Flipp returned an error (${res.status}).`, "upstream", 502);
  try {
    return await res.json();
  } catch {
    throw new ProviderError("Flipp returned unexpected data; it couldn't be parsed.", "upstream", 502);
  }
}

async function fetchItems(query: string, zip: string, limit: number): Promise<NormalizedDeal[]> {
  const key = `${zip}|${query}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.deals.slice(0, limit);

  const url = `${BASE}/items/search?locale=en-us&postal_code=${encodeURIComponent(zip)}&q=${encodeURIComponent(query)}`;
  const json = await flippGet(url);
  const items: FlippItem[] = json?.items ?? json?.ecom_items ?? [];
  const deals = items.filter((i) => i.name).map((i) => normalize(i, zip));
  cache.set(key, { at: Date.now(), deals });
  return deals.slice(0, limit);
}

// ---- Full weekly-ad flyers (richer than items/search) ----
// The flyers endpoints return every item in a merchant's printed flyer, most with a
// structured price plus a cropped image — far more than the keyword search returns.

export interface FlippFlyer {
  id: number;
  merchant: string;
  validFrom: string | null;
  validTo: string | null;
  logoUrl: string | null;
}

const flyersCache = new Map<string, { at: number; flyers: FlippFlyer[] }>();
const flyerItemsCache = new Map<string, { at: number; deals: NormalizedDeal[] }>();

/** List the weekly-ad flyers available for a postal code. */
export async function fetchFlyers(zip: string): Promise<FlippFlyer[]> {
  const hit = flyersCache.get(zip);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.flyers;
  const json = await flippGet(`${BASE}/flyers?locale=en-us&postal_code=${encodeURIComponent(zip)}`);
  const arr: any[] = Array.isArray(json) ? json : json?.flyers ?? [];
  const flyers = arr
    .filter((f) => f?.id)
    .map((f) => ({
      id: f.id,
      merchant: f.merchant ?? f.merchant_name ?? "Store",
      validFrom: f.valid_from ?? null,
      validTo: f.valid_to ?? null,
      logoUrl: f.storefront_logo_url ?? f.merchant_logo_url ?? f.logo_url ?? null
    }))
    .sort((a, b) => a.merchant.localeCompare(b.merchant));
  flyersCache.set(zip, { at: Date.now(), flyers });
  return flyers;
}

// Flipp flyers include non-product layout tiles — logo blocks, "Shop Now" buttons,
// and items whose "name" is an internal placeholder code (e.g. "3900EN-og0tT7qa1TwUG").
// These aren't deals, so drop them.
function isJunkFlyerItem(item: any): boolean {
  const name = String(item?.name ?? "").trim();
  if (!name) return true;
  // No letters at all (pure codes/numbers) isn't a product.
  if (!/[A-Za-z]/.test(name)) return true;
  // Pure calls-to-action / layout labels.
  if (/^(shop now|see (the )?(ad|store|details)|view (ad|all|more)|learn more|details?|online only)$/i.test(name)) return true;
  // Common non-product section labels (exact match only, so real products are safe).
  if (/^(pharmacy|snap|ebt|wic|weekly ad|coupons?|deals?|grocery|sale|clearance|new|featured)$/i.test(name)) return true;
  // App-promo blurbs.
  if (/\b(download the app|on the app|deals section|app[- ]exclusive)\b/i.test(name)) return true;
  // Social-media share tiles.
  if (/^(pinterest|facebook|instagram|twitter|x|tiktok|youtube|snapchat|whatsapp|reddit|linkedin|threads|follow us)$/i.test(name)) return true;
  if (/\b(follow us on|find us on|share (this|on)|social media)\b/i.test(name)) return true;
  // Layout / placeholder codes (no spaces): EN-style ids, banner/logo names,
  // or underscore-joined uppercase+digit codes like "ACDSP_COVER-BANNER_810_ENG-1".
  const noSpace = !/\s/.test(name);
  if (noSpace) {
    if (/^\d+[A-Za-z]{2}-[A-Za-z0-9]{5,}$/.test(name)) return true;
    if (/cover|banner|header|footer|logo|placeholder|spacer|filler/i.test(name)) return true;
    if (/_/.test(name) && /[A-Z]/.test(name) && /\d/.test(name)) return true;
  }
  return false;
}

function normalizeFlyerItem(item: any, zip: string, merchant?: string): NormalizedDeal {
  const sale = num(item.price);
  const dealText = (typeof item.sale_story === "string" && item.sale_story.trim())
    || (typeof item.discount === "string" && item.discount.trim())
    || undefined;
  return {
    source: "flipp",
    storeName: merchant,
    location: zip,
    productName: item.name || item.short_name || "Flyer item",
    brand: item.brand || undefined,
    salePrice: sale,
    regularPrice: null,
    discountAmount: null,
    dealText,
    couponRequired: false,
    digitalCoupon: false,
    loyaltyRequired: false,
    description: dealText,
    imageUrl: item.cutout_image_url || item.clipping_image_url || item.large_image_url || undefined,
    sourceUrl: item.id
      ? `https://flipp.com/items/${item.id}`
      : item.flyer_id ? `https://flipp.com/flyers/${item.flyer_id}` : "https://flipp.com",
    validFrom: item.valid_from ?? null,
    validTo: item.valid_to ?? null,
    category: undefined,
    confidence: sale ? 0.7 : 0.4,
    raw: item
  };
}

/** Fetch every item in a single flyer (the full ad), as normalized deals. */
export async function fetchFlyerItems(flyerId: number | string, zip: string, merchant?: string): Promise<NormalizedDeal[]> {
  const key = `${flyerId}|${zip}`;
  const hit = flyerItemsCache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.deals;
  const json = await flippGet(`${BASE}/flyers/${encodeURIComponent(String(flyerId))}?locale=en-us&postal_code=${encodeURIComponent(zip)}`);
  const items: any[] = json?.items ?? [];
  // Keep real products (price or image), dropping section labels and layout/CTA tiles.
  const mapped = items
    .filter((i) => i?.name && !isJunkFlyerItem(i) && (i.price || i.cutout_image_url || i.clipping_image_url))
    .map((i) => normalizeFlyerItem(i, zip, merchant))
    // Priced items first, so dedup keeps a priced copy when one exists.
    .sort((a, b) => Number(b.salePrice != null) - Number(a.salePrice != null));

  // Flyers often repeat the same product across placements (e.g. pool salt listed 5×).
  // Collapse to one entry per product (by normalized name + brand).
  const normName = (s: string) => s.toLowerCase().replace(/[®™*]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  const seen = new Set<string>();
  const deals = mapped.filter((d) => {
    const dedupeKey = `${normName(d.productName)}|${(d.brand ?? "").toLowerCase()}`;
    if (seen.has(dedupeKey)) return false;
    seen.add(dedupeKey);
    return true;
  });
  flyerItemsCache.set(key, { at: Date.now(), deals });
  return deals;
}

// Flipp's search can't be filtered to one merchant (it ignores merchant_id), so the
// page filters by store client-side. To give every store enough deals to slice, the
// no-query view fans out across many categories and fetches a healthy count of each,
// then dedupes. The broader the net, the better each individual store is represented.
const BROAD_CATEGORIES = [
  "meat", "produce", "dairy", "snack", "beverage", "frozen", "bread",
  "deli", "chicken", "cheese", "cereal", "coffee", "soda", "ice cream"
];

async function fetchBroad(zip: string, limit: number): Promise<NormalizedDeal[]> {
  // Fetch a solid slice per category so a single store isn't reduced to 1-2 items.
  const perCategory = Math.max(20, Math.ceil(limit / 3));
  const sets = await Promise.all(BROAD_CATEGORIES.map((t) => fetchItems(t, zip, perCategory)));
  const seen = new Set<string>();
  const merged: NormalizedDeal[] = [];
  for (const deals of sets) {
    for (const d of deals) {
      const key = d.productName + "|" + d.storeName;
      if (!seen.has(key)) { seen.add(key); merged.push(d); }
    }
  }
  return merged.slice(0, limit);
}

export const flippDealsProvider: DealsProvider = {
  id: "flipp",
  label: "Flipp (weekly-ad flyers)",
  needsConfig: false,

  async isConfigured() {
    return true; // no key required
  },

  async searchDeals(params: DealsSearchParams) {
    if (!params.zip) throw new ProviderError("Enter a ZIP code to find local flyer deals.", "bad_request", 400);
    const term = params.query?.trim();
    // No query → broad mix across categories so the page (and its store filter) is full.
    if (!term) return fetchBroad(params.zip, params.limit ?? 120);
    return fetchItems(term, params.zip, params.limit ?? 40);
  },

  async getWeeklyAd(params: DealsSearchParams) {
    if (!params.zip) throw new ProviderError("Enter a ZIP code to load weekly-ad deals.", "bad_request", 400);
    const term = params.query?.trim();
    if (!term) return fetchBroad(params.zip, params.limit ?? 120);
    return fetchItems(term, params.zip, params.limit ?? 60);
  }
};
