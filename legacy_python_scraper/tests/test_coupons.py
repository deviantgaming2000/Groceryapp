from datetime import datetime, timedelta, timezone
from decimal import Decimal

from app.models import Coupon
from app.schemas import ProductResult
from app.services.coupons import apply_item_coupons, coupon_is_active


def product():
    return ProductResult(
        query="eggs",
        store="Safeway",
        store_slug="safeway",
        product_name="Lucerne Large Eggs",
        price=Decimal("4.99"),
        sale_price=Decimal("3.99"),
        size_text="12 count",
        size_value=12,
        size_unit="count",
        zip_code="85122",
        checked_at=datetime.now(timezone.utc),
        source_type="scrape",
    )


def test_coupon_expiration():
    coupon = Coupon(store_slug="safeway", store_name="Safeway", coupon_name="old", coupon_type="fixed-item", expires_at=datetime.now(timezone.utc) - timedelta(days=1), is_active=True)
    assert coupon_is_active(coupon) is False


def test_fixed_item_coupon_calculation():
    coupon = Coupon(store_slug="safeway", store_name="Safeway", coupon_name="eggs", coupon_type="fixed-item", item_query="eggs", amount_off=Decimal("1.00"), is_active=True, source_type="manual")
    result = apply_item_coupons(product(), [coupon])
    assert result.final_price == Decimal("2.99")
    assert result.coupon_applied is True
    assert "Manual coupon entered by user" in result.warnings


def test_percent_item_coupon_calculation_and_loyalty_warning():
    coupon = Coupon(store_slug="safeway", store_name="Safeway", coupon_name="eggs", coupon_type="percent-item", item_query="eggs", percent_off=Decimal("25"), loyalty_required=True, is_active=True)
    result = apply_item_coupons(product(), [coupon])
    assert result.final_price == Decimal("2.99")
    assert "Loyalty card required" in result.warnings


def test_coupon_stacking_prevention_warning():
    coupons = [
        Coupon(store_slug="safeway", store_name="Safeway", coupon_name="one", coupon_type="fixed-item", item_query="eggs", amount_off=Decimal("1.00"), is_active=True),
        Coupon(store_slug="safeway", store_name="Safeway", coupon_name="two", coupon_type="fixed-item", item_query="eggs", amount_off=Decimal("1.00"), is_active=True),
    ]
    result = apply_item_coupons(product(), coupons)
    assert result.coupon_discount == Decimal("1.00")
    assert "Coupon stacking rules unknown" in result.warnings

