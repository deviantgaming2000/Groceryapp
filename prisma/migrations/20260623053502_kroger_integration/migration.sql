-- AlterTable
ALTER TABLE "grocery_items" ADD COLUMN     "external_product_id" TEXT,
ADD COLUMN     "image_url" TEXT,
ADD COLUMN     "product_url" TEXT,
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'manual';

-- AlterTable
ALTER TABLE "price_entries" ADD COLUMN     "available" BOOLEAN,
ADD COLUMN     "coupon_data" JSONB,
ADD COLUMN     "coupon_eligible" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "external_product_id" TEXT,
ADD COLUMN     "image_url" TEXT,
ADD COLUMN     "last_synced_at" TIMESTAMP(3),
ADD COLUMN     "product_url" TEXT,
ADD COLUMN     "promo_price" DECIMAL(12,2),
ADD COLUMN     "raw_api_data" JSONB,
ADD COLUMN     "regular_price" DECIMAL(12,2),
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'manual';

-- AlterTable
ALTER TABLE "stores" ADD COLUMN     "external_id" TEXT,
ADD COLUMN     "provider" TEXT NOT NULL DEFAULT 'manual';

-- AlterTable
ALTER TABLE "user_settings" ADD COLUMN     "kroger_location_id" TEXT,
ADD COLUMN     "kroger_location_name" TEXT;
