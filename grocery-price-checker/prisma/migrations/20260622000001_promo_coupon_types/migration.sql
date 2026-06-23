-- Add new promotional coupon types to the enum
ALTER TYPE "CouponType" ADD VALUE 'buy_x_get_y_free';
ALTER TYPE "CouponType" ADD VALUE 'buy_x_save_z';

-- Add promo deal fields to coupons table
ALTER TABLE "coupons" ADD COLUMN "buy_quantity" INTEGER;
ALTER TABLE "coupons" ADD COLUMN "free_quantity" INTEGER;
ALTER TABLE "coupons" ADD COLUMN "limit_per_transaction" INTEGER;
