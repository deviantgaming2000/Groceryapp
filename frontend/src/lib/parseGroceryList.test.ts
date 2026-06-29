import { describe, expect, it } from "vitest";
import {
  isExtraItem,
  parseGroceryList,
  SAMPLE_GROCERY_LIST,
  type ParsedGroceryItem
} from "./parseGroceryList";

/** Find the first parsed item whose name matches (case-insensitive). */
function byName(items: ParsedGroceryItem[], name: string): ParsedGroceryItem {
  const found = items.find((i) => i.name.toLowerCase() === name.toLowerCase());
  if (!found) throw new Error(`No parsed item named "${name}"`);
  return found;
}

describe("parseGroceryList — basics", () => {
  it("returns nothing for empty / whitespace input", () => {
    expect(parseGroceryList("")).toEqual([]);
    expect(parseGroceryList("   \n\n  \t ")).toEqual([]);
  });

  it("parses a bare single item", () => {
    expect(parseGroceryList("Hummus")).toEqual([{ name: "Hummus" }]);
  });

  it("strips leading numbering and bullets", () => {
    const items = parseGroceryList("1. Apples\n2) Bananas\n- Spinach\n* Garlic\n• Oats");
    expect(items.map((i) => i.name)).toEqual(["Apples", "Bananas", "Spinach", "Garlic", "Oats"]);
  });

  it("is resilient to blank lines and trailing whitespace", () => {
    const items = parseGroceryList("\n  Eggs  \n\n   \nBananas\t\n");
    expect(items.map((i) => i.name)).toEqual(["Eggs", "Bananas"]);
  });

  it("treats lines ending in ':' as section headers and tags following items", () => {
    const items = parseGroceryList("Produce:\nSpinach\nApples\nPantry:\nOats");
    expect(items).toEqual([
      { name: "Spinach", category: "Produce" },
      { name: "Apples", category: "Produce" },
      { name: "Oats", category: "Pantry" }
    ]);
  });
});

describe("parseGroceryList — quantity extraction", () => {
  it("pulls a count quantity", () => {
    expect(byName(parseGroceryList("Eggs, 18 count"), "Eggs")).toEqual({ name: "Eggs", quantity: "18 count" });
  });

  it("pulls a weight quantity", () => {
    expect(parseGroceryList("Ground turkey, 2 lb")[0]).toEqual({ name: "Ground turkey", quantity: "2 lb" });
  });

  it("pulls a weight range quantity alongside an OR-split", () => {
    expect(parseGroceryList("Chicken thighs or chicken breast, 4-5 lb")[0]).toEqual({
      name: "Chicken thighs",
      quantity: "4-5 lb",
      alternatives: ["chicken breast"]
    });
  });

  it("pulls a 'N cans' quantity", () => {
    expect(parseGroceryList("Canned chickpeas, 4 cans")[0]).toEqual({ name: "Canned chickpeas", quantity: "4 cans" });
  });

  it("pulls a size-adjective quantity like 'large tub'", () => {
    expect(parseGroceryList("Plain Greek yogurt, large tub")[0]).toEqual({
      name: "Plain Greek yogurt",
      quantity: "large tub"
    });
  });

  it("does not treat an alternative segment as a quantity", () => {
    const item = parseGroceryList("Almonds, walnuts, or pistachios")[0];
    expect(item.quantity).toBeUndefined();
  });
});

describe("parseGroceryList — OR / alternatives", () => {
  it("splits a simple 'A or B'", () => {
    expect(parseGroceryList("Romaine or mixed greens")[0]).toEqual({
      name: "Romaine",
      alternatives: ["mixed greens"]
    });
  });

  it("splits case-insensitively on 'OR'", () => {
    expect(parseGroceryList("Tomatoes OR cherry tomatoes")[0]).toEqual({
      name: "Tomatoes",
      alternatives: ["cherry tomatoes"]
    });
  });

  it("splits a multi-way Oxford 'A, B, or C' into full options", () => {
    expect(parseGroceryList("Almonds, walnuts, or pistachios")[0]).toEqual({
      name: "Almonds",
      alternatives: ["walnuts", "pistachios"]
    });
  });

  it("expands a 'noun, mod or mod' modifier list into prefixed options", () => {
    expect(parseGroceryList("Berries, fresh or frozen")[0]).toEqual({
      name: "Berries",
      alternatives: ["fresh berries", "frozen berries"]
    });
  });

  it("handles the remaining listed OR-groups", () => {
    expect(parseGroceryList("Brown rice or jasmine rice")[0].alternatives).toEqual(["jasmine rice"]);
    expect(parseGroceryList("Whole wheat pita or wraps")[0].alternatives).toEqual(["wraps"]);
    expect(parseGroceryList("Chickpea pasta or whole wheat pasta")[0].alternatives).toEqual(["whole wheat pasta"]);
    expect(parseGroceryList("Sparkling water or unsweetened iced tea")[0].alternatives).toEqual([
      "unsweetened iced tea"
    ]);
  });
});

describe("parseGroceryList — notes", () => {
  it("keeps parenthetical detail as notes, out of the name", () => {
    expect(parseGroceryList("Olive oil (extra virgin)")[0]).toEqual({
      name: "Olive oil",
      notes: "extra virgin"
    });
  });
});

describe("parseGroceryList — sample list", () => {
  const items = parseGroceryList(SAMPLE_GROCERY_LIST);
  const core = items.filter((i) => !isExtraItem(i));
  const extras = items.filter(isExtraItem);

  it("parses exactly 30 core items", () => {
    expect(core).toHaveLength(30);
  });

  it("keeps drinks/extras as a separate group that does not count toward the 30", () => {
    expect(extras.map((i) => i.name)).toEqual(["White Claw Surge", "Clamato", "Cheap vodka", "Sparkling water"]);
  });

  it("strips numbering across the whole core list", () => {
    expect(core.every((i) => !/^\d/.test(i.name))).toBe(true);
    expect(byName(core, "Spinach").name).toBe("Spinach");
  });

  it("captures the OR-groups required by the spec", () => {
    expect(byName(core, "Chicken thighs").alternatives).toEqual(["chicken breast"]);
    expect(byName(core, "Romaine").alternatives).toEqual(["mixed greens"]);
    expect(byName(core, "Tomatoes").alternatives).toEqual(["cherry tomatoes"]);
    expect(byName(core, "Berries").alternatives).toEqual(["fresh berries", "frozen berries"]);
    expect(byName(core, "Almonds").alternatives).toEqual(["walnuts", "pistachios"]);
  });
});
