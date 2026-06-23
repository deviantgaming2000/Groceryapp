from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal

from sqlalchemy.orm import Session

from app.models import ManualPriceEntry
from app.providers.registry import PROVIDERS
from app.schemas import ManualPriceCreate, ProductResult
from app.services.normalization import normalize_result


def default_expiration() -> datetime:
    return datetime.now(timezone.utc) + timedelta(hours=24)


def create_manual_price(db: Session, data: ManualPriceCreate) -> ManualPriceEntry:
    provider = PROVIDERS.get(data.store_slug)
    store_name = data.store_name or (provider.name if provider else data.store_slug)
    expires_at = None if data.reusable else (data.expires_at or default_expiration())
    entry = ManualPriceEntry(
        store_slug=data.store_slug,
        store_name=store_name,
        item_query=data.item_query,
        product_name=data.product_name,
        brand=data.brand,
        size_text=data.size_text,
        price=data.price,
        sale_price=data.sale_price,
        unit_price=data.unit_price,
        unit_price_unit=data.unit_price_unit,
        in_stock=data.in_stock,
        product_url=data.product_url,
        notes=data.notes,
        zip_code=data.zip_code,
        verified_at=datetime.now(timezone.utc),
        expires_at=expires_at,
        is_active=True,
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return entry


def active_manual_entries(db: Session, query: str, store_slugs: list[str], zip_code: str) -> list[ManualPriceEntry]:
    now = datetime.now(timezone.utc)
    rows = (
        db.query(ManualPriceEntry)
        .filter(ManualPriceEntry.is_active.is_(True))
        .filter(ManualPriceEntry.zip_code == zip_code)
        .filter(ManualPriceEntry.store_slug.in_(store_slugs))
        .all()
    )
    filtered = []
    for row in rows:
        expires_at = row.expires_at
        if expires_at and expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        if expires_at and expires_at < now:
            continue
        if row.item_query.lower() in query.lower() or query.lower() in row.item_query.lower():
            filtered.append(row)
    return filtered


def manual_entry_to_result(entry: ManualPriceEntry, query: str) -> ProductResult:
    result = ProductResult(
        query=query,
        store=entry.store_name,
        store_slug=entry.store_slug,
        product_name=entry.product_name,
        brand=entry.brand,
        price=Decimal(str(entry.price)),
        sale_price=Decimal(str(entry.sale_price)) if entry.sale_price is not None else None,
        size_text=entry.size_text,
        store_unit_price=Decimal(str(entry.unit_price)) if entry.unit_price is not None else None,
        unit_price_unit=entry.unit_price_unit,
        in_stock=entry.in_stock,
        product_url=entry.product_url,
        zip_code=entry.zip_code,
        checked_at=entry.verified_at or entry.created_at,
        confidence_score=None,
        scrape_status="ok",
        warnings=["Manual price entered by user"],
        source_type="manual",
        source_label="Manual price entry",
        entered_by_user=True,
        verified_at=entry.verified_at,
        expires_at=entry.expires_at,
        manual_entry_notes=entry.notes,
    )
    return normalize_result(result)
