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
