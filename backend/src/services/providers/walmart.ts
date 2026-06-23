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

// Walmart has no public product API, so we go through SerpApi's Walmart engine.
// SerpApi's Walmart engine accepts a `store_id` to return store-specific pricing; without
// one it returns national Walmart.com pricing. Store IDs come from the bundled store
// directory (browse by state -> city) or can be entered directly.
const SERP_BASE = process.env.SERPAPI_BASE ?? "https://serpapi.com/search.json";
const ONLINE_STORE_ID = "walmart-online";

const ONLINE_STORE: NormalizedLocation = {
  source: "walmart",
  externalId: ONLINE_STORE_ID,
  name: "Walmart.com (national pricing)",
  chain: "Walmart",
  city: "Online",
  state: "US"
};

async function getApiKey(): Promise<string> {
  const config = await resolveConfig("walmart");
  const key = config.apiKey ?? "";
  if (!key) throw new ProviderError("SerpApi key is not configured on the server.", "not_configured", 503);
  return key;
}

async function serpGet<T>(params: Record<string, string | number | undefined>): Promise<T> {
  const apiKey = await getApiKey();
  const url = new URL(SERP_BASE);
  url.searchParams.set("engine", "walmart");
  url.searchParams.set("api_key", apiKey);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "" && value !== null) url.searchParams.set(key, String(value));
  }

  let response: Response;
  try {
    response = await fetch(url, { headers: { Accept: "application/json" } });
  } catch {
    throw new ProviderError("Could not reach SerpApi.", "network", 502);
  }

  if (response.status === 401) {
    throw new ProviderError("SerpApi rejected the API key.", "auth_failed", 502);
  }
  if (response.status === 429) {
    throw new ProviderError("SerpApi rate/usage limit reached. Try again later.", "rate_limited", 429);
  }
  if (!response.ok) {
    throw new ProviderError(`SerpApi error (${response.status}).`, "upstream", 502);
  }
  const json = (await response.json()) as T & { error?: string };
  if (json.error) {
    // SerpApi reports auth/usage problems in a 200 body.
    const message = String(json.error);
    if (/api[_ ]?key/i.test(message)) throw new ProviderError("SerpApi rejected the API key.", "auth_failed", 502);
    if (/run out|limit/i.test(message)) throw new ProviderError("SerpApi usage limit reached.", "rate_limited", 429);
    throw new ProviderError(message, "upstream", 502);
  }
  return json;
}

// ---- Raw SerpApi shapes (only the fields we use) ----
interface SerpOffer {
  offer_price?: number;
  min_price?: number;
  list_price?: number;
}
interface SerpProduct {
  us_item_id?: string;
  product_id?: string;
  title?: string;
  thumbnail?: string;
  brand?: string;
  seller_name?: string;
  product_page_url?: string;
  link?: string;
  primary_offer?: SerpOffer;
  price_per_unit?: { unit?: string; amount?: number };
  out_of_stock?: boolean;
}

function normalize(product: SerpProduct, locationId?: string): NormalizedProduct {
  const offer = product.primary_offer ?? {};
  const regular = offer.list_price ?? null;
  const current = offer.offer_price ?? offer.min_price ?? null;
  // If a higher list price exists than the current price, treat the difference as a deal.
  const hasDeal = regular != null && current != null && regular > current;
  const effective = current ?? regular;
  const externalProductId = product.us_item_id || product.product_id || "";
  const storeId = locationId && locationId !== ONLINE_STORE_ID ? locationId : ONLINE_STORE_ID;
  const storeName = storeId === ONLINE_STORE_ID ? ONLINE_STORE.name : `Walmart #${storeId}`;

  return {
    source: "walmart",
    externalProductId,
    title: product.title ?? "Unknown product",
    brand: product.brand || product.seller_name,
    size: product.price_per_unit?.unit,
    category: undefined,
    imageUrl: product.thumbnail,
    productUrl: product.product_page_url || product.link,
    storeId,
    storeName,
    price: effective,
    regularPrice: hasDeal ? regular : effective,
    promoPrice: hasDeal ? current : null,
    unitPrice: product.price_per_unit?.amount ?? null,
    currency: "USD",
    available: product.out_of_stock !== true,
    couponEligible: hasDeal,
    couponData: hasDeal ? { type: "rollback", regularPrice: regular, promoPrice: current, savings: regular! - current! } : null,
    lastUpdated: new Date().toISOString(),
    raw: product
  };
}

/** A store_id usable by SerpApi, or undefined for national pricing. */
function serpStoreId(locationId?: string): string | undefined {
  return locationId && locationId !== ONLINE_STORE_ID ? locationId : undefined;
}

export const walmartProvider: GroceryProvider = {
  id: "walmart",
  label: "Walmart (via SerpApi)",
  hasStores: true,
  hasDirectory: true,

  async isConfigured() {
    const config = await resolveConfig("walmart");
    return Boolean(config.apiKey);
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
    // Browse the bundled directory by state/city/free-text (ZIP is treated as free text).
    if (params.state || params.city || params.q || params.zip) {
      const stores = findStores({
        state: params.state,
        city: params.city,
        q: params.q || params.zip,
        limit: params.limit ?? 60
      });
      return [ONLINE_STORE, ...stores];
    }
    return [ONLINE_STORE];
  },

  async getLocation(externalId: string) {
    if (!externalId || externalId === ONLINE_STORE_ID) return ONLINE_STORE;
    return (
      getStoreById(externalId) ?? {
        source: "walmart",
        externalId,
        name: `Walmart #${externalId}`,
        chain: "Walmart"
      }
    );
  },

  async searchProducts(params: ProductSearchParams) {
    if (!params.term) throw new ProviderError("Enter a search term.", "bad_request", 400);
    const data = await serpGet<{ organic_results?: SerpProduct[] }>({
      query: params.term,
      store_id: serpStoreId(params.locationId),
      // SerpApi paginates by page number; approximate from start/limit.
      page: params.start && params.limit ? Math.floor(params.start / params.limit) + 1 : undefined
    });
    const results = (data.organic_results ?? []).filter((p) => p.us_item_id || p.product_id);
    const limit = params.limit ?? 15;
    return results.slice(0, limit).map((p) => normalize(p, params.locationId));
  },

  async getProduct(externalProductId: string, locationId?: string) {
    // Use the search engine filtered to the item id to avoid a second engine dependency.
    const data = await serpGet<{ organic_results?: SerpProduct[] }>({
      query: externalProductId,
      store_id: serpStoreId(locationId)
    });
    const match =
      (data.organic_results ?? []).find((p) => p.us_item_id === externalProductId || p.product_id === externalProductId) ??
      (data.organic_results ?? [])[0];
    return match ? normalize(match, locationId) : null;
  }
};
