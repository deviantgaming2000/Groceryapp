import { GroceryProvider } from "./types.js";
import { krogerProvider } from "./kroger.js";

// Provider registry. Add Walmart/Safeway here once their providers are implemented.
export const providers: Record<string, GroceryProvider> = {
  kroger: krogerProvider
};

export function getProvider(id: string): GroceryProvider | undefined {
  return providers[id];
}

export * from "./types.js";
