from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Store(Base):
    __tablename__ = "stores"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    slug: Mapped[str] = mapped_column(String, unique=True, index=True)
    name: Mapped[str] = mapped_column(String)


class Product(Base):
    __tablename__ = "products"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    store_slug: Mapped[str] = mapped_column(String, index=True)
    product_name: Mapped[str] = mapped_column(String)
    brand: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    product_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    image_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)


class PriceCheck(Base):
    __tablename__ = "price_checks"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    product_id: Mapped[Optional[int]] = mapped_column(ForeignKey("products.id"), nullable=True)
    query: Mapped[str] = mapped_column(String, index=True)
    store_slug: Mapped[str] = mapped_column(String, index=True)
    store_name: Mapped[str] = mapped_column(String)
    zip_code: Mapped[str] = mapped_column(String, index=True)
    price: Mapped[Optional[float]] = mapped_column(Numeric(10, 2), nullable=True)
    sale_price: Mapped[Optional[float]] = mapped_column(Numeric(10, 2), nullable=True)
    final_price: Mapped[Optional[float]] = mapped_column(Numeric(10, 2), nullable=True)
    size_text: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    unit_price: Mapped[Optional[float]] = mapped_column(Numeric(12, 4), nullable=True)
    unit_price_unit: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    confidence_score: Mapped[Optional[float]] = mapped_column(Numeric(4, 3), nullable=True)
    scrape_status: Mapped[str] = mapped_column(String, default="ok")
    source_type: Mapped[str] = mapped_column(String)
    source_label: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    warnings: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    checked_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class ShoppingList(Base):
    __tablename__ = "shopping_lists"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    zip_code: Mapped[str] = mapped_column(String)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class ComparisonRun(Base):
    __tablename__ = "comparison_runs"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    zip_code: Mapped[str] = mapped_column(String)
    include_manual: Mapped[bool] = mapped_column(Boolean, default=True)
    include_coupons: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class ComparisonItem(Base):
    __tablename__ = "comparison_items"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    comparison_run_id: Mapped[int] = mapped_column(ForeignKey("comparison_runs.id"))
    item_query: Mapped[str] = mapped_column(String)
    cheapest_store_slug: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    cheapest_price: Mapped[Optional[float]] = mapped_column(Numeric(10, 2), nullable=True)
    warnings: Mapped[Optional[str]] = mapped_column(Text, nullable=True)


class ManualPriceEntry(Base):
    __tablename__ = "manual_price_entries"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    store_slug: Mapped[str] = mapped_column(String, index=True)
    store_name: Mapped[str] = mapped_column(String)
    item_query: Mapped[str] = mapped_column(String, index=True)
    product_name: Mapped[str] = mapped_column(String)
    brand: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    size_text: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    price: Mapped[float] = mapped_column(Numeric(10, 2))
    sale_price: Mapped[Optional[float]] = mapped_column(Numeric(10, 2), nullable=True)
    unit_price: Mapped[Optional[float]] = mapped_column(Numeric(12, 4), nullable=True)
    unit_price_unit: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    in_stock: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    product_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    zip_code: Mapped[str] = mapped_column(String, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    verified_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    expires_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class Coupon(Base):
    __tablename__ = "coupons"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    store_slug: Mapped[str] = mapped_column(String, index=True)
    store_name: Mapped[str] = mapped_column(String)
    coupon_name: Mapped[str] = mapped_column(String)
    coupon_type: Mapped[str] = mapped_column(String)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    applies_to: Mapped[str] = mapped_column(String, default="item")
    item_query: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    product_name_match: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    category: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    amount_off: Mapped[Optional[float]] = mapped_column(Numeric(10, 2), nullable=True)
    percent_off: Mapped[Optional[float]] = mapped_column(Numeric(5, 2), nullable=True)
    required_quantity: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    free_quantity: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    minimum_purchase_amount: Mapped[Optional[float]] = mapped_column(Numeric(10, 2), nullable=True)
    loyalty_required: Mapped[bool] = mapped_column(Boolean, default=False)
    promo_code: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    starts_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    expires_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    source_type: Mapped[str] = mapped_column(String, default="manual")
    source_label: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    entered_by_user: Mapped[bool] = mapped_column(Boolean, default=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class CouponApplication(Base):
    __tablename__ = "coupon_applications"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    comparison_run_id: Mapped[int] = mapped_column(ForeignKey("comparison_runs.id"))
    coupon_id: Mapped[int] = mapped_column(ForeignKey("coupons.id"))
    product_result_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    discount_amount: Mapped[float] = mapped_column(Numeric(10, 2))
    final_price: Mapped[float] = mapped_column(Numeric(10, 2))
    warnings: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

