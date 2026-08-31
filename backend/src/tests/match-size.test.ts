import { describe, expect, it } from "vitest";
import { pickBestProduct } from "../routes/providers.js";
import type { NormalizedProduct } from "../services/providers/index.js";

const p = (title: string, price: number, size?: string): NormalizedProduct =>
  ({ source: "test", externalProductId: title, title, size, price, regularPrice: price,
     promoPrice: null, unitPrice: null, currency: "USD", available: true,
     couponEligible: false, couponData: null, lastUpdated: "" }) as NormalizedProduct;

describe("pickBestProduct size gating", () => {
  it("still matches on name when no need is supplied", () => {
    expect(pickBestProduct("Chicken Leg Quarters", [p("Chicken Leg Quarters", 8.72, "10 lb")])?.price).toBe(8.72);
  });

  // A 10 lb need matched to a 1 lb package used to ceiling to 10+ packages and
  // report a ~$138 line for an $8.72 bag.
  it("rejects a package far too small for the needed quantity", () => {
    const got = pickBestProduct("Chicken Leg Quarters", [p("Chicken Leg Quarters", 13.82, "1 lb")],
      { quantity: 10, unit: "lb" });
    expect(got).toBeNull();
  });

  it("prefers a size-compatible package over an incompatible one", () => {
    const got = pickBestProduct("Cole Slaw", [p("Cole Slaw Kit", 1.97, "6 ct"), p("Cole Slaw", 2.50, "16 oz")],
      { quantity: 16, unit: "oz" });
    expect(got?.size).toBe("16 oz");
  });

  it("rejects a match whose units cannot satisfy the need at all", () => {
    expect(pickBestProduct("Bratwurst", [p("Bratwurst", 4.92, "14 oz")], { quantity: 5, unit: "count" })).toBeNull();
  });
});
