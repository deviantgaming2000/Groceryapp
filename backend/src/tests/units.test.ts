import { describe, expect, it } from "vitest";
import { packagesNeeded, unitsCompatible } from "../services/units.js";

describe("discrete unit compatibility", () => {
  // "each" and "count" both mean one discrete thing. A list asking for 4 limes
  // (count) must be satisfiable by a lime priced per lime (each), and vice
  // versa - otherwise the item silently reports as "missing price data".
  it("treats each and count as the same family", () => {
    expect(unitsCompatible("each", "count")).toBe(true);
    expect(unitsCompatible("count", "each")).toBe(true);
  });

  it("buys one package per unit needed across each/count", () => {
    const limes = packagesNeeded(4, "count", 1, "each");
    expect(limes).not.toBeNull();
    expect(limes?.packageCount).toBe(4);
    expect(limes?.leftoverQuantity).toBe(0);
  });

  it("still keeps weight and volume families apart", () => {
    expect(unitsCompatible("lb", "fl_oz")).toBe(false);
    expect(unitsCompatible("each", "oz")).toBe(false);
    expect(packagesNeeded(1, "pack", 16, "oz")).toBeNull();
  });
});
