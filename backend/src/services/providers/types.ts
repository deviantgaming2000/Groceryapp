// Shared, provider-agnostic shapes. Every grocery data provider (Kroger today,
// Walmart/Safeway later) normalizes its raw API responses into these types so the
// rest of the app — and the frontend — never touches provider-specific JSON.

export interface NormalizedLocation {
  source: string;
  externalId: string;
  name: string;
  chain?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  phone?: string;
  latitude?: number | null;
  longitude?: number | null;
}

export interface NormalizedCoupon {
  type: string; // e.g. "promo", "loyalty", "digital"
  description?: string;
  regularPrice?: number | null;
  promoPrice?: number | null;
  savings?: number | null;
}

export interface NormalizedProduct {
  source: string;
  externalProductId: string;
  title: string;
  brand?: string;
  size?: string;
  category?: string;
  imageUrl?: string;
  productUrl?: string;
  storeId?: string; // external location id the price is valid for
  storeName?: string;
  price: number | null; // effective price (promo if present, else regular)
  regularPrice: number | null;
  promoPrice: number | null;
  unitPrice: number | null;
  currency: string;
  available: boolean;
  couponEligible: boolean;
  couponData: NormalizedCoupon | null;
  lastUpdated: string;
  raw?: unknown;
}

export interface LocationSearchParams {
  zip?: string;
  lat?: number;
  lon?: number;
  term?: string;
  radiusInMiles?: number;
  limit?: number;
}

export interface ProductSearchParams {
  term: string;
  locationId?: string;
  brand?: string;
  limit?: number;
  start?: number;
}

/** A pluggable grocery data provider. Add Walmart/Safeway by implementing this. */
export interface GroceryProvider {
  readonly id: string; // "kroger"
  readonly label: string; // "Kroger / Fry's"
  isConfigured(): boolean;
  searchLocations(params: LocationSearchParams): Promise<NormalizedLocation[]>;
  getLocation(externalId: string): Promise<NormalizedLocation | null>;
  searchProducts(params: ProductSearchParams): Promise<NormalizedProduct[]>;
  getProduct(externalProductId: string, locationId?: string): Promise<NormalizedProduct | null>;
}

/** Thrown by providers so routes can return clean, user-friendly errors. */
export class ProviderError extends Error {
  constructor(
    message: string,
    readonly code:
      | "not_configured"
      | "auth_failed"
      | "not_found"
      | "rate_limited"
      | "network"
      | "bad_request"
      | "upstream",
    readonly status = 502
  ) {
    super(message);
    this.name = "ProviderError";
  }
}
