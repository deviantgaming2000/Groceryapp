import { resolveConfig } from "../credentials.js";
import {
  GroceryProvider,
  LocationSearchParams,
  NormalizedLocation,
  NormalizedProduct,
  ProductSearchParams,
  ProviderError
} from "./types.js";

// Safeway rides the user's signed-in Chrome session (the scraper attaches over
// CDP), so pricing always reflects the store selected in their Safeway account.
// There is no store directory here: the provider exposes one synthetic location
// and records the real store id the scraper reports back on each search.
// If explicit per-store lookup is ever needed, a directory can be added the way
// the Walmart provider bundles one (see the design spec, Part 1 extension).
const SOURCE = "safeway";
export const SESSION_STORE_ID = "safeway-session";
const DEFAULT_BASE = "http://localhost:8092";

const SESSION_STORE: NormalizedLocation = {
  source: SOURCE,
  externalId: SESSION_STORE_ID,
  name: "Safeway (your account's store)",
  chain: "Safeway"
};

export interface SafewayScrapedItem {
  name: string;
  price: number | null;
  priceText?: string | null;
  unitPrice?: number | null;
  unitPriceUom?: string | null;
  unitPriceText?: string | null;
  size?: string | null;
  currency?: string;
  url?: string | null;
  itemId?: string | null;
  inStock?: boolean | null;
  availability?: string | null;
  fulfillmentType?: "store" | "warehouse" | "marketplace" | null;
  localInStock?: boolean | null;
  scrapedAt?: string;
}

export interface SafewaySearchResponse {
  storeId?: string | null;
  results?: SafewayScrapedItem[];
  scrapedAt?: string;
}

function slugId(name: string): string {
  return "sw-" + name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
}

export function normalizeSafewayItem(item: SafewayScrapedItem, storeId?: string | null): NormalizedProduct {
  const resolvedStore = storeId && storeId !== SESSION_STORE_ID ? storeId : SESSION_STORE_ID;
  const price = item.price ?? null;
  return {
    source: SOURCE,
    externalProductId: item.itemId || slugId(item.name),
    title: item.name,
    size: item.size ?? undefined,
    productUrl: item.url ?? undefined,
    storeId: resolvedStore,
    storeName: resolvedStore === SESSION_STORE_ID ? SESSION_STORE.name : `Safeway #${resolvedStore}`,
    price,
    regularPrice: price,
    promoPrice: null,
    unitPrice: item.unitPrice ?? null,
    currency: item.currency || "USD",
    available: item.inStock !== false,
    localInStock: item.localInStock ?? null,
    fulfillmentType: item.fulfillmentType ?? null,
    couponEligible: false,
    couponData: null,
    lastUpdated: item.scrapedAt || new Date().toISOString(),
    raw: item
  };
}

async function baseUrl(): Promise<string> {
  const cfg = await resolveConfig(SOURCE);
  const url = cfg.baseUrl?.trim() || process.env.SAFEWAY_SCRAPER_URL?.trim() || DEFAULT_BASE;
  return url.replace(/\/$/, "");
}

function apiKey(): string {
  return process.env.SAFEWAY_SCRAPER_API_KEY?.trim() || "";
}

async function scraperFetch<T>(pathname: string): Promise<T> {
  const base = await baseUrl();
  const headers: Record<string, string> = { Accept: "application/json" };
  const key = apiKey();
  if (key) headers["x-api-key"] = key;

  const controller = new AbortController();
  // A Safeway search drives a real browser and takes 20-30s; allow for a queue.
  const timeout = setTimeout(() => controller.abort(), 120_000);
  let response: Response;
  try {
    response = await fetch(base + pathname, { headers, signal: controller.signal });
  } catch {
    throw new ProviderError(
      `Could not reach the Safeway scraper at ${base}. Is the service running? (npm run safeway in walmart-scraper, with Chrome started via npm run safeway:chrome)`,
      "network",
      502
    );
  } finally {
    clearTimeout(timeout);
  }

  if (response.status === 401) throw new ProviderError("The scraper rejected the API key.", "auth_failed", 502);
  if (!response.ok) {
    let message = `Safeway scraper error (${response.status}).`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body?.error) message = String(body.error);
    } catch {
      /* non-JSON error body */
    }
    if (/imperva|budget|block|challenge|rate/i.test(message)) throw new ProviderError(message, "rate_limited", 429);
    throw new ProviderError(message, "upstream", 502);
  }
  return (await response.json()) as T;
}

const SEARCH_TTL_MS = Number(process.env.SAFEWAY_CACHE_TTL_MS) || 24 * 60 * 60 * 1000;
const CACHE_FETCH = 40;
const searchCache = new Map<string, { at: number; products: NormalizedProduct[] }>();

const recent = new Map<string, NormalizedProduct>();
const RECENT_MAX = 500;
function remember(product: NormalizedProduct) {
  recent.set(product.externalProductId, product);
  if (recent.size > RECENT_MAX) {
    const oldest = recent.keys().next().value;
    if (oldest !== undefined) recent.delete(oldest);
  }
}

export interface SafewayCoupon {
  id: string;
  title: string;
  description: string | null;
  savingsText: string | null;
  expiresAt: string | null;
  brand: string | null;
  category: string | null;
}

export async function fetchSafewayCoupons(): Promise<SafewayCoupon[]> {
  const data = await scraperFetch<{ coupons?: SafewayCoupon[] }>("/coupons");
  return data.coupons ?? [];
}

export const safewayProvider: GroceryProvider = {
  id: SOURCE,
  label: "Safeway (self-hosted)",
  hasStores: false,

  async isConfigured() {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2500);
      const response = await fetch((await baseUrl()) + "/health", { signal: controller.signal });
      clearTimeout(timeout);
      return response.ok;
    } catch {
      return false;
    }
  },

  defaultLocationId() {
    return SESSION_STORE_ID;
  },

  async searchLocations(_params: LocationSearchParams) {
    return [SESSION_STORE];
  },

  async getLocation(externalId: string) {
    if (!externalId || externalId === SESSION_STORE_ID) return SESSION_STORE;
    // A concrete store id the scraper reported earlier stays attributable.
    return { source: SOURCE, externalId, name: `Safeway #${externalId}`, chain: "Safeway" };
  },

  async searchProducts(params: ProductSearchParams) {
    if (!params.term) throw new ProviderError("Enter a search term.", "bad_request", 400);
    const limit = params.limit ?? 15;
    // The session decides the store, so the cache key is the term alone.
    const cacheKey = params.term.trim().toLowerCase();

    const hit = searchCache.get(cacheKey);
    if (hit && Date.now() - hit.at < SEARCH_TTL_MS) {
      hit.products.forEach(remember);
      return hit.products.slice(0, limit);
    }

    const qs = new URLSearchParams({ query: params.term, limit: String(CACHE_FETCH) });
    const data = await scraperFetch<SafewaySearchResponse>(`/search?${qs.toString()}`);
    const products = (data.results ?? []).map((item) => normalizeSafewayItem(item, data.storeId));
    searchCache.set(cacheKey, { at: Date.now(), products });
    products.forEach(remember);
    return products.slice(0, limit);
  },

  async getProduct(externalProductId: string, _locationId?: string) {
    return recent.get(externalProductId) ?? null;
  }
};
