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

async function fetchItems(query: string, zip: string, limit: number): Promise<NormalizedDeal[]> {
  const key = `${zip}|${query}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.deals.slice(0, limit);

  const url = `${BASE}/items/search?locale=en-us&postal_code=${encodeURIComponent(zip)}&q=${encodeURIComponent(query)}`;
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

  let json: any;
  try {
    json = await res.json();
  } catch {
    throw new ProviderError("Flipp returned unexpected data; deals couldn't be parsed.", "upstream", 502);
  }
  const items: FlippItem[] = json?.items ?? json?.ecom_items ?? [];
  const deals = items.filter((i) => i.name).map((i) => normalize(i, zip));
  cache.set(key, { at: Date.now(), deals });
  return deals.slice(0, limit);
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
    // When no specific query is given, pull a broad mix of common categories so the
    // page isn't empty. "grocery" matches the store-category label (not products).
    if (!term) {
      const broad = ["meat", "produce", "dairy", "snack", "beverage"];
      const sets = await Promise.all(broad.map((t) => fetchItems(t, params.zip!, Math.ceil((params.limit ?? 40) / broad.length))));
      const seen = new Set<string>();
      const merged: NormalizedDeal[] = [];
      for (const deals of sets) {
        for (const d of deals) {
          const key = d.productName + "|" + d.storeName;
          if (!seen.has(key)) { seen.add(key); merged.push(d); }
        }
      }
      return merged.slice(0, params.limit ?? 40);
    }
    return fetchItems(term, params.zip, params.limit ?? 40);
  },

  async getWeeklyAd(params: DealsSearchParams) {
    if (!params.zip) throw new ProviderError("Enter a ZIP code to load weekly-ad deals.", "bad_request", 400);
    const term = params.query?.trim();
    if (!term) {
      const broad = ["meat", "produce", "dairy", "snack", "beverage", "frozen", "bread"];
      const sets = await Promise.all(broad.map((t) => fetchItems(t, params.zip!, Math.ceil((params.limit ?? 60) / broad.length))));
      const seen = new Set<string>();
      const merged: NormalizedDeal[] = [];
      for (const deals of sets) {
        for (const d of deals) {
          const key = d.productName + "|" + d.storeName;
          if (!seen.has(key)) { seen.add(key); merged.push(d); }
        }
      }
      return merged.slice(0, params.limit ?? 60);
    }
    return fetchItems(term, params.zip, params.limit ?? 60);
  }
};
