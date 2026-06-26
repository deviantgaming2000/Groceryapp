// Normalized deal model + provider interface. Every deal source (Flipp, Kroger,
// Safeway, manual coupons) maps its raw data into NormalizedDeal so the UI, automations,
// and a future MCP tool all consume one clean shape. Reuses ProviderError for consistent,
// secret-free error handling.
export { ProviderError } from "../providers/types.js";

export interface NormalizedDeal {
  source: string; // "flipp" | "kroger" | "safeway" | "manual" | "other"
  storeName?: string;
  storeId?: string;
  location?: string;
  productName: string;
  brand?: string;
  size?: string;
  salePrice: number | null;
  regularPrice: number | null;
  discountAmount: number | null;
  dealText?: string; // promo offer with no simple unit price, e.g. "BUY 3 GET 3 FREE"
  couponRequired: boolean;
  digitalCoupon: boolean;
  loyaltyRequired: boolean;
  description?: string;
  imageUrl?: string;
  sourceUrl?: string;
  validFrom?: string | null;
  validTo?: string | null;
  category?: string;
  confidence: number; // 0..1 — how trustworthy the parse is
  raw?: unknown;
}

export interface DealsSearchParams {
  query?: string;
  zip?: string;
  storeId?: string;
  location?: string;
  userId?: string; // for DB-backed providers (manual coupons)
  limit?: number;
}

/** A pluggable deals source. Add new stores by implementing this. */
export interface DealsProvider {
  readonly id: string;
  readonly label: string;
  /** True if it requires server-side API keys (e.g. Kroger). */
  readonly needsConfig: boolean;
  isConfigured(): Promise<boolean>;
  searchDeals(params: DealsSearchParams): Promise<NormalizedDeal[]>;
  getWeeklyAd?(params: DealsSearchParams): Promise<NormalizedDeal[]>;
  getCoupons?(params: DealsSearchParams): Promise<NormalizedDeal[]>;
}
