-- DropForeignKey
ALTER TABLE "coupon_applications" DROP CONSTRAINT "coupon_applications_coupon_id_fkey";

-- DropForeignKey
ALTER TABLE "coupon_applications" DROP CONSTRAINT "coupon_applications_price_entry_id_fkey";

-- DropForeignKey
ALTER TABLE "coupons" DROP CONSTRAINT "coupons_grocery_item_id_fkey";

-- DropForeignKey
ALTER TABLE "coupons" DROP CONSTRAINT "coupons_grocery_list_id_fkey";

-- DropForeignKey
ALTER TABLE "coupons" DROP CONSTRAINT "coupons_store_id_fkey";

-- DropForeignKey
ALTER TABLE "distance_cache" DROP CONSTRAINT "distance_cache_store_id_fkey";

-- DropForeignKey
ALTER TABLE "grocery_items" DROP CONSTRAINT "grocery_items_user_id_fkey";

-- DropForeignKey
ALTER TABLE "grocery_list_items" DROP CONSTRAINT "grocery_list_items_grocery_item_id_fkey";

-- DropForeignKey
ALTER TABLE "grocery_list_items" DROP CONSTRAINT "grocery_list_items_grocery_list_id_fkey";

-- DropForeignKey
ALTER TABLE "grocery_lists" DROP CONSTRAINT "grocery_lists_user_id_fkey";

-- DropForeignKey
ALTER TABLE "price_entries" DROP CONSTRAINT "price_entries_grocery_item_id_fkey";

-- DropForeignKey
ALTER TABLE "price_entries" DROP CONSTRAINT "price_entries_store_id_fkey";

-- DropForeignKey
ALTER TABLE "stores" DROP CONSTRAINT "stores_user_id_fkey";

-- DropForeignKey
ALTER TABLE "user_settings" DROP CONSTRAINT "user_settings_user_id_fkey";

-- AddForeignKey
ALTER TABLE "stores" ADD CONSTRAINT "stores_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grocery_items" ADD CONSTRAINT "grocery_items_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grocery_lists" ADD CONSTRAINT "grocery_lists_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grocery_list_items" ADD CONSTRAINT "grocery_list_items_grocery_list_id_fkey" FOREIGN KEY ("grocery_list_id") REFERENCES "grocery_lists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grocery_list_items" ADD CONSTRAINT "grocery_list_items_grocery_item_id_fkey" FOREIGN KEY ("grocery_item_id") REFERENCES "grocery_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_entries" ADD CONSTRAINT "price_entries_grocery_item_id_fkey" FOREIGN KEY ("grocery_item_id") REFERENCES "grocery_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_entries" ADD CONSTRAINT "price_entries_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_grocery_item_id_fkey" FOREIGN KEY ("grocery_item_id") REFERENCES "grocery_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_grocery_list_id_fkey" FOREIGN KEY ("grocery_list_id") REFERENCES "grocery_lists"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupon_applications" ADD CONSTRAINT "coupon_applications_coupon_id_fkey" FOREIGN KEY ("coupon_id") REFERENCES "coupons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupon_applications" ADD CONSTRAINT "coupon_applications_price_entry_id_fkey" FOREIGN KEY ("price_entry_id") REFERENCES "price_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "distance_cache" ADD CONSTRAINT "distance_cache_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;
