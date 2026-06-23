CREATE TYPE "UnitType" AS ENUM ('each', 'lb', 'oz', 'gallon', 'quart', 'pint', 'fl_oz', 'pack', 'case', 'count');
CREATE TYPE "ConfidenceLevel" AS ENUM ('confirmed', 'estimated', 'old', 'unknown');
CREATE TYPE "CouponType" AS ENUM ('dollar_off', 'percent_off', 'bogo', 'membership_discount', 'digital_coupon');
CREATE TYPE "CouponScope" AS ENUM ('item', 'store', 'grocery_list', 'order_total');

CREATE TABLE "users" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "email" TEXT NOT NULL UNIQUE,
  "name" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL
);

CREATE TABLE "stores" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "user_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "name" TEXT NOT NULL,
  "store_type" TEXT NOT NULL,
  "address" TEXT NOT NULL,
  "city" TEXT NOT NULL,
  "state" TEXT NOT NULL,
  "zip" TEXT NOT NULL,
  "latitude" DECIMAL(10,7),
  "longitude" DECIMAL(10,7),
  "phone" TEXT,
  "notes" TEXT,
  "membership_required" BOOLEAN NOT NULL DEFAULT false,
  "favorite" BOOLEAN NOT NULL DEFAULT false,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL
);

CREATE TABLE "grocery_items" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "user_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "name" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "quantity_needed" DECIMAL(12,4) NOT NULL,
  "unit_type" "UnitType" NOT NULL,
  "notes" TEXT,
  "preferred_brand" TEXT,
  "upc" TEXT,
  "commonly_used" BOOLEAN NOT NULL DEFAULT false,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL
);

CREATE TABLE "grocery_lists" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "user_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "name" TEXT NOT NULL,
  "notes" TEXT,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL
);

CREATE TABLE "grocery_list_items" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "grocery_list_id" TEXT NOT NULL REFERENCES "grocery_lists"("id") ON DELETE CASCADE,
  "grocery_item_id" TEXT NOT NULL REFERENCES "grocery_items"("id") ON DELETE RESTRICT,
  "quantity_needed" DECIMAL(12,4) NOT NULL,
  "unit_type" "UnitType" NOT NULL,
  "checked_off" BOOLEAN NOT NULL DEFAULT false,
  "notes" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "grocery_list_items_grocery_list_id_grocery_item_id_key" UNIQUE ("grocery_list_id", "grocery_item_id")
);

CREATE TABLE "price_entries" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "user_id" TEXT NOT NULL,
  "grocery_item_id" TEXT NOT NULL REFERENCES "grocery_items"("id") ON DELETE RESTRICT,
  "store_id" TEXT NOT NULL REFERENCES "stores"("id") ON DELETE RESTRICT,
  "price" DECIMAL(12,2) NOT NULL,
  "package_quantity" DECIMAL(12,4) NOT NULL,
  "package_unit" "UnitType" NOT NULL,
  "brand" TEXT,
  "sale_price" BOOLEAN NOT NULL DEFAULT false,
  "coupon_applied" BOOLEAN NOT NULL DEFAULT false,
  "coupon_details" TEXT,
  "tax_applicable" BOOLEAN NOT NULL DEFAULT false,
  "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMP(3),
  "notes" TEXT,
  "confidence" "ConfidenceLevel" NOT NULL DEFAULT 'confirmed',
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL
);

CREATE TABLE "coupons" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "user_id" TEXT NOT NULL,
  "store_id" TEXT REFERENCES "stores"("id") ON DELETE SET NULL,
  "grocery_item_id" TEXT REFERENCES "grocery_items"("id") ON DELETE SET NULL,
  "grocery_list_id" TEXT REFERENCES "grocery_lists"("id") ON DELETE SET NULL,
  "name" TEXT NOT NULL,
  "coupon_type" "CouponType" NOT NULL,
  "scope" "CouponScope" NOT NULL,
  "amount_off" DECIMAL(12,2),
  "percent_off" DECIMAL(5,2),
  "description" TEXT,
  "expires_at" TIMESTAMP(3),
  "allow_expired" BOOLEAN NOT NULL DEFAULT false,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "notes" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL
);

CREATE TABLE "coupon_applications" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "coupon_id" TEXT NOT NULL REFERENCES "coupons"("id") ON DELETE CASCADE,
  "price_entry_id" TEXT REFERENCES "price_entries"("id") ON DELETE SET NULL,
  "grocery_list_id" TEXT,
  "discount_amount" DECIMAL(12,2) NOT NULL,
  "applied_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "notes" TEXT
);

CREATE TABLE "user_settings" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "user_id" TEXT NOT NULL UNIQUE REFERENCES "users"("id") ON DELETE CASCADE,
  "home_address" TEXT,
  "home_city" TEXT,
  "home_state" TEXT,
  "home_zip" TEXT,
  "home_latitude" DECIMAL(10,7),
  "home_longitude" DECIMAL(10,7),
  "vehicle_mpg" DECIMAL(8,2) NOT NULL DEFAULT 22,
  "gas_price_per_gallon" DECIMAL(8,2) NOT NULL DEFAULT 0,
  "round_trip" BOOLEAN NOT NULL DEFAULT true,
  "cost_per_mile_override" DECIMAL(8,4),
  "stale_days" INTEGER NOT NULL DEFAULT 14,
  "very_stale_days" INTEGER NOT NULL DEFAULT 30,
  "google_maps_enabled" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL
);

CREATE TABLE "distance_cache" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "user_id" TEXT NOT NULL,
  "store_id" TEXT NOT NULL REFERENCES "stores"("id") ON DELETE CASCADE,
  "origin_hash" TEXT NOT NULL,
  "one_way_miles" DECIMAL(10,2) NOT NULL,
  "one_way_minutes" INTEGER,
  "source" TEXT NOT NULL DEFAULT 'manual',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "distance_cache_user_id_store_id_origin_hash_key" UNIQUE ("user_id", "store_id", "origin_hash")
);

CREATE TABLE "reference_options" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "kind" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "reference_options_kind_value_key" UNIQUE ("kind", "value")
);

CREATE INDEX "stores_user_id_idx" ON "stores"("user_id");
CREATE INDEX "grocery_items_user_id_idx" ON "grocery_items"("user_id");
CREATE INDEX "grocery_items_name_idx" ON "grocery_items"("name");
CREATE INDEX "grocery_lists_user_id_idx" ON "grocery_lists"("user_id");
CREATE INDEX "price_entries_grocery_item_id_idx" ON "price_entries"("grocery_item_id");
CREATE INDEX "price_entries_store_id_idx" ON "price_entries"("store_id");
CREATE INDEX "price_entries_recorded_at_idx" ON "price_entries"("recorded_at");
CREATE INDEX "coupons_user_id_idx" ON "coupons"("user_id");

