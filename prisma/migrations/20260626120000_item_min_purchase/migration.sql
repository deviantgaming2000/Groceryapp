-- Minimum purchase size for items sold as whole pieces by weight (e.g. brisket ~6 lb),
-- so comparisons cost the whole cut instead of a per-pound sliver.
ALTER TABLE "grocery_items" ADD COLUMN "min_purchase_quantity" DECIMAL(12,4);
ALTER TABLE "grocery_items" ADD COLUMN "min_purchase_unit" "UnitType";
