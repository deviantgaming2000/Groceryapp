// Turns a pasted, free-text grocery list into structured, searchable items.
//
// Output is intentionally provider-agnostic — the Find Products UI feeds each
// item's name (plus any alternatives) into the existing provider search. The
// parser is pure and side-effect free so it can be unit-tested exhaustively.

export interface ParsedGroceryItem {
  /** Primary search term (first option when alternatives are present). */
  name: string;
  /** Section header the item appeared under, when the list was grouped. */
  category?: string;
  /** Free-text amount pulled from the line, e.g. "18 count", "4-5 lb", "large tub". */
  quantity?: string;
  /** Equivalent options to search as an OR-group, e.g. ["chicken breast"]. */
  alternatives?: string[];
  /** Parenthetical / leftover detail that does not belong in the name. */
  notes?: string;
}

// Leading list decoration: "1.", "2)", "3]", "-", "*", "•", "–", "·".
const BULLET_RE = /^\s*(?:\d{1,3}[.)\]]|[-*•·–])\s+/;

// A trailing comma-segment is read as a quantity when it starts with a number
// ("18 count", "4-5 lb", "2 lb", "4 cans") or a size adjective ("large tub").
const QTY_NUMERIC_RE = /^\d/;
const QTY_SIZE_RE = /^(?:extra\s+)?(?:small|medium|large|big|jumbo|family|mini|x-?large|xl)\b/i;

function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** A line is a section header when it ends with ":" (e.g. "Produce:", "Drinks & extras:"). */
function isHeader(line: string): boolean {
  return /:\s*$/.test(line);
}

/** "Drinks & extras (not part of the core 30):" -> "Drinks & extras". */
function cleanHeader(line: string): string {
  return collapse(line.replace(/:\s*$/, "").replace(/\([^)]*\)/g, ""));
}

function looksLikeQuantity(segment: string): boolean {
  const s = segment.trim();
  if (!s) return false;
  if (/^or\b/i.test(s)) return false; // "or pistachios" is an alternative, not an amount
  return QTY_NUMERIC_RE.test(s) || QTY_SIZE_RE.test(s);
}

/** Split a cleaned line into a primary name and any OR-alternatives. */
function splitAlternatives(text: string): { name: string; alternatives?: string[] } {
  const hasOr = /\sor\s/i.test(text);
  if (!hasOr) return { name: collapse(text) };

  // Oxford-style noun list: "almonds, walnuts, or pistachios" -> three full options.
  if (/,\s*or\s/i.test(text)) {
    const options = text
      .replace(/,\s*or\s+/i, ", ")
      .split(/\s*,\s*/)
      .map(collapse)
      .filter(Boolean);
    if (options.length > 1) {
      return { name: options[0], alternatives: options.slice(1) };
    }
  }

  // Modifier list: "Berries, fresh or frozen" -> "fresh berries" / "frozen berries".
  const comma = text.indexOf(",");
  if (comma >= 0) {
    const head = collapse(text.slice(0, comma));
    const tail = text.slice(comma + 1);
    const mods = tail.split(/\sor\s/i).map(collapse).filter(Boolean);
    if (head && mods.length > 1) {
      return {
        name: head,
        alternatives: mods.map((m) => collapse(`${m} ${head}`).toLowerCase())
      };
    }
  }

  // Plain "A or B [or C]".
  const parts = text.split(/\sor\s/i).map(collapse).filter(Boolean);
  if (parts.length > 1) {
    return { name: parts[0], alternatives: parts.slice(1) };
  }
  return { name: collapse(text) };
}

function parseLine(line: string): ParsedGroceryItem {
  let working = line;

  // Pull out parenthetical detail as notes ("Olive oil (extra virgin)").
  const notes: string[] = [];
  working = working.replace(/\(([^)]*)\)/g, (_m, inner) => {
    const detail = collapse(inner);
    if (detail) notes.push(detail);
    return " ";
  });
  working = collapse(working);

  // Pull a quantity off the final comma-segment when it reads like an amount.
  let quantity: string | undefined;
  const lastComma = working.lastIndexOf(",");
  if (lastComma >= 0) {
    const tail = working.slice(lastComma + 1);
    if (looksLikeQuantity(tail)) {
      quantity = collapse(tail);
      working = collapse(working.slice(0, lastComma));
    }
  }

  const { name, alternatives } = splitAlternatives(working);

  const item: ParsedGroceryItem = { name };
  if (quantity) item.quantity = quantity;
  if (alternatives && alternatives.length) item.alternatives = alternatives;
  if (notes.length) item.notes = notes.join("; ");
  return item;
}

/** Parse a multi-line, free-text grocery list into structured items. */
export function parseGroceryList(input: string): ParsedGroceryItem[] {
  if (!input) return [];
  const items: ParsedGroceryItem[] = [];
  let category: string | undefined;

  for (const raw of input.split(/\r?\n/)) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const line = collapse(trimmed.replace(BULLET_RE, ""));
    if (!line) continue;
    if (isHeader(line)) {
      category = cleanHeader(line) || undefined;
      continue;
    }
    const item = parseLine(line);
    if (!item.name) continue;
    if (category) item.category = category;
    items.push(item);
  }
  return items;
}

/** True when an item came from a clearly-separated, non-core section (drinks/extras). */
export function isExtraItem(item: ParsedGroceryItem): boolean {
  return /\b(extra|extras|drink|drinks|alcohol|misc)\b/i.test(item.category ?? "");
}

// 30 core items + a clearly-separated drinks/extras group. Wired into the paste
// box via a "Load sample" affordance; the extras do NOT count toward the 30.
export const SAMPLE_GROCERY_LIST = `1. Chicken thighs or chicken breast, 4-5 lb
2. Ground turkey, 2 lb
3. Eggs, 18 count
4. Plain Greek yogurt, large tub
5. Hummus
6. Feta cheese
7. Canned chickpeas, 4 cans
8. Canned white beans, 3 cans
9. Romaine or mixed greens
10. Spinach
11. Cucumbers
12. Tomatoes or cherry tomatoes
13. Bell peppers
14. Red onions
15. Zucchini
16. Broccoli
17. Sweet potatoes
18. Garlic
19. Lemons
20. Avocados
21. Apples
22. Berries, fresh or frozen
23. Bananas
24. Brown rice or jasmine rice
25. Whole wheat pita or wraps
26. Oats
27. Chickpea pasta or whole wheat pasta
28. Extra virgin olive oil
29. Kalamata olives
30. Almonds, walnuts, or pistachios

Drinks & extras (not part of the core 30):
- White Claw Surge
- Clamato
- Cheap vodka
- Sparkling water or unsweetened iced tea`;
