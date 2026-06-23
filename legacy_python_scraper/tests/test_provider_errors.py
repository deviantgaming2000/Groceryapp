from datetime import datetime, timezone

from app.providers.walmart import WalmartProvider


def test_error_result_is_structured():
    result = WalmartProvider().error_result("milk", "85122", "scraper_blocked", "blocked")[0]
    assert result.scrape_status == "scraper_blocked"
    assert result.price is None
    assert result.source_type == "scrape"
    assert result.checked_at <= datetime.now(timezone.utc)

