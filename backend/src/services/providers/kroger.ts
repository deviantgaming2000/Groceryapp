import {
  GroceryProvider,
  LocationSearchParams,
  NormalizedLocation,
  NormalizedProduct,
  ProductSearchParams,
  ProviderError
} from "./types.js";

const API_BASE = process.env.KROGER_API_BASE ?? "https://api.kroger.com";
// Client-credentials token scope. Kroger's production product scope is "product.compact".
const OAUTH_SCOPE = process.env.KROGER_OAUTH_SCOPE ?? "product.compact";

let cachedToken: { value: string; expiresAt: number } | null = null;

function credentials() {
  return {
    clientId: process.env.KROGER_CLIENT_ID ?? "",
    clientSecret: process.env.KROGER_CLIENT_SECRET ?? ""
  };
}

async function getAccessToken(): Promise<string> {
  const { clientId, clientSecret } = credentials();
  if (!clientId || !clientSecret) {
    throw new ProviderError("Kroger API credentials are not configured on the server.", "not_configured", 503);
  }
  // Reuse a cached token until ~30s before expiry.
  if (cachedToken && cachedToken.expiresAt - 30_000 > Date.now()) {
    return cachedToken.value;
  }

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/v1/connect/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({ grant_type: "client_credentials", scope: OAUTH_SCOPE })
    });
  } catch {
    throw new ProviderError("Could not reach the Kroger authentication service.", "network", 502);
  }

  if (response.status === 401 || response.status === 400) {
    throw new ProviderError("Kroger rejected the API credentials. Check the client ID and secret.", "auth_failed", 502);
  }
  if (!response.ok) {
    throw new ProviderError(`Kroger authentication failed (${response.status}).`, "upstream", 502);
  }

  const json = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) {
    throw new ProviderError("Kroger did not return an access token.", "auth_failed", 502);
  }
  cachedToken = {
    value: json.access_token,
    expiresAt: Date.now() + (json.expires_in ?? 1800) * 1000
  };
  return cachedToken.value;
}

async function krogerGet<T>(path: string, params: Record<string, string | number | undefined>): Promise<T> {
  const token = await getAccessToken();
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "" && value !== null) search.set(key, String(value));
  }
  const url = `${API_BASE}${path}${search.toString() ? `?${search.toString()}` : ""}`;

  let response: Response;
  try {
    response = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
  } catch {
    throw new ProviderError("Could not reach the Kroger API.", "network", 502);
  }

  if (response.status === 401) {
    cachedToken = null; // force refresh next call
    throw new ProviderError("Kroger token was rejected. Please retry.", "auth_failed", 502);
  }
  if (response.status === 403) {
    throw new ProviderError("Kroger denied the request (missing API scopes).", "auth_failed", 502);
  }
  if (response.status === 404) {
    throw new ProviderError("Not found at Kroger.", "not_found", 404);
  }
  if (response.status === 429) {
    throw new ProviderError("Kroger API rate limit reached. Try again shortly.", "rate_limited", 429);
  }
  if (!response.ok) {
    throw new ProviderError(`Kroger API error (${response.status}).`, "upstream", 502);
  }
  return (await response.json()) as T;
}

// ---- Raw Kroger response shapes (only the fields we use) ----
interface KrogerLocation {
  locationId: string;
  chain?: string;
  name?: string;
  phone?: string;
  address?: { addressLine1?: string; city?: string; state?: string; zipCode?: string };
  geolocation?: { latitude?: number; longitude?: number };
}
interface KrogerProduct {
  productId: string;
  description?: string;
  brand?: string;
  categories?: string[];
  productPageURI?: string;
  images?: Array<{ perspective?: string; sizes?: Array<{ size?: string; url?: string }> }>;
  items?: Array<{
    size?: string;
    price?: { regular?: number; promo?: number; regularPerUnitEstimate?: number; promoPerUnitEstimate?: number };
    inventory?: { stockLevel?: string };
    fulfillment?: { instore?: boolean; delivery?: boolean; curbside?: boolean; shiptohome?: boolean };
  }>;
}

function pickImage(product: KrogerProduct): string | undefined {
  const images = product.images ?? [];
  const front = images.find((img) => img.perspective === "front") ?? images[0];
  if (!front?.sizes?.length) return undefined;
  const preferred = ["large", "medium", "small", "thumbnail", "xlarge"];
  for (const size of preferred) {
    const match = front.sizes.find((s) => s.size === size);
    if (match?.url) return match.url;
  }
  return front.sizes[0]?.url;
}

function normalizeProduct(product: KrogerProduct, locationId?: string, storeName?: string): NormalizedProduct {
  const item = product.items?.[0];
  const regular = item?.price?.regular ?? null;
  const promo = item?.price?.promo && item.price.promo > 0 ? item.price.promo : null;
  const effective = promo ?? regular;
  const unit = item?.price?.promoPerUnitEstimate || item?.price?.regularPerUnitEstimate || null;
  const couponEligible = promo != null && regular != null && promo < regular;
  const stock = item?.inventory?.stockLevel;
  const available = stock ? stock !== "TEMPORARILY_OUT_OF_STOCK" : item?.fulfillment?.instore ?? true;

  return {
    source: "kroger",
    externalProductId: product.productId,
    title: product.description ?? "Unknown product",
    brand: product.brand,
    size: item?.size,
    category: product.categories?.[0],
    imageUrl: pickImage(product),
    productUrl: product.productPageURI ? `https://www.kroger.com${product.productPageURI}` : undefined,
    storeId: locationId,
    storeName,
    price: effective,
    regularPrice: regular,
    promoPrice: promo,
    unitPrice: unit,
    currency: "USD",
    available,
    couponEligible,
    couponData: couponEligible
      ? { type: "promo", regularPrice: regular, promoPrice: promo, savings: regular! - promo! }
      : null,
    lastUpdated: new Date().toISOString(),
    raw: product
  };
}

function normalizeLocation(loc: KrogerLocation): NormalizedLocation {
  return {
    source: "kroger",
    externalId: loc.locationId,
    name: loc.name ?? loc.chain ?? "Kroger store",
    chain: loc.chain,
    address: loc.address?.addressLine1,
    city: loc.address?.city,
    state: loc.address?.state,
    zip: loc.address?.zipCode,
    phone: loc.phone,
    latitude: loc.geolocation?.latitude ?? null,
    longitude: loc.geolocation?.longitude ?? null
  };
}

export const krogerProvider: GroceryProvider = {
  id: "kroger",
  label: "Kroger / Fry's",

  isConfigured() {
    const { clientId, clientSecret } = credentials();
    return Boolean(clientId && clientSecret);
  },

  async searchLocations(params: LocationSearchParams) {
    const query: Record<string, string | number | undefined> = {
      "filter.limit": params.limit ?? 15,
      "filter.radiusInMiles": params.radiusInMiles ?? 25
    };
    if (params.zip) query["filter.zipCode.near"] = params.zip;
    if (params.lat != null && params.lon != null) query["filter.latLong.near"] = `${params.lat},${params.lon}`;
    if (params.term) query["filter.chain"] = params.term;
    if (!params.zip && params.lat == null && !params.term) {
      throw new ProviderError("Enter a ZIP code to search for nearby stores.", "bad_request", 400);
    }
    const data = await krogerGet<{ data: KrogerLocation[] }>("/v1/locations", query);
    return (data.data ?? []).map(normalizeLocation);
  },

  async getLocation(externalId: string) {
    try {
      const data = await krogerGet<{ data: KrogerLocation }>(`/v1/locations/${externalId}`, {});
      return data.data ? normalizeLocation(data.data) : null;
    } catch (error) {
      if (error instanceof ProviderError && error.code === "not_found") return null;
      throw error;
    }
  },

  async searchProducts(params: ProductSearchParams) {
    if (!params.term && !params.brand) {
      throw new ProviderError("Enter a search term.", "bad_request", 400);
    }
    const storeName = undefined;
    const data = await krogerGet<{ data: KrogerProduct[] }>("/v1/products", {
      "filter.term": params.term,
      "filter.brand": params.brand,
      "filter.locationId": params.locationId,
      "filter.limit": params.limit ?? 15,
      "filter.start": params.start
    });
    return (data.data ?? []).map((product) => normalizeProduct(product, params.locationId, storeName));
  },

  async getProduct(externalProductId: string, locationId?: string) {
    const data = await krogerGet<{ data: KrogerProduct }>(`/v1/products/${externalProductId}`, {
      "filter.locationId": locationId
    });
    return data.data ? normalizeProduct(data.data, locationId) : null;
  }
};
