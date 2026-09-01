-- AlterTable
ALTER TABLE "coupons" ADD COLUMN     "external_id" TEXT,
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'manual';

-- AlterTable
ALTER TABLE "price_entries" ADD COLUMN     "last_refresh_status" TEXT;

-- AlterTable
ALTER TABLE "user_settings" ADD COLUMN     "auto_refresh_enabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "auto_refresh_hour" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN     "stale_after_hours" INTEGER NOT NULL DEFAULT 24;

-- CreateIndex
CREATE INDEX "coupons_user_id_source_external_id_idx" ON "coupons"("user_id", "source", "external_id");
