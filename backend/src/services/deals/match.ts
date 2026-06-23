import { NormalizedDeal } from "./types.js";

// Pure, deterministic matcher: given normalized deals and the user's grocery items,
// flag which items each deal likely matches (token overlap on name/brand). MCP-friendly:
// no I/O, normalized input/output.
export interface GroceryItemLite {
  id: string;
  name: string;
}
export interface MatchedDeal extends NormalizedDeal {
  matchedItemIds: string[];
}

const STOP = new Set(["the", "and", "with", "for", "size", "each", "pack", "count", "value", "brand", "grocery"]);
function tokenize(s: string): string[] {
  return (s || "").toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2 && !STOP.has(t));
}

export function matchDealsToGroceryList(input: {
  deals: NormalizedDeal[];
  groceryItems: GroceryItemLite[];
}): MatchedDeal[] {
  return input.deals.map((deal) => {
    const dealTokens = new Set(tokenize(`${deal.productName} ${deal.brand ?? ""}`));
    const matchedItemIds = input.groceryItems
      .filter((it) => {
        const itTokens = tokenize(it.name);
        if (!itTokens.length) return false;
        const overlap = itTokens.filter((t) => dealTokens.has(t)).length;
        return overlap / itTokens.length >= 0.5;
      })
      .map((it) => it.id);
    return { ...deal, matchedItemIds };
  });
}
