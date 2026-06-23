import { resolveConfig } from "../credentials.js";
import { findStores, getStoreById, listCities, listStates } from "./walmart-stores.js";
import {
  GroceryProvider,
  LocationSearchParams,
  NormalizedLocation,
  NormalizedProduct,
  ProductSearchParams,
  ProviderError
} from "./types.js";

// Free, self-hosted alternative to the SerpApi Walmart provider. Instead of a paid
// API, it talks over HTTP to the local "walmart-scraper" service (a stealth Playwright
// scraper). The service URL is configurable in Settings (default http://localhost:8090)
// because it may run on this machine or a remote server. Store selection reuses the
// same bundled Walmart store directory the SerpApi provider uses.
const SOURCE = "walmart-scraper";
const ONLINE_STORE_ID = "walmart-online";
const DEFAULT_BASE = "http://localhost:8090";

const ONLINE_STORE: NormalizedLocation = {
  source: SOURCE,
  externalId: ONLINE_STORE_ID,
  name: "Walmart.com (default location)",
  chain: "Walmart",
  city: "Online",
  state: "US"
};

/** Re-tag a bundled directory location as belonging to this provider. */
function tag(loc: NormalizedLocation): NormalizedLocation {
  return { ...loc, source: SOURCE };
}

async function baseUrl(): Promise<string> {
  const cfg = await resolveConfig(SOURCE);
  const url = cfg.baseUrl?.trim() || process.env.WALMART_SCRAPER_URL?.trim() || DEFAULT_BASE;
  return url.replace(/\/$/, "");
}

function apiKey(): string {
  return process.env.WALMART_SCRAPER_API_KEY?.trim() || "";
}

async function scraperFetch<T>(pathname: string): Promise<T> {
  const base = await baseUrl();
  const headers: Record<string, string> = { Accept: "application/json" };
  const key = apiKey();
  if (key) headers["x-api-key"] = key;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000); // scraping is deliberately slow
  let response: Response;
  try {
    response = await fetch(base + pathname, { headers, signal: controller.signal });
  } catch {
    throw new ProviderError(
      `Could not reach the Walmart scraper at ${base}. Is the service running? (npm run api in walmart-scraper)`,
      "network",
      502
    );
  } finally {
    clearTimeout(timeout);
  }

  if (response.status === 401) throw new ProviderError("The scraper rejected the API key.", "auth_failed", 502);
  if (!response.ok) {
    let message = `Scraper error (${response.status}).`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body?.error) message = String(body.error);
    } catch {
      /* non-JSON error body */
    }
    // The scraper surfaces bot-block / budget conditions in its error text.
    if (/budget|block|challenge|rate/i.test(message)) throw new ProviderError(message, "rate_limited", 429);
    throw new ProviderError(message, "upstream", 502);
  }
  return (await response.json()) as T;
}

// ---- Scraper response shapes (only the fields we use) ----
interface ScrapedItem {
  name: string;
  price: number | null;
  priceText: string | null;
  currency?: string;
  url: string | null;
  inStock: boolean | null;
  scrapedAt?: string;
}
interface SearchResponse {
  results?: ScrapedItem[];
}

// The scraper can't look a product up by Walmart item id, so we cache the products
// from the latest searches. import/getProduct then resolves the picked product
// immediately after a search (the normal flow) without re-scraping.
const recent = new Map<string, NormalizedProduct>();
const RECENT_MAX = 500;
function remember(product: NormalizedProduct) {
  recent.set(product.externalProductId, product);
  if (recent.size > RECENT_MAX) {
    const oldest = recent.keys().next().value;
    if (oldest !== undefined) recent.delete(oldest);
  }
}

/** Derive a stable product id from the Walmart /ip/<slug>/<id> URL, with a name fallback. */
function idFromUrl(url: string | null, name: string): string {
  if (url) {
    const m = url.match(/\/ip\/(?:.*\/)?(\d+)(?:[/?#]|$)/);
    if (m) return m[1];
  }
  return "wm-" + name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
}

function normalize(item: ScrapedItem, locationId?: string): NormalizedProduct {
  const storeId = locationId && locationId !== ONLINE_STORE_ID ? locationId : ONLINE_STORE_ID;
  return {
    source: SOURCE,
    externalProductId: idFromUrl(item.url, item.name),
    title: item.name,
    brand: undefined,
    size: undefined,
    category: undefined,
    imageUrl: undefined,
    productUrl: item.url ?? undefined,
    storeId,
    storeName: storeId === ONLINE_STORE_ID ? ONLINE_STORE.name : `Walmart #${storeId}`,
    price: item.price ?? null,
    regularPrice: item.price ?? null,
    promoPrice: null,
    unitPrice: null,
    currency: item.currency || "USD",
    available: item.inStock !== false,
    couponEligible: false,
    couponData: null,
    lastUpdated: item.scrapedAt || new Date().toISOString(),
    raw: item
  };
}

export const walmartScraperProvider: GroceryProvider = {
  id: SOURCE,
  label: "Walmart (self-hosted)",
  hasStores: true,
  hasDirectory: true,

  async isConfigured() {
    // "Configured" means the scraper service is reachable.
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
    return ONLINE_STORE_ID;
  },

  async listStates() {
    return listStates();
  },

  async listCities(state: string) {
    return listCities(state);
  },

  async searchLocations(params: LocationSearchParams) {
    if (params.state || params.city || params.q || params.zip) {
      const stores = findStores({
        state: params.state,
        city: params.city,
        q: params.q || params.zip,
        limit: params.limit ?? 60
      });
      return [ONLINE_STORE, ...stores.map(tag)];
    }
    return [ONLINE_STORE];
  },

  async getLocation(externalId: string) {
    if (!externalId || externalId === ONLINE_STORE_ID) return ONLINE_STORE;
    const store = getStoreById(externalId);
    return store ? tag(store) : { source: SOURCE, externalId, name: `Walmart #${externalId}`, chain: "Walmart" };
  },

  async searchProducts(params: ProductSearchParams) {
    if (!params.term) throw new ProviderError("Enter a search term.", "bad_request", 400);
    const limit = params.limit ?? 15;
    const qs = new URLSearchParams({ query: params.term, store: "walmart", limit: String(limit) });
    if (params.locationId && params.locationId !== ONLINE_STORE_ID) qs.set("storeId", params.locationId);

    const data = await scraperFetch<SearchResponse>(`/search?${qs.toString()}`);
    const products = (data.results ?? []).slice(0, limit).map((item) => normalize(item, params.locationId));
    products.forEach(remember);
    return products;
  },

  async getProduct(externalProductId: string, _locationId?: string) {
    // Resolved from the recent-search cache (the search → import flow). A later
    // refresh after a restart can't re-query Walmart by item id, so it reports
    // not found rather than returning a wrong product.
    return recent.get(externalProductId) ?? null;
  }
};
