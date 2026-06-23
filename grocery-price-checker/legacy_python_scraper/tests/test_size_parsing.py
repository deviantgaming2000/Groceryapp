from app.services.unit_prices import parse_size


def test_pack_and_bag_sizes():
    assert parse_size("24 pack") == (24.0, "count")
    assert parse_size("10 oz bag") == (10.0, "oz")

