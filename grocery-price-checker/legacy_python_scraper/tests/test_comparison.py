from decimal import Decimal

from app.schemas import CartSummary, ItemComparison, ProductResult
from app.services.carts import best_single_store, recommendation, split_cart


def result(store, price):
    return ProductResult(
        query="milk",
        store=store,
        store_slug=store.lower(),
        product_name=f"{store} milk",
        price=Decimal(str(price)),
        final_price=Decimal(str(price)),
        zip_code="85122",
        checked_at="2026-05-23T12:00:00Z",
        confidence_score=0.9,
        source_type="manual",
    )


def test_split_and_single_store_totals():
    walmart = result("Walmart", "3.00")
    safeway = result("Safeway", "2.50")
    item = ItemComparison(query="milk", cheapest=safeway, store_results=[walmart, safeway])
    assert split_cart([item]).total == Decimal("2.50")
    assert best_single_store([item]).store == "Safeway"


def test_small_split_savings_recommends_single_store():
    savings, text = recommendation(CartSummary(store="Walmart", total=Decimal("42.00")), CartSummary(total=Decimal("38.00"), stores_required=["Walmart", "Safeway"]))
    assert savings == Decimal("4.00")
    assert "Best practical choice" in text

