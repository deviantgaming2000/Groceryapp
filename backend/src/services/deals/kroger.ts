import { krogerProvider } from "../providers/kroger.js";
import { DealsProvider, DealsSearchParams, NormalizedDeal, ProviderError } from "./types.js";

// Kroger/Fry's deals derived from the official Products API: products carrying a promo
// (loyalty) price below their regular price are surfaced as deals. Reuses the existing,
// configured Kroger provider — no new external calls or keys.
export const krogerDealsProvider: DealsProvider = {
  id: "kroger",
  label: "Kroger / Fry's (promotions)",
  needsConfig: true,

  isConfigured() {
    return krogerProvider.isConfigured();
  },

  async searchDeals(params: DealsSearchParams) {
    if (!params.storeId) {
      throw new ProviderError("Select a Kroger/Fry's store first to see local promotions.", "bad_request", 400);
    }
    const products = await krogerProvider.searchProducts({
      term: params.query?.trim() || "grocery",
      locationId: params.storeId,
      limit: params.limit ?? 40
    });
    return products
      .filter((p) => p.couponEligible && p.promoPrice != null)
      .map(
        (p): NormalizedDeal => ({
          source: "kroger",
          storeName: p.storeName,
          storeId: params.storeId,
          location: params.location,
          productName: p.title,
          brand: p.brand,
          size: p.size,
          salePrice: p.promoPrice,
          regularPrice: p.regularPrice,
          discountAmount:
            p.regularPrice != null && p.promoPrice != null
              ? Number((p.regularPrice - p.promoPrice).toFixed(2))
              : null,
          couponRequired: false,
          digitalCoupon: false,
          loyaltyRequired: true, // Kroger promo pricing typically requires the loyalty card
          imageUrl: p.imageUrl,
          sourceUrl: p.productUrl,
          validFrom: null,
          validTo: null,
          category: p.category,
          confidence: 0.9,
          raw: p.raw
        })
      );
  }
};
