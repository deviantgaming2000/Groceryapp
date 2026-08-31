export type UnitType = "each" | "lb" | "oz" | "gallon" | "quart" | "pint" | "fl_oz" | "pack" | "case" | "count";

const toBase: Record<UnitType, { unit: UnitType; factor: number }> = {
  // "each" and "count" are the same idea - one discrete thing - so they share
  // a base unit. Keeping them apart made a "4 count" need unsatisfiable by an
  // "each" price, which surfaced as a phantom "missing price data".
  each: { unit: "count", factor: 1 },
  count: { unit: "count", factor: 1 },
  pack: { unit: "count", factor: 1 },
  case: { unit: "count", factor: 1 },
  lb: { unit: "oz", factor: 16 },
  oz: { unit: "oz", factor: 1 },
  gallon: { unit: "fl_oz", factor: 128 },
  quart: { unit: "fl_oz", factor: 32 },
  pint: { unit: "fl_oz", factor: 16 },
  fl_oz: { unit: "fl_oz", factor: 1 }
};

export function normalizeQuantity(quantity: number, unit: UnitType) {
  const config = toBase[unit];
  return { quantity: quantity * config.factor, unit: config.unit };
}

export function unitsCompatible(a: UnitType, b: UnitType) {
  return normalizeQuantity(1, a).unit === normalizeQuantity(1, b).unit;
}

export function unitPrice(price: number, quantity: number, unit: UnitType) {
  if (price < 0) throw new Error("Price cannot be negative");
  if (quantity <= 0) throw new Error("Quantity must be greater than zero");
  const normalized = normalizeQuantity(quantity, unit);
  return {
    value: price / normalized.quantity,
    unit: normalized.unit
  };
}

export function packagesNeeded(neededQuantity: number, neededUnit: UnitType, packageQuantity: number, packageUnit: UnitType) {
  if (!unitsCompatible(neededUnit, packageUnit)) return null;
  const needed = normalizeQuantity(neededQuantity, neededUnit);
  const sold = normalizeQuantity(packageQuantity, packageUnit);
  const count = Math.ceil(needed.quantity / sold.quantity);
  const purchased = count * sold.quantity;
  return {
    packageCount: count,
    purchasedQuantity: purchased,
    consumedQuantity: needed.quantity,
    leftoverQuantity: Math.max(0, purchased - needed.quantity),
    baseUnit: needed.unit
  };
}

