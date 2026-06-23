from __future__ import annotations

import asyncio
import json
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy.orm import Session

from app.models import ComparisonItem, ComparisonRun, Coupon, PriceCheck, Product
from app.providers.registry import PROVIDERS
from app.schemas import CompareRequest, CompareResponse, ItemComparison, ProductResult
from app.services.carts import best_single_store, recommendation, split_cart
from app.services.coupons import apply_item_coupons, coupon_is_active
from app.services.manual_prices import active_manual_entries, manual_entry_to_result
from app.services.matching import rank_results
from app.services.normalization import normalize_result


def _price(result: ProductResult) -> Decimal | None:
    return result.final_price or result.sale_price or result.price


def _persist_result(db: Session, result: ProductResult) -> None:
    product = Product(
        store_slug=result.store_slug,
        product_name=result.product_name,
        brand=result.brand,
        product_url=result.product_url,
        image_url=result.image_url,
    )
    db.add(product)
    db.flush()
    db.add(
        PriceCheck(
            product_id=product.id,
            query=result.query,
            store_slug=result.store_slug,
            store_name=result.store,
            zip_code=result.zip_code,
            price=result.price,
            sale_price=result.sale_price,
            final_price=result.final_price,
            size_text=result.size_text,
            unit_price=result.final_unit_price or result.calculated_unit_price or result.store_unit_price,
            unit_price_unit=result.unit_price_unit,
            confidence_score=result.confidence_score,
            scrape_status=result.scrape_status,
            source_type=result.source_type,
            source_label=result.source_label,
            warnings=json.dumps(result.warnings),
            checked_at=result.checked_at,
        )
    )


def _active_coupons(db: Session, store_slugs: list[str]) -> list[Coupon]:
    return [c for c in db.query(Coupon).filter(Coupon.store_slug.in_(store_slugs)).all() if coupon_is_active(c)]


async def compare_prices(db: Session, request: CompareRequest) -> CompareResponse:
    checked_at = datetime.now(timezone.utc)
    run = ComparisonRun(zip_code=request.zip_code, include_manual=request.include_manual, include_coupons=request.include_coupons)
    db.add(run)
    db.flush()
    coupons = _active_coupons(db, request.stores) if request.include_coupons else []
    comparisons: list[ItemComparison] = []
    for query in request.items:
        tasks = [PROVIDERS[slug].search_item(query, request.zip_code) for slug in request.stores if slug in PROVIDERS]
        provider_batches = await asyncio.gather(*tasks)
        results = [normalize_result(result) for batch in provider_batches for result in batch]
        if request.include_manual:
            manual_rows = active_manual_entries(db, query, request.stores, request.zip_code)
            results.extend(manual_entry_to_result(row, query) for row in manual_rows)
        scored = rank_results(query, results)
        if request.include_coupons:
            scored = [apply_item_coupons(result, coupons) for result in scored]
        valid = [r for r in scored if _price(r) is not None and r.scrape_status == "ok" and r.in_stock is not False]
        cheapest = min(valid, key=lambda r: _price(r) or Decimal("999999")) if valid else None
        before = min(valid, key=lambda r: r.sale_price or r.price or Decimal("999999")) if valid else None
        warnings = sorted({w for result in scored for w in result.warnings})
        if not valid:
            warnings.append("No live or enabled manual price available")
        item = ItemComparison(query=query, cheapest=cheapest, cheapest_before_coupons=before, store_results=scored, warnings=warnings)
        comparisons.append(item)
        db.add(
            ComparisonItem(
                comparison_run_id=run.id,
                item_query=query,
                cheapest_store_slug=cheapest.store_slug if cheapest else None,
                cheapest_price=_price(cheapest) if cheapest else None,
                warnings=json.dumps(warnings),
            )
        )
        for result in scored:
            _persist_result(db, result)
    single = best_single_store(comparisons)
    split = split_cart(comparisons)
    savings, text = recommendation(single, split)
    db.commit()
    return CompareResponse(
        zip_code=request.zip_code,
        checked_at=checked_at,
        items=comparisons,
        best_single_store=single,
        split_cart=split,
        estimated_savings=savings,
        recommendation=text,
    )

