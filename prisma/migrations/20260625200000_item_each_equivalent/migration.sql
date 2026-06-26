-- Optional per-each weight/volume equivalence on grocery items, so per-each prices
-- can be compared against weight/volume prices (e.g. 1 apple ≈ 0.4 lb).
ALTER TABLE "grocery_items" ADD COLUMN "each_equiv_quantity" DECIMAL(12,4);
ALTER TABLE "grocery_items" ADD COLUMN "each_equiv_unit" "UnitType";
