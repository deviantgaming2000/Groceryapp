from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field


ScrapeStatus = Literal[
    "ok",
    "store_unavailable",
    "scraper_blocked",
    "location_required",
    "api_credentials_missing",
    "no_live_data_available",
    "manual_review_required",
    "error",
]

SourceType = Literal["api", "scrape", "manual"]


class ProductResult(BaseModel):
    query: str
    store: str
    store_slug: str
    product_name: str
    brand: str | None = None
    price: Decimal | None = None
    sale_price: Decimal | None = None
    currency: str = "USD"
    size_text: str | None = None
    size_value: float | None = None
    size_unit: str | None = None
    store_unit_price: Decimal | None = None
    calculated_unit_price: Decimal | None = None
    unit_price_unit: str | None = None
    in_stock: bool | None = None
    pickup_available: bool | None = None
    delivery_available: bool | None = None
    product_url: str | None = None
    image_url: str | None = None
    zip_code: str
    checked_at: datetime
    confidence_score: float | None = None
    scrape_status: ScrapeStatus = "ok"
    error_message: str | None = None
    warnings: list[str] = Field(default_factory=list)
    source_type: SourceType
    source_label: str | None = None
    entered_by_user: bool = False
    verified_at: datetime | None = None
    expires_at: datetime | None = None
    manual_entry_notes: str | None = None
    regular_price: Decimal | None = None
    coupon_discount: Decimal = Decimal("0")
    final_price: Decimal | None = None
    final_unit_price: Decimal | None = None
    coupon_applied: bool = False
    coupon_details: list[dict] = Field(default_factory=list)
    loyalty_required: bool = False
    search_url: str | None = None
    location_status: str | None = None
    selected_store_id: str | None = None
    selected_store_name: str | None = None
    debug_html_path: str | None = None
    debug_screenshot_path: str | None = None


class StoreInfo(BaseModel):
    name: str
    slug: str


class CompareRequest(BaseModel):
    items: list[str]
    stores: list[str] = Field(default_factory=lambda: ["walmart", "safeway", "kroger"])
    zip_code: str
    include_manual: bool = True
    include_coupons: bool = True
    store_locations: dict[str, dict] = Field(default_factory=dict)


class ItemComparison(BaseModel):
    query: str
    cheapest: ProductResult | None = None
    cheapest_before_coupons: ProductResult | None = None
    store_results: list[ProductResult]
    warnings: list[str] = Field(default_factory=list)


class CartSummary(BaseModel):
    store: str | None = None
    total: Decimal | None = None
    stores_required: list[str] = Field(default_factory=list)


class CompareResponse(BaseModel):
    zip_code: str
    checked_at: datetime
    items: list[ItemComparison]
    best_single_store: CartSummary
    split_cart: CartSummary
    estimated_savings: Decimal
    recommendation: str


class ManualPriceCreate(BaseModel):
    store_slug: str
    store_name: str | None = None
    item_query: str
    product_name: str
    brand: str | None = None
    size_text: str | None = None
    price: Decimal
    sale_price: Decimal | None = None
    unit_price: Decimal | None = None
    unit_price_unit: str | None = None
    in_stock: bool | None = True
    product_url: str | None = None
    notes: str | None = None
    zip_code: str
    expires_at: datetime | None = None
    reusable: bool = False


class CouponCreate(BaseModel):
    store_slug: str
    store_name: str | None = None
    coupon_name: str
    coupon_type: str
    description: str | None = None
    applies_to: str = "item"
    item_query: str | None = None
    product_name_match: str | None = None
    category: str | None = None
    amount_off: Decimal | None = None
    percent_off: Decimal | None = None
    required_quantity: int | None = None
    free_quantity: int | None = None
    minimum_purchase_amount: Decimal | None = None
    loyalty_required: bool = False
    promo_code: str | None = None
    starts_at: datetime | None = None
    expires_at: datetime | None = None
    source_type: SourceType = "manual"
    source_label: str | None = None
    entered_by_user: bool = True
    notes: str | None = None


class StoreSessionConfig(BaseModel):
    store_slug: str
    profile_dir: str | None = None
    selected_store_id: str | None = None
    selected_store_name: str | None = None
    notes: str | None = None


class StoreSessionStatus(StoreSessionConfig):
    store_name: str
    profile_dir_exists: bool = False
    signed_in: bool | None = None
    warnings: list[str] = Field(default_factory=list)
