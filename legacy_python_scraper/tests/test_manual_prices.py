from datetime import datetime, timedelta, timezone

from app.models import ManualPriceEntry
from app.services.manual_prices import manual_entry_to_result


def test_manual_price_source_and_warning():
    entry = ManualPriceEntry(
        store_slug="walmart",
        store_name="Walmart",
        item_query="milk",
        product_name="Great Value Whole Milk",
        price=3.12,
        zip_code="85122",
        created_at=datetime.now(timezone.utc),
        verified_at=datetime.now(timezone.utc),
        expires_at=datetime.now(timezone.utc) + timedelta(hours=24),
        is_active=True,
    )
    result = manual_entry_to_result(entry, "milk")
    assert result.source_type == "manual"
    assert result.entered_by_user is True
    assert "Manual price entered by user" in result.warnings

