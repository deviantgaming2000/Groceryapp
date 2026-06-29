// Shared helpers for matching live provider products to the app's comparable
// items, and for guessing a sensible unit from a product size string. Used by
// both the single-term search and the pasted-list grouped search.

export interface AppItem {
  id: string;
  name: string;
  category: string;
  unitType: string;
}

const STOP = new Set(["the", "and", "with", "for", "size", "each", "pack", "count", "value", "brand"]);

export function tokenize(s: string): string[] {
  return (s || "").toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2 && !STOP.has(t));
}

/** Suggest the existing item whose name best overlaps the product title. */
export function suggestItem(title: string, items: AppItem[]): AppItem | null {
  const titleTokens = new Set(tokenize(title));
  let best: AppItem | null = null;
  let bestScore = 0;
  for (const it of items) {
    const itTokens = tokenize(it.name);
    if (!itTokens.length) continue;
    const overlap = itTokens.filter((t) => titleTokens.has(t)).length;
    const score = overlap / itTokens.length;
    if (score > bestScore) {
      bestScore = score;
      best = it;
    }
  }
  return bestScore >= 0.5 ? best : null;
}

export function guessUnit(size?: string): string {
  const s = (size || "").toLowerCase();
  if (/fl\.?\s*oz|fluid/.test(s)) return "fl_oz";
  if (/\bgal|gallon/.test(s)) return "gallon";
  if (/\bqt|quart/.test(s)) return "quart";
  if (/\bpt|pint/.test(s)) return "pint";
  if (/\boz|ounce/.test(s)) return "oz";
  if (/\blb|pound/.test(s)) return "lb";
  return "each";
}
