import { prisma } from "../../lib/prisma.js";
import { DealsProvider, DealsSearchParams, NormalizedDeal } from "./types.js";

// Surfaces the user's own coupons/deals (the existing Coupon model) in normalized deal
// form — no new data, just a read-only view of what's already in the app.
function describe(c: any): string {
  if (c.couponType === "bogo") return "Buy 1, get 1 free";
  if (c.couponType === "buy_x_get_y_free") return `Buy ${c.buyQuantity ?? "?"} get ${c.freeQuantity ?? "?"} free`;
  if (c.couponType === "buy_x_save_z") return `Buy ${c.buyQuantity ?? "?"}, save $${Number(c.amountOff ?? 0).toFixed(2)}`;
  if (c.amountOff) return `$${Number(c.amountOff).toFixed(2)} off`;
  if (c.percentOff) return `${c.percentOff}% off`;
  return c.couponType;
}

export const manualDealsProvider: DealsProvider = {
  id: "manual",
  label: "My coupons & deals",
  needsConfig: false,

  async isConfigured() {
    return true;
  },

  async searchDeals(params: DealsSearchParams) {
    if (!params.userId) return [];
    const q = params.query?.trim().toLowerCase();
    const coupons = await prisma.coupon.findMany({
      where: { userId: params.userId, isActive: true },
      include: { store: true, groceryItem: true },
      orderBy: { createdAt: "desc" }
    });
    return coupons
      .filter((c) => !q || `${c.name} ${c.groceryItem?.name ?? ""} ${c.store?.name ?? ""}`.toLowerCase().includes(q))
      .map(
        (c): NormalizedDeal => ({
          source: "manual",
          storeName: c.store?.name,
          productName: c.groceryItem?.name || c.name,
          salePrice: null,
          regularPrice: null,
          discountAmount: c.amountOff != null ? Number(c.amountOff) : null,
          couponRequired: true,
          digitalCoupon: c.couponType === "digital_coupon",
          loyaltyRequired: c.couponType === "membership_discount",
          description: `${c.name} — ${describe(c)}`,
          validFrom: null,
          validTo: c.expiresAt ? c.expiresAt.toISOString() : null,
          category: c.scope,
          confidence: 1,
          raw: c
        })
      );
  },

  getCoupons(params: DealsSearchParams) {
    return this.searchDeals(params);
  }
};
