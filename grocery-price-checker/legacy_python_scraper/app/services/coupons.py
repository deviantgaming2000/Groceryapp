from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal

from app.models import Coupon
from app.schemas import ProductResult
from app.services.unit_prices import calculate_unit_price


def coupon_is_active(coupon: Coupon, now: datetime | None = None) -> bool:
    now = now or datetime.now(timezone.utc)
    if not coupon.is_active:
        return False
    if coupon.starts_at and coupon.starts_at > now:
        return False
    if coupon.expires_at and coupon.expires_at < now:
        return False
    return True


def coupon_matches(coupon: Coupon, result: ProductResult) -> bool:
    if coupon.store_slug != result.store_slug or not coupon_is_active(coupon):
        return False
    applies_to = coupon.applies_to or "item"
    if applies_to in {"cart", "store"}:
        return True
    if coupon.item_query and coupon.item_query.lower() not in result.query.lower():
        return False
    if coupon.product_name_match and coupon.product_name_match.lower() not in result.product_name.lower():
        return False
    return True


def apply_item_coupons(result: ProductResult, coupons: list[Coupon]) -> ProductResult:
    price = result.sale_price or result.price
    if price is None:
        return result
    applicable = [c for c in coupons if coupon_matches(c, result) and (c.applies_to or "item") in {"item", "product"}]
    discount = Decimal("0")
    used = None
    if applicable:
        coupon = applicable[0]
        used = coupon
        if coupon.amount_off is not None:
            discount = Decimal(str(coupon.amount_off))
        elif coupon.percent_off is not None:
            discount = (price * Decimal(str(coupon.percent_off)) / Decimal("100")).quantize(Decimal("0.01"))
        elif coupon.coupon_type in {"bogo", "buy-x-get-y"}:
            result.warnings.append("BOGO coupon found but quantity-specific checkout math is conservative")
        discount = min(discount, price)
        if coupon.loyalty_required:
            result.loyalty_required = True
            result.warnings.append("Loyalty card required")
        if (coupon.source_type or "manual") == "manual":
            result.warnings.append("Manual coupon entered by user")
        if coupon.expires_at is None:
            result.warnings.append("Coupon expiration unknown")
        if len(applicable) > 1:
            result.warnings.append("Coupon stacking rules unknown")
    result.coupon_discount = discount
    result.final_price = price - discount
    result.final_unit_price, _ = calculate_unit_price(result.final_price, result.size_value, result.size_unit)
    result.coupon_applied = used is not None and discount > 0
    if used:
        result.coupon_details.append({"id": used.id, "name": used.coupon_name, "discount": str(discount)})
    return result
