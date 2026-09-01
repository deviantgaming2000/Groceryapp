import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/prisma.js", () => ({
  getDefaultUserId: vi.fn(async () => "user-1"),
  prisma: {
    priceEntry: { findMany: vi.fn(async () => []), update: vi.fn(async () => ({})) }
  }
}));

import { prisma } from "../lib/prisma.js";
import { startRefreshRun, latestRun, currentRun } from "../services/refresh.js";
import type { GroceryProvider, NormalizedProduct } from "../services/providers/index.js";

function fakeProduct(over: Partial<NormalizedProduct> = {}): NormalizedProduct {
  return {
    source: "fakeprov",
    externalProductId: "ext-1",
    title: "Whole Milk",
    price: 3.49,
    regularPrice: 3.49,
    promoPrice: null,
    unitPrice: null,
    currency: "USD",
    available: true,
    couponEligible: false,
    couponData: null,
    lastUpdated: new Date().toISOString(),
    ...over
  };
}

function fakeProvider(results: NormalizedProduct[]): GroceryProvider {
  return {
    id: "fakeprov",
    label: "Fake",
    hasStores: true,
    isConfigured: async () => true,
    searchLocations: async () => [],
    getLocation: async (id: string) => ({ source: "fakeprov", externalId: id, name: "Fake Store" }),
    searchProducts: async () => results,
    getProduct: async () => null
  };
}

/** One linked price entry as the engine's findMany returns it (include: store, groceryItem). */
function linkedEntry(over: Record<string, unknown> = {}) {
  return {
    id: "pe-1",
    userId: "user-1",
    groceryItemId: "gi-1",
    storeId: "st-local",
    price: 2.0,
    source: "fakeprov",
    externalProductId: "ext-1",
    recordedAt: new Date(Date.now() - 48 * 3600 * 1000),
    store: { id: "st-local", externalId: "st-1" },
    groceryItem: { id: "gi-1", name: "Whole Milk" },
    ...over
  };
}

async function runToCompletion(deps: Parameters<typeof startRefreshRun>[1], staleHours?: number) {
  startRefreshRun({ trigger: "manual", staleHours }, deps);
  for (let i = 0; i < 200 && currentRun(); i++) await new Promise((r) => setTimeout(r, 10));
  return latestRun()!;
}

describe("refresh engine", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (prisma.priceEntry.findMany as any).mockResolvedValue([]);
  });

  it("upserts a price on an exact external-id match and marks the row ok", async () => {
    (prisma.priceEntry.findMany as any).mockResolvedValue([linkedEntry()]);
    const provider = fakeProvider([fakeProduct({ price: 3.49 })]);
    const upsert = vi.fn(async () => ({} as any));
    const run = await runToCompletion({ getProviderById: () => provider, sleep: async () => {}, upsert });

    expect(run.status).toBe("done");
    expect(run.providers[0].refreshed).toBe(1);
    expect(upsert).toHaveBeenCalledWith("user-1", "gi-1", "st-local", expect.objectContaining({ externalProductId: "ext-1", price: 3.49 }), "pe-1");
    expect(prisma.priceEntry.update).toHaveBeenCalledWith({ where: { id: "pe-1" }, data: { lastRefreshStatus: "ok" } });
  });

  it("marks the row not_found instead of guessing when the id is absent", async () => {
    (prisma.priceEntry.findMany as any).mockResolvedValue([linkedEntry({ externalProductId: "ext-GONE" })]);
    // A lookalike with the right name but a different id must NOT be written.
    const provider = fakeProvider([fakeProduct({ externalProductId: "ext-1", price: 9.99 })]);
    const upsert = vi.fn(async () => ({} as any));
    const run = await runToCompletion({ getProviderById: () => provider, sleep: async () => {}, upsert });

    expect(run.providers[0].unverified).toBe(1);
    expect(upsert).not.toHaveBeenCalled();
    expect(prisma.priceEntry.update).toHaveBeenCalledWith({ where: { id: "pe-1" }, data: { lastRefreshStatus: "not_found" } });
  });

  it("degrades a provider after repeated failures and joins an in-flight run", async () => {
    (prisma.priceEntry.findMany as any).mockResolvedValue(
      Array.from({ length: 7 }, (_, i) => linkedEntry({ id: `pe-${i}`, groceryItem: { id: "gi-1", name: `Item ${i}` } }))
    );
    const failing: GroceryProvider = {
      ...fakeProvider([]),
      searchProducts: async () => { throw new Error("boom"); }
    };
    const upsert = vi.fn(async () => ({} as any));
    const first = startRefreshRun({ trigger: "manual" }, { getProviderById: () => failing, sleep: async () => {}, upsert });
    const second = startRefreshRun({ trigger: "manual" }, { getProviderById: () => failing, sleep: async () => {}, upsert });
    expect(second.id).toBe(first.id); // joined, not doubled
    for (let i = 0; i < 200 && currentRun(); i++) await new Promise((r) => setTimeout(r, 10));
    const run = latestRun()!;
    expect(run.status).toBe("done");
    expect(run.providers[0].failed).toBe(5); // FAIL_STREAK_LIMIT failures before degradation
    expect(run.providers[0].skipped).toBe(2); // the rest skipped as degraded
    expect(upsert).not.toHaveBeenCalled();
  });

  it("passes the staleHours cutoff into the findMany filter", async () => {
    const provider = fakeProvider([fakeProduct()]);
    await runToCompletion({ getProviderById: () => provider, sleep: async () => {} }, 24);
    const args = (prisma.priceEntry.findMany as any).mock.calls[0][0];
    expect(args.where.recordedAt.lt).toBeInstanceOf(Date);
    // No staleHours: no recordedAt filter at all.
    await runToCompletion({ getProviderById: () => provider, sleep: async () => {} });
    const args2 = (prisma.priceEntry.findMany as any).mock.calls[1][0];
    expect(args2.where.recordedAt).toBeUndefined();
  });
});
