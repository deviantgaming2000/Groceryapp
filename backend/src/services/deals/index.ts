import { DealsProvider } from "./types.js";
import { flippDealsProvider } from "./flipp.js";
import { krogerDealsProvider } from "./kroger.js";
import { manualDealsProvider } from "./manual.js";
import { safewayDealsProvider } from "./safeway.js";

// Deals provider registry. Add new sources here.
export const dealsProviders: Record<string, DealsProvider> = {
  flipp: flippDealsProvider,
  kroger: krogerDealsProvider,
  manual: manualDealsProvider,
  safeway: safewayDealsProvider
};

export function getDealsProvider(id: string): DealsProvider | undefined {
  return dealsProviders[id];
}

export * from "./types.js";
export { matchDealsToGroceryList } from "./match.js";
