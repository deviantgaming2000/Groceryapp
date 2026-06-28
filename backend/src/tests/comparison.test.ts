import { describe, expect, it } from "vitest";
import { compareGroceryList } from "../services/comparison.js";
import { drivingCost } from "../services/travel.js";
import { packagesNeeded, unitPrice } from "../services/units.js";

const now = new Date("2026-05-24T12:00:00Z");
const stores = [
  { id: "walmart", name: "Walmart" },
  { id: "costco", name: "Costco", membershipRequired: true }
];
const list = {
  id: "weekly",
  name: "Weekly",
  items: [
    { id: "li1", quantityNeeded: 1, unitType: "lb" as const, groceryItem: { id: "beef", name: "Ground beef", category: "Meat" } },
    { id: "li2", quantityNeeded: 12, unitType: "count" as const, groceryItem: { id: "eggs", name: "Eggs", category: "Dairy" } }
  ]
};

describe("unit and travel calculations", () => {
  it("calculates unit price", () => {
    expect(unitPrice(4.99, 16, "oz").value).toBeCloseTo(0.3118);
  });

  it("calculates bulk leftovers", () => {
    const result = packagesNeeded(1, "lb", 5, "lb");
    expect(result?.leftoverQuantity).toBe(64);
  });

  it("calculates driving cost", () => {
    expect(drivingCost(9, { vehicleMpg: 22, gasPricePerGallon: 3.85, roundTrip: true }).drivingCost).toBeCloseTo(3.15);
  });
});

describe("comparison engine", () => {
  it("does not mark incomplete store as cheapest", () => {
    const result = compareGroceryList({
      list,
      stores,
      priceEntries: [
        { id: "p1", groceryItemId: "beef", storeId: "walmart", price: 5, packageQuantity: 1, packageUnit: "lb", recordedAt: now, confidence: "confirmed" },
        { id: "p2", groceryItemId: "eggs", storeId: "walmart", price: 4, packageQuantity: 12, packageUnit: "count", recordedAt: now, confidence: "confirmed" },
        { id: "p3", groceryItemId: "beef", storeId: "costco", price: 15, packageQuantity: 5, packageUnit: "lb", recordedAt: now, confidence: "confirmed" }
      ],
      coupons: [],
      distances: [],
      settings: { vehicleMpg: 22, gasPricePerGallon: 0, roundTrip: true, staleDays: 14, veryStaleDays: 30 },
      now
    });
    expect(result.bestSingleStore?.storeName).toBe("Walmart");
    expect(result.storeTotals.find((s) => s.storeName === "Costco")?.complete).toBe(false);
  });

  it("applies item coupon and stale warning", () => {
    const old = new Date("2026-04-20T12:00:00Z");
    const result = compareGroceryList({
      list,
      stores: [stores[0]],
      priceEntries: [
        { id: "p1", groceryItemId: "beef", storeId: "walmart", price: 5, packageQuantity: 1, packageUnit: "lb", recordedAt: old, confidence: "estimated" },
        { id: "p2", groceryItemId: "eggs", storeId: "walmart", price: 4, packageQuantity: 12, packageUnit: "count", recordedAt: now, confidence: "confirmed" }
      ],
      coupons: [{ id: "c1", groceryItemId: "eggs", storeId: "walmart", groceryListId: null, name: "Egg coupon", couponType: "dollar_off", scope: "item", amountOff: 1, percentOff: null, expiresAt: null, allowExpired: false, isActive: true }],
      distances: [{ storeId: "walmart", oneWayMiles: 9, oneWayMinutes: 15 }],
      settings: { vehicleMpg: 22, gasPricePerGallon: 3.85, roundTrip: true, staleDays: 14, veryStaleDays: 30 },
      now
    });
    expect(result.itemRows[1].prices[0].finalCheckoutPrice).toBe(3);
    expect(result.storeTotals[0].oldPriceCount).toBe(1);
    expect(result.storeTotals[0].adjustedTotal).toBeCloseTo(11.15);
  });

  it("adds the gas/driving-adjusted total on top of the grocery total", () => {
    // round_trip_miles = 10 * 2 = 20; gallons_used = 20 / 25 = 0.8;
    // driving_cost = 0.8 * 4 = 3.20; adjusted_total = 9 + 3.20 = 12.20
    const result = compareGroceryList({
      list,
      stores: [stores[0]],
      priceEntries: [
        { id: "p1", groceryItemId: "beef", storeId: "walmart", price: 5, packageQuantity: 1, packageUnit: "lb", recordedAt: now, confidence: "confirmed" },
        { id: "p2", groceryItemId: "eggs", storeId: "walmart", price: 4, packageQuantity: 12, packageUnit: "count", recordedAt: now, confidence: "confirmed" }
      ],
      coupons: [],
      distances: [{ storeId: "walmart", oneWayMiles: 10, oneWayMinutes: 18 }],
      settings: { vehicleMpg: 25, gasPricePerGallon: 4, roundTrip: true, staleDays: 14, veryStaleDays: 30 },
      now
    });
    const walmart = result.storeTotals[0];
    expect(walmart.groceryTotal).toBeCloseTo(9);
    expect(walmart.drivingCost).toBeCloseTo(3.2);
    expect(walmart.adjustedTotal).toBeCloseTo(12.2);
    expect(result.bestAdjustedStore?.adjustedTotal).toBeCloseTo(12.2);
  });

  it("treats each as one store package when package units differ", () => {
    const result = compareGroceryList({
      list: {
        id: "cookout",
        name: "Cookout",
        items: [
          { id: "li1", quantityNeeded: 1, unitType: "each" as const, groceryItem: { id: "pickles", name: "Dill pickles", category: "Pantry", unitType: "each" as const } }
        ]
      },
      stores: [stores[0]],
      priceEntries: [
        { id: "p1", groceryItemId: "pickles", storeId: "walmart", price: 2.67, packageQuantity: 24, packageUnit: "oz", recordedAt: now, confidence: "confirmed" }
      ],
      coupons: [],
      distances: [],
      settings: { vehicleMpg: 22, gasPricePerGallon: 0, roundTrip: true, staleDays: 14, veryStaleDays: 30 },
      now
    });
    expect(result.itemRows[0].prices[0].missing).toBe(false);
    expect(result.itemRows[0].prices[0].finalCheckoutPrice).toBe(2.67);
    expect(result.itemRows[0].prices[0].unitPriceUnit).toBe("oz");
  });
});
