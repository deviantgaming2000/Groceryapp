from __future__ import annotations

import re
from decimal import Decimal, ROUND_HALF_UP

SIZE_PATTERNS = [
    (re.compile(r"\bhalf\s+gallon\b", re.I), 64.0, "fl oz"),
    (re.compile(r"\b1\s+dozen\b|\bone\s+dozen\b", re.I), 12.0, "count"),
]

UNIT_ALIASES = {
    "gal": ("fl oz", 128.0),
    "gallon": ("fl oz", 128.0),
    "gallons": ("fl oz", 128.0),
    "qt": ("fl oz", 32.0),
    "quart": ("fl oz", 32.0),
    "pt": ("fl oz", 16.0),
    "pint": ("fl oz", 16.0),
    "fl oz": ("fl oz", 1.0),
    "floz": ("fl oz", 1.0),
    "oz": ("oz", 1.0),
    "ounce": ("oz", 1.0),
    "ounces": ("oz", 1.0),
    "lb": ("oz", 16.0),
    "lbs": ("oz", 16.0),
    "pound": ("oz", 16.0),
    "pounds": ("oz", 16.0),
    "ct": ("count", 1.0),
    "count": ("count", 1.0),
    "pack": ("count", 1.0),
    "pk": ("count", 1.0),
}


def parse_size(size_text: str | None) -> tuple[float | None, str | None]:
    if not size_text:
        return None, None
    text = size_text.lower().replace("-", " ")
    for pattern, value, unit in SIZE_PATTERNS:
        if pattern.search(text):
            return value, unit
    match = re.search(r"(\d+(?:\.\d+)?)\s*(fl\s*oz|floz|gal|gallon|gallons|qt|quart|pt|pint|lbs?|pounds?|ounces?|oz|ct|count|pack|pk)\b", text)
    if not match:
        return None, None
    raw_value = float(match.group(1))
    raw_unit = re.sub(r"\s+", " ", match.group(2))
    unit, multiplier = UNIT_ALIASES[raw_unit]
    return raw_value * multiplier, unit


def comparable_unit(unit: str | None) -> str | None:
    if unit == "oz":
        return "lb"
    if unit == "fl oz":
        return "fl oz"
    if unit == "count":
        return "count"
    return unit


def calculate_unit_price(price: Decimal | None, size_value: float | None, size_unit: str | None) -> tuple[Decimal | None, str | None]:
    if price is None or not size_value or not size_unit:
        return None, None
    unit = comparable_unit(size_unit)
    divisor = Decimal(str(size_value))
    if size_unit == "oz" and unit == "lb":
        divisor = divisor / Decimal("16")
    value = (price / divisor).quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)
    return value, unit

