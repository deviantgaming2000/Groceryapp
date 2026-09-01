import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/prisma.js", () => {
  const coupons: any[] = [];
  let seq = 0;
  return {
    getDefaultUserId: vi.fn(async () => "user-1"),
    prisma: {
      __coupons: coupons,
      coupon: {
        findFirst: vi.fn(async ({ where }: any) =>
          coupons.find((c) => c.userId === where.userId && c.source === where.source && c.externalId === where.externalId) ?? null),
        create: vi.fn(async ({ data }: any) => {
          const row = { id: `c-${++seq}`, isActive: true, ...data };
          coupons.push(row);
          return row;
        }),
        update: vi.fn(async ({ where, data }: any) => {
          const row = coupons.find((c) => c.id === where.id);
          Object.assign(row, data);
          return row;
        }),
        updateMany: vi.fn(async ({ where, data }: any) => {
          const hits = coupons.filter(
            (c) => c.userId === where.userId && c.source === where.source &&
              c.isActive === where.isActive && c.expiresAt && c.expiresAt < where.expiresAt.lt
          );
          hits.forEach((c) => Object.assign(c, data));
          return { count: hits.length };
        })
      },
      store: { findMany: vi.fn(async () => []), findFirst: vi.fn(async () => null) },
      groceryItem: { findMany: vi.fn(async () => []) }
    }
  };
});

import { prisma } from "../lib/prisma.js";
import { dealCouponFields, dealExternalId, ingestDealsAsCoupons } from "../services/coupon-ingest.js";
import type { NormalizedDeal } from "../services/deals/types.js";

const couponStore = (prisma as any).__coupons as any[];

function deal(over: Partial<NormalizedDeal> = {}): NormalizedDeal {
  return {
    source: "flipp",
    storeName: "Safeway",
    productName: "Cheerios 12oz",
    salePrice: 2.99,
    regularPrice: 4.49,
    discountAmount: 1.5,
    couponRequired: false,
    digitalCoupon: false,
    loyaltyRequired: false,
    validTo: "2026-09-06",
    confidence: 0.9,
    raw: { id: "flyeritem-1" },
    ...over
  };
}

describe("dealCouponFields", () => {
  it("derives dollar_off from sale vs regular", () => {
    const f = dealCouponFields(deal())!;
    expect(f.couponType).toBe("dollar_off");
    expect(f.amountOff).toBe(1.5);
    expect(f.expiresAt).toEqual(new Date("2026-09-06"));
  });
  it("derives bogo from deal text", () => {
    const f = dealCouponFields(deal({ salePrice: null, regularPrice: null, discountAmount: null, dealText: "BUY 1 GET 1 FREE" }))!;
    expect(f.couponType).toBe("bogo");
  });
  it("derives digital_coupon and percent_off", () => {
    expect(dealCouponFields(deal({ digitalCoupon: true }))!.couponType).toBe("digital_coupon");
    const pct = dealCouponFields(deal({ salePrice: null, regularPrice: null, discountAmount: null, dealText: "Save 20%" }))!;
    expect(pct.couponType).toBe("percent_off");
    expect(pct.percentOff).toBe(20);
  });
  it("returns null when nothing is derivable", () => {
    expect(dealCouponFields(deal({ salePrice: null, regularPrice: null, discountAmount: null, dealText: undefined }))).toBeNull();
  });
});

describe("ingestDealsAsCoupons", () => {
  beforeEach(() => {
    couponStore.length = 0;
    vi.clearAllMocks();
  });

  it("creates, then updates on re-run, never duplicates, and skips manual rows", async () => {
    couponStore.push({
      id: "manual-1", userId: "user-1", source: "manual", externalId: null,
      name: "My own coupon", couponType: "dollar_off", scope: "store", amountOff: 1, isActive: true, expiresAt: null
    });

    const opts = { source: "flipp", deals: [deal()], storeIdFor: () => "st-1", itemIdFor: () => null };
    const first = await ingestDealsAsCoupons(opts);
    expect(first.created).toBe(1);

    const second = await ingestDealsAsCoupons(opts);
    expect(second.created).toBe(0);
    expect(second.updated).toBe(1);
    expect(couponStore.filter((c) => c.source === "flipp")).toHaveLength(1);

    const untouched = couponStore.find((c) => c.id === "manual-1");
    expect(untouched!.name).toBe("My own coupon");
    expect(untouched!.isActive).toBe(true);
  });

  it("creates an already-expired deal as inactive, never active-then-stale", async () => {
    await ingestDealsAsCoupons({
      source: "flipp",
      deals: [deal({ validTo: "2020-01-01", raw: { id: "old-1" } })],
      storeIdFor: () => "st-1",
      itemIdFor: () => null
    });
    const row = couponStore.find((c) => c.externalId === "old-1");
    expect(row!.isActive).toBe(false);
  });

  it("deactivates its own leftover coupons whose window passed, and never manual ones", async () => {
    // A coupon ingested while valid, whose flyer window has since ended:
    couponStore.push({
      id: "c-old", userId: "user-1", source: "flipp", externalId: "left-1",
      name: "Old deal", couponType: "dollar_off", scope: "store", isActive: true, expiresAt: new Date("2020-01-08")
    });
    couponStore.push({
      id: "manual-2", userId: "user-1", source: "manual", externalId: null,
      name: "Mine", couponType: "dollar_off", scope: "store", isActive: true, expiresAt: new Date("2020-01-08")
    });
    const summary = await ingestDealsAsCoupons({ source: "flipp", deals: [], storeIdFor: () => null, itemIdFor: () => null });
    expect(summary.deactivated).toBe(1);
    expect(couponStore.find((c) => c.id === "c-old")!.isActive).toBe(false);
    expect(couponStore.find((c) => c.id === "manual-2")!.isActive).toBe(true);
  });
});
