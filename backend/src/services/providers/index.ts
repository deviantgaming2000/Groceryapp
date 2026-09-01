import { GroceryProvider } from "./types.js";
import { krogerProvider } from "./kroger.js";
import { walmartProvider } from "./walmart.js";
import { walmartScraperProvider } from "./walmart-scraper.js";
import { safewayProvider } from "./safeway.js";

export const providers: Record<string, GroceryProvider> = {
  kroger: krogerProvider,
  walmart: walmartProvider,
  "walmart-scraper": walmartScraperProvider,
  safeway: safewayProvider
};

export function getProvider(id: string): GroceryProvider | undefined {
  return providers[id];
}

export * from "./types.js";
