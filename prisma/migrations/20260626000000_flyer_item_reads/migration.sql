-- Cache of vision-OCR reads of flyer images, kept until the sale's valid_to.
CREATE TABLE "flyer_item_reads" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "cache_key" TEXT NOT NULL,
  "price" DECIMAL(12,2),
  "deal_text" TEXT,
  "valid_to" TIMESTAMP(3),
  "read_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "flyer_item_reads_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "flyer_item_reads_user_id_cache_key_key" ON "flyer_item_reads"("user_id", "cache_key");
CREATE INDEX "flyer_item_reads_user_id_idx" ON "flyer_item_reads"("user_id");
