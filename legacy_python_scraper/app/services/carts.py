from __future__ import annotations

from collections import defaultdict
from decimal import Decimal

from app.schemas import CartSummary, ItemComparison


def price_of(item) -> Decimal | None:
    if item is None:
        return None
    return item.final_price or item.sale_price or item.price


def split_cart(items: list[ItemComparison]) -> CartSummary:
    total = Decimal("0")
    stores = set()
    for item in items:
        price = price_of(item.cheapest)
        if price is not None and item.cheapest:
            total += price
            stores.add(item.cheapest.store)
    return CartSummary(total=total, stores_required=sorted(stores))


def best_single_store(items: list[ItemComparison]) -> CartSummary:
    totals: dict[str, Decimal] = defaultdict(lambda: Decimal("0"))
    counts: dict[str, int] = defaultdict(int)
    for item in items:
        for result in item.store_results:
            price = price_of(result)
            if price is not None and result.scrape_status == "ok":
                totals[result.store] += price
                counts[result.store] += 1
    if not totals:
        return CartSummary()
    needed = max(1, len(items))
    penalized = {store: total + Decimal("999") * (needed - counts[store]) for store, total in totals.items()}
    best = min(penalized, key=penalized.get)
    return CartSummary(store=best, total=totals[best], stores_required=[best])


def recommendation(single: CartSummary, split: CartSummary) -> tuple[Decimal, str]:
    if single.total is None or split.total is None:
        return Decimal("0"), "No reliable cart recommendation because live/manual prices are incomplete."
    savings = single.total - split.total
    if savings < Decimal("10"):
        return savings, f"Best practical choice: {single.store}. Splitting the trip saves only ${savings:.2f}."
    if len(split.stores_required) >= 3:
        return savings, f"Split cart saves ${savings:.2f}, but it requires 3 stores."
    return savings, f"Split cart saves ${savings:.2f} across {', '.join(split.stores_required)}."

