from decimal import Decimal

from app.services.unit_prices import calculate_unit_price, parse_size


def test_size_parsing_common_units():
    assert parse_size("1 gal") == (128.0, "fl oz")
    assert parse_size("half gallon") == (64.0, "fl oz")
    assert parse_size("2 lb") == (32.0, "oz")
    assert parse_size("18 ct") == (18.0, "count")
    assert parse_size("1 dozen") == (12.0, "count")


def test_calculate_unit_price():
    price, unit = calculate_unit_price(Decimal("3.20"), 128, "fl oz")
    assert price == Decimal("0.0250")
    assert unit == "fl oz"

