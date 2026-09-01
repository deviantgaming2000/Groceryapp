import { describe, expect, it } from "vitest";
import { normalizeSafewayItem, SESSION_STORE_ID } from "../services/providers/safeway.js";

const item = {
  name: "Lucerne Milk Whole 1 Gallon",
  price: 3.99,
  priceText: "$3.99",
  unitPrice: 0.031,
  unitPriceUom: "fl oz",
  unitPriceText: "3.1 ¢/fl oz",
  size: "1 gallon",
  currency: "USD",
  url: "https://www.safeway.com/shop/product-details.960109496.html",
  itemId: "960109496",
  inStock: true,
  availability: "in_stock" as const,
  fulfillmentType: "store" as const,
  pickupAvailable: null,
  deliveryAvailable: null,
  localInStock: true,
  scrapedAt: "2026-08-31T10:00:00.000Z"
};

describe("normalizeSafewayItem", () => {
  it("maps the scraper item onto NormalizedProduct", () => {
    const p = normalizeSafewayItem(item, "3132");
    expect(p.source).toBe("safeway");
    expect(p.externalProductId).toBe("960109496");
    expect(p.title).toBe("Lucerne Milk Whole 1 Gallon");
    expect(p.price).toBe(3.99);
    expect(p.regularPrice).toBe(3.99);
    expect(p.unitPrice).toBe(0.031);
    expect(p.size).toBe("1 gallon");
    expect(p.storeId).toBe("3132");
    expect(p.storeName).toBe("Safeway #3132");
    expect(p.available).toBe(true);
    expect(p.localInStock).toBe(true);
    expect(p.fulfillmentType).toBe("store");
    expect(p.currency).toBe("USD");
    expect(p.lastUpdated).toBe("2026-08-31T10:00:00.000Z");
  });

  it("falls back to the session store and a name-derived id", () => {
    const p = normalizeSafewayItem({ ...item, itemId: null, url: null }, null);
    expect(p.storeId).toBe(SESSION_STORE_ID);
    expect(p.storeName).toBe("Safeway (your account's store)");
    expect(p.externalProductId).toBe("sw-lucerne-milk-whole-1-gallon");
  });

  it("treats a missing inStock flag as available", () => {
    const p = normalizeSafewayItem({ ...item, inStock: null, localInStock: null }, "3132");
    expect(p.available).toBe(true);
    expect(p.localInStock).toBeNull();
  });
});
