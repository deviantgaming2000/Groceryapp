from app.services.matching import score_match
from app.schemas import ProductResult
from app.services.matching import rank_results


def test_milk_penalizes_alternatives():
    whole, _ = score_match("milk", "Great Value Whole Milk, 1 Gallon")
    almond, warnings = score_match("milk", "Almond Milk Unsweetened")
    assert whole > almond
    assert warnings


def test_eggs_penalizes_candy():
    eggs, _ = score_match("eggs", "Large White Eggs 12 Count")
    candy, _ = score_match("eggs", "Cadbury Candy Eggs")
    assert eggs > candy


def test_failed_provider_rows_do_not_get_confidence_scores():
    result = ProductResult(
        query="milk",
        store="Walmart",
        store_slug="walmart",
        product_name="Walmart unavailable",
        zip_code="85122",
        checked_at="2026-05-23T12:00:00Z",
        scrape_status="no_live_data_available",
        source_type="scrape",
    )
    ranked = rank_results("milk", [result])
    assert ranked[0].confidence_score is None
