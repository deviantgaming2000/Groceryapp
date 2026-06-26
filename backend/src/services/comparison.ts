import { CouponScope, CouponType } from "@prisma/client";
import { drivingCost } from "./travel.js";
import { normalizeQuantity, packagesNeeded, unitPrice, UnitType, unitsCompatible } from "./units.js";

const COUNT_FAMILY = ["each", "count", "pack", "case"];

export type CompareInput = {
  list: {
    id: string;
    name: string;
    items: Array<{
      id: string;
      quantityNeeded: number;
      unitType: UnitType;
      groceryItem: { id: string; name: string; category: string; quantityNeeded?: number; unitType?: UnitType; eachEquivQuantity?: number | null; eachEquivUnit?: UnitType | null; minPurchaseQuantity?: number | null; minPurchaseUnit?: UnitType | null };
    }>;
  };
  stores: Array<{ id: string; name: string; membershipRequired?: boolean }>;
  priceEntries: Array<{
    id: string;
    groceryItemId: string;
    storeId: string;
    price: number;
    packageQuantity: number;
    packageUnit: UnitType;
    brand?: string | null;
    recordedAt: Date;
    expiresAt?: Date | null;
    confidence: string;
    salePrice?: boolean;
    couponApplied?: boolean;
  }>;
  coupons: Array<{
    id: string;
    storeId?: string | null;
    groceryItemId?: string | null;
    groceryListId?: string | null;
    name: string;
    couponType: CouponType;
    scope: CouponScope;
    amountOff?: number | null;
    percentOff?: number | null;
    buyQuantity?: number | null;
    freeQuantity?: number | null;
    limitPerTransaction?: number | null;
    expiresAt?: Date | null;
    allowExpired?: boolean;
    isActive: boolean;
  }>;
  distances: Array<{ storeId: string; oneWayMiles: number; oneWayMinutes?: number | null }>;
  settings: {
    vehicleMpg: number;
    gasPricePerGallon: number;
    roundTrip: boolean;
    costPerMileOverride?: number | null;
    staleDays: number;
    veryStaleDays: number;
  };
  now?: Date;
};

function daysOld(date: Date, now: Date) {
  return Math.floor((now.getTime() - date.getTime()) / 86_400_000);
}

function staleStatus(date: Date, settings: CompareInput["settings"], now: Date) {
  const age = daysOld(date, now);
  if (age >= settings.veryStaleDays) return "very_old_price";
  if (age >= settings.staleDays) return "old_price";
  return "current";
}

function couponExpired(coupon: CompareInput["coupons"][number], now: Date) {
  return Boolean(coupon.expiresAt && coupon.expiresAt < now && !coupon.allowExpired);
}

function endOfExpirationDay(date: Date) {
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);
  return end;
}

function priceExpired(entry: CompareInput["priceEntries"][number], now: Date) {
  return Boolean(entry.expiresAt && endOfExpirationDay(entry.expiresAt) < now);
}

function itemCouponDiscount(
  checkoutPrice: number,
  packageCount: number,
  itemId: string,
  storeId: string,
  coupons: CompareInput["coupons"],
  now: Date
) {
  const applicable = coupons.filter((coupon) => {
    if (!coupon.isActive || couponExpired(coupon, now)) return false;
    if (coupon.scope !== "item") return false;
    if (coupon.storeId && coupon.storeId !== storeId) return false;
    return coupon.groceryItemId === itemId;
  });
  if (!applicable.length) return { discount: 0, coupons: [], warnings: [] as string[] };

  const coupon = applicable[0];
  const warnings: string[] = applicable.length > 1 ? ["Multiple item coupons found; only one applied"] : [];
  let discount = 0;

  if (coupon.couponType === "dollar_off" && coupon.amountOff) {
    discount = coupon.amountOff;
  } else if (coupon.couponType === "percent_off" && coupon.percentOff) {
    discount = checkoutPrice * (coupon.percentOff / 100);
  } else if (coupon.couponType === "bogo") {
    // bogo = buy 1 get 1 free: every 2 packages, 1 is free
    const freeCount = Math.floor(packageCount / 2);
    const limitedFree = coupon.limitPerTransaction != null ? Math.min(freeCount, coupon.limitPerTransaction) : freeCount;
    discount = limitedFree * (checkoutPrice / packageCount);
    if (limitedFree > 0) warnings.push(`BOGO: ${limitedFree} package(s) free`);
  } else if (coupon.couponType === "buy_x_get_y_free") {
    const buyQty = coupon.buyQuantity ?? 1;
    const freeQty = coupon.freeQuantity ?? 1;
    const groupSize = buyQty + freeQty;
    let groups = Math.floor(packageCount / groupSize);
    if (coupon.limitPerTransaction != null) groups = Math.min(groups, coupon.limitPerTransaction);
    const freePackages = groups * freeQty;
    discount = freePackages * (checkoutPrice / packageCount);
    if (freePackages > 0) warnings.push(`Buy ${buyQty} get ${freeQty} free: ${freePackages} package(s) free`);
    else if (packageCount < groupSize) warnings.push(`Buy ${buyQty} get ${freeQty} free: need ${groupSize - packageCount} more package(s) to qualify`);
  } else if (coupon.couponType === "buy_x_save_z") {
    const buyQty = coupon.buyQuantity ?? 1;
    const savingsAmount = coupon.amountOff ?? 0;
    let groups = Math.floor(packageCount / buyQty);
    if (coupon.limitPerTransaction != null) groups = Math.min(groups, coupon.limitPerTransaction);
    discount = groups * savingsAmount;
    if (groups > 0) warnings.push(`Buy ${buyQty} save $${savingsAmount.toFixed(2)}: applied ${groups} time(s)`);
  } else if (coupon.couponType === "membership_discount" || coupon.couponType === "digital_coupon") {
    if (coupon.amountOff) discount = coupon.amountOff;
    else if (coupon.percentOff) discount = checkoutPrice * (coupon.percentOff / 100);
  }

  return {
    discount: Math.min(checkoutPrice, discount),
    coupons: [coupon.name],
    warnings
  };
}

function onePackagePerEach(quantity: number, packageQuantity: number, packageUnit: UnitType) {
  const packageCount = Math.ceil(quantity);
  const purchased = packageCount * packageQuantity;
  return {
    packageCount,
    purchasedQuantity: purchased,
    consumedQuantity: purchased,
    leftoverQuantity: 0,
    baseUnit: packageUnit
  };
}

export function compareGroceryList(input: CompareInput) {
  const now = input.now ?? new Date();
  const itemRows = input.list.items.map((listItem) => {
    const prices = input.stores.map((store) => {
      const candidates = input.priceEntries
        .filter((entry) => entry.storeId === store.id && entry.groceryItemId === listItem.groceryItem.id)
        .sort((a, b) => b.recordedAt.getTime() - a.recordedAt.getTime());
      const entry = candidates[0];
      if (!entry) {
        return { storeId: store.id, storeName: store.name, missing: true, warnings: ["Missing price data"] };
      }
      let neededQuantity = listItem.quantityNeeded;
      let neededUnit = listItem.unitType;
      const warnings: string[] = [];
      let usingPackageEach = false;

      // Effective package units — may be converted from per-each to weight/volume below.
      let pkgQuantity = entry.packageQuantity;
      let pkgUnit: UnitType = entry.packageUnit;

      // If the price is sold per-each/count but the item compares by weight/volume,
      // convert it using the item's "approx per each" equivalence (e.g. 1 apple ≈ 0.4 lb).
      const eachEq = listItem.groceryItem.eachEquivQuantity;
      const eachEqUnit = listItem.groceryItem.eachEquivUnit ?? undefined;
      if (eachEq && eachEqUnit && !unitsCompatible(pkgUnit, neededUnit)) {
        if (COUNT_FAMILY.includes(pkgUnit) && unitsCompatible(eachEqUnit, neededUnit)) {
          // Price is per-each/count, item compares by weight/volume → convert up.
          // (e.g. "1 each" apple × 0.4 lb/each = 0.4 lb)
          pkgQuantity = entry.packageQuantity * eachEq;
          warnings.push(`Estimated ${entry.packageQuantity} ${entry.packageUnit} ≈ ${pkgQuantity.toFixed(2)} ${eachEqUnit} (~${eachEq} ${eachEqUnit}/each)`);
          pkgUnit = eachEqUnit;
        } else if (COUNT_FAMILY.includes(neededUnit) && unitsCompatible(pkgUnit, eachEqUnit)) {
          // Price is per-weight/volume, item compares by each/count → convert down.
          // (e.g. a 3 lb price ÷ 0.4 lb/each ≈ 7.5 each)
          const pkgBase = normalizeQuantity(entry.packageQuantity, pkgUnit);
          const eachBase = normalizeQuantity(eachEq, eachEqUnit);
          const countEquiv = pkgBase.quantity / eachBase.quantity;
          if (countEquiv > 0) {
            warnings.push(`Estimated ${entry.packageQuantity} ${entry.packageUnit} ≈ ${countEquiv.toFixed(2)} ${neededUnit} (~${eachEq} ${eachEqUnit}/each)`);
            pkgQuantity = countEquiv;
            pkgUnit = neededUnit;
          }
        }
      }

      if (!unitsCompatible(neededUnit, pkgUnit)) {
        const itemDefaultUnit = listItem.groceryItem.unitType;
        const itemDefaultQuantity = listItem.groceryItem.quantityNeeded;
        if (itemDefaultUnit && itemDefaultUnit !== neededUnit && unitsCompatible(itemDefaultUnit, pkgUnit)) {
          neededUnit = itemDefaultUnit;
          neededQuantity = itemDefaultQuantity ?? neededQuantity;
          warnings.push(`List unit was ${listItem.unitType}; using item default ${neededQuantity} ${neededUnit} for comparison`);
        } else if (neededUnit === "each") {
          usingPackageEach = true;
          warnings.push(`List needs ${neededQuantity} each; treating each as one store package of ${pkgQuantity} ${pkgUnit}`);
        } else {
          return {
            storeId: store.id,
            storeName: store.name,
            missing: true,
            hasIgnoredPrice: true,
            warnings: [`Price exists but unit mismatch: list needs ${listItem.unitType}, price is ${entry.packageUnit}. Tip: set an "approx per each" weight on this item to compare them.`]
          };
        }
      }
      let pkg = usingPackageEach
        ? onePackagePerEach(neededQuantity, pkgQuantity, pkgUnit)
        : packagesNeeded(neededQuantity, neededUnit, pkgQuantity, pkgUnit)!;

      // Whole-cut minimum: items sold as one piece by weight (e.g. brisket ~6 lb)
      // can't be bought in slivers. Buy at least the minimum cut, so the total is
      // realistic (and the surplus shows as leftover).
      const minQty = listItem.groceryItem.minPurchaseQuantity;
      const minUnit = listItem.groceryItem.minPurchaseUnit ?? undefined;
      if (minQty && minUnit && unitsCompatible(minUnit, pkgUnit)) {
        const minBase = normalizeQuantity(minQty, minUnit);
        const soldBase = normalizeQuantity(pkgQuantity, pkgUnit);
        const minPackages = Math.max(1, Math.ceil(minBase.quantity / soldBase.quantity));
        if (pkg.packageCount < minPackages) {
          const purchased = minPackages * soldBase.quantity;
          pkg = {
            packageCount: minPackages,
            purchasedQuantity: purchased,
            consumedQuantity: pkg.consumedQuantity,
            leftoverQuantity: Math.max(0, purchased - pkg.consumedQuantity),
            baseUnit: pkg.baseUnit
          };
          warnings.push(`Sold as ~${minQty} ${minUnit} minimum — costing the whole cut.`);
        }
      }

      const checkoutPrice = entry.price * pkg.packageCount;
      const consumedRatio = pkg.consumedQuantity / pkg.purchasedQuantity;
      const consumedValue = checkoutPrice * consumedRatio;
      const unit = unitPrice(entry.price, pkgQuantity, pkgUnit);
      const coupon = itemCouponDiscount(checkoutPrice, pkg.packageCount, listItem.groceryItem.id, store.id, input.coupons, now);
      const finalCheckoutPrice = Math.max(0, checkoutPrice - coupon.discount);
      const stale = staleStatus(entry.recordedAt, input.settings, now);
      warnings.push(...coupon.warnings);
      if (stale !== "current") warnings.push(stale);
      if (priceExpired(entry, now)) warnings.push("Price expiration date has passed");
      if (pkg.leftoverQuantity > 0) warnings.push(`Bulk purchase leaves ${pkg.leftoverQuantity.toFixed(2)} ${pkg.baseUnit}`);
      if (entry.confidence !== "confirmed") warnings.push(`Price confidence: ${entry.confidence}`);
      return {
        storeId: store.id,
        storeName: store.name,
        missing: false,
        priceEntryId: entry.id,
        preCouponCheckoutPrice: checkoutPrice,
        finalCheckoutPrice,
        consumedValue,
        unitPrice: unit.value,
        unitPriceUnit: unit.unit,
        packageCount: pkg.packageCount,
        leftoverQuantity: pkg.leftoverQuantity,
        leftoverUnit: pkg.baseUnit,
        staleStatus: stale,
        couponDiscount: coupon.discount,
        couponsApplied: coupon.coupons,
        warnings
      };
    });
    const known = prices.filter((p: any) => !p.missing);
    const cheapest = known.length ? known.reduce((best: any, p: any) => p.finalCheckoutPrice < best.finalCheckoutPrice ? p : best, known[0]) : null;
    return {
      itemId: listItem.groceryItem.id,
      itemName: listItem.groceryItem.name,
      neededQuantity: listItem.quantityNeeded,
      neededUnit: listItem.unitType,
      prices,
      cheapestStoreId: cheapest?.storeId ?? null,
      cheapestStoreName: cheapest?.storeName ?? null
    };
  });

  const storeTotals = input.stores.map((store) => {
    const prices = itemRows.map((row) => row.prices.find((price: any) => price.storeId === store.id));
    const missingCount = prices.filter((price: any) => price?.missing).length;
    const oldPriceCount = prices.filter((price: any) => !price?.missing && price?.staleStatus !== "current").length;
    const groceryTotal = prices.reduce((sum: number, price: any) => sum + (price?.missing ? 0 : price.finalCheckoutPrice), 0);
    const distance = input.distances.find((row) => row.storeId === store.id);
    const travel = drivingCost(distance?.oneWayMiles, input.settings);
    const warnings = [];
    if (missingCount) warnings.push(`${missingCount} items missing prices`);
    if (oldPriceCount) warnings.push(`${oldPriceCount} stale prices`);
    if ((store as any).membershipRequired) warnings.push("Membership required");
    if (travel.warning) warnings.push(travel.warning);
    return {
      storeId: store.id,
      storeName: store.name,
      complete: missingCount === 0,
      groceryTotal,
      missingCount,
      oldPriceCount,
      oneWayMiles: distance?.oneWayMiles ?? null,
      oneWayMinutes: distance?.oneWayMinutes ?? null,
      drivingCost: travel.drivingCost,
      adjustedTotal: groceryTotal + travel.drivingCost,
      warnings
    };
  });

  const completeStores = storeTotals.filter((store) => store.complete);
  const bestSingleStore = completeStores.length ? completeStores.reduce((best, store) => store.groceryTotal < best.groceryTotal ? store : best, completeStores[0]) : null;
  const bestAdjustedStore = completeStores.length ? completeStores.reduce((best, store) => store.adjustedTotal < best.adjustedTotal ? store : best, completeStores[0]) : null;
  const mixedItems = itemRows.map((row) => row.prices.filter((price: any) => !price.missing).sort((a: any, b: any) => a.finalCheckoutPrice - b.finalCheckoutPrice)[0] ?? null);
  const mixedComplete = mixedItems.every(Boolean);
  const mixedCheckoutTotal = mixedItems.reduce((sum: number, price: any) => sum + (price?.finalCheckoutPrice ?? 0), 0);
  const warnings = [
    ...storeTotals.flatMap((store) => store.warnings.map((warning) => `${store.storeName}: ${warning}`)),
    ...(mixedComplete ? [] : ["Mixed-store strategy is incomplete because some items have no prices"])
  ];

  return {
    groceryListId: input.list.id,
    groceryListName: input.list.name,
    itemRows,
    storeTotals,
    bestSingleStore,
    bestAdjustedStore,
    mixedStoreStrategy: {
      complete: mixedComplete,
      checkoutTotal: mixedCheckoutTotal,
      items: mixedItems
    },
    warnings
  };
}
