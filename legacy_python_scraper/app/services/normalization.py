from __future__ import annotations

from decimal import Decimal

from app.schemas import ProductResult
from app.services.unit_prices import calculate_unit_price, parse_size


def normalize_result(result: ProductResult) -> ProductResult:
    size_value, size_unit = parse_size(result.size_text)
    result.size_value = result.size_value or size_value
    result.size_unit = result.size_unit or size_unit
    base_price: Decimal | None = result.sale_price or result.price
    calculated, unit = calculate_unit_price(base_price, result.size_value, result.size_unit)
    result.calculated_unit_price = result.calculated_unit_price or calculated
    result.unit_price_unit = result.unit_price_unit or unit
    result.regular_price = result.price
    result.final_price = result.final_price or base_price
    final_unit, final_unit_name = calculate_unit_price(result.final_price, result.size_value, result.size_unit)
    result.final_unit_price = result.final_unit_price or final_unit
    result.unit_price_unit = result.unit_price_unit or final_unit_name
    if result.size_text and result.size_value is None:
        result.warnings.append("Product size could not be parsed")
    if result.store_unit_price and result.calculated_unit_price:
        diff = abs(result.store_unit_price - result.calculated_unit_price)
        if diff > Decimal("0.02"):
            result.warnings.append("Store unit price and calculated unit price differ")
    return result

