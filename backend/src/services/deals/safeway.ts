import { DealsProvider, DealsSearchParams, NormalizedDeal, ProviderError } from "./types.js";

// Safeway (Albertsons) has no usable public deals API, and its internal endpoints require
// rotating tokens/headers tied to a store session, so direct scraping is fragile and not
// implemented. Safeway weekly-ad flyers ARE available through the Flipp source (by ZIP),
// so this provider intentionally defers there. Kept as a stub so a dedicated Safeway
// integration can be slotted in later without changing the rest of the system.
export const safewayDealsProvider: DealsProvider = {
  id: "safeway",
  label: "Safeway",
  needsConfig: false,

  async isConfigured() {
    return false;
  },

  async searchDeals(_params: DealsSearchParams): Promise<NormalizedDeal[]> {
    throw new ProviderError(
      "Direct Safeway deals aren't available yet. Use the Flipp source — it includes Safeway weekly-ad flyers by ZIP.",
      "not_configured",
      501
    );
  }
};
