import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeSafewayItem, safewayProvider, SESSION_STORE_ID } from "../services/providers/safeway.js";

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

describe("safewayProvider transport", () => {
  beforeEach(() => {
    vi.stubEnv("SAFEWAY_SCRAPER_URL", "http://scraper.test");
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  const ok = (body: unknown) =>
    Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }));

  it("searches, caches for the day, and resolves getProduct from the search", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
      if (String(url).endsWith("/health")) return ok({ ok: true });
      return ok({
        storeId: "3132",
        results: [{ name: "Milk", price: 3.99, itemId: "960109496", inStock: true }]
      });
    });

    const first = await safewayProvider.searchProducts({ term: "milk" });
    expect(first[0].externalProductId).toBe("960109496");
    expect(first[0].storeId).toBe("3132");

    const again = await safewayProvider.searchProducts({ term: "milk" });
    expect(again).toHaveLength(1);
    // One search call total: the second came from the cache.
    const searchCalls = (fetch as ReturnType<typeof vi.fn>).mock.calls.filter((c) => String(c[0]).includes("/search"));
    expect(searchCalls).toHaveLength(1);

    const product = await safewayProvider.getProduct("960109496");
    expect(product?.title).toBe("Milk");
  });

  it("maps blocked-scraper errors to rate_limited so the bulk job degrades it", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ error: "Imperva blocked it" }), { status: 502 }))
    );
    await expect(safewayProvider.searchProducts({ term: "eggs" })).rejects.toMatchObject({ code: "rate_limited" });
  });

  it("exposes exactly the session store location", async () => {
    const locations = await safewayProvider.searchLocations({});
    expect(locations).toEqual([expect.objectContaining({ externalId: "safeway-session", chain: "Safeway" })]);
    expect(safewayProvider.defaultLocationId?.()).toBe("safeway-session");
  });
});
