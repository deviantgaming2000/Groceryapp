from __future__ import annotations

import asyncio
from datetime import datetime
from decimal import Decimal
from pathlib import Path
from typing import Optional

import typer
from rich.console import Console
from rich.table import Table

from app.database import SessionLocal, init_db
from app.models import Coupon, ManualPriceEntry, PriceCheck
from app.providers.registry import PROVIDERS, stores as store_infos
from app.schemas import CompareRequest, CouponCreate, ManualPriceCreate
from app.services.comparison import compare_prices
from app.services.manual_prices import create_manual_price

app = typer.Typer(help="Compare real grocery prices without fake fallback data.")
manual_app = typer.Typer()
coupon_app = typer.Typer()
app.add_typer(manual_app, name="manual")
app.add_typer(coupon_app, name="coupon")
console = Console()


def parse_items(items: Optional[str], file: Optional[Path]) -> list[str]:
    if file:
        return [line.strip() for line in file.read_text().splitlines() if line.strip()]
    if not items:
        raise typer.BadParameter("Provide items or --file")
    return [item.strip() for item in items.split(",") if item.strip()]


@app.command()
def compare(
    items: Optional[str] = typer.Argument(None),
    zip_code: str = typer.Option(..., "--zip"),
    file: Optional[Path] = typer.Option(None, "--file"),
    stores: str = typer.Option("walmart,safeway,kroger"),
    include_manual: bool = typer.Option(True, "--include-manual/--no-include-manual"),
    include_coupons: bool = typer.Option(True, "--include-coupons/--no-include-coupons"),
):
    init_db()
    request = CompareRequest(
        items=parse_items(items, file),
        stores=[s.strip() for s in stores.split(",") if s.strip()],
        zip_code=zip_code,
        include_manual=include_manual,
        include_coupons=include_coupons,
    )
    with SessionLocal() as db:
        response = asyncio.run(compare_prices(db, request))
    table = Table(title=f"Grocery comparison for {zip_code}")
    for col in ["Item", "Best Store", "Product", "Price", "Final", "Confidence", "Source", "Warnings"]:
        table.add_column(col)
    for item in response.items:
        best = item.cheapest
        table.add_row(
            item.query,
            best.store if best else "-",
            best.product_name if best else "No reliable price",
            f"${best.price}" if best and best.price is not None else "-",
            f"${best.final_price}" if best and best.final_price is not None else "-",
            f"{best.confidence_score:.2f}" if best and best.confidence_score is not None else "-",
            best.source_type if best else "-",
            "; ".join(item.warnings[:3]),
        )
    console.print(table)
    console.print(response.recommendation)


@app.command("stores")
def list_stores():
    table = Table(title="Supported stores")
    table.add_column("Slug")
    table.add_column("Name")
    for store in store_infos():
        table.add_row(store.slug, store.name)
    console.print(table)


@app.command("debug-store")
def debug_store(store: str, query: str, zip_code: str = typer.Option(..., "--zip")):
    init_db()
    if store not in PROVIDERS:
        raise typer.BadParameter("Unknown store")
    results = asyncio.run(PROVIDERS[store].search_item(query, zip_code))
    table = Table(title=f"{store}: {len(results)} results")
    for col in ["Status", "Product", "Price", "Source", "Error", "Warnings"]:
        table.add_column(col)
    for result in results:
        table.add_row(result.scrape_status, result.product_name, str(result.price or "-"), result.source_type, result.error_message or "", "; ".join(result.warnings))
    console.print(table)


@app.command("history")
def history():
    init_db()
    with SessionLocal() as db:
        rows = db.query(PriceCheck).order_by(PriceCheck.checked_at.desc()).limit(50).all()
    table = Table(title="Recent price checks")
    for col in ["When", "Query", "Store", "Price", "Final", "Source", "Status"]:
        table.add_column(col)
    for row in rows:
        table.add_row(str(row.checked_at), row.query, row.store_name, str(row.price or "-"), str(row.final_price or "-"), row.source_type, row.scrape_status)
    console.print(table)


@manual_app.command("add")
def manual_add(
    store: str = typer.Option(..., "--store"),
    item: str = typer.Option(..., "--item"),
    product: str = typer.Option(..., "--product"),
    size: Optional[str] = typer.Option(None, "--size"),
    price: float = typer.Option(..., "--price"),
    zip_code: str = typer.Option(..., "--zip"),
    sale_price: Optional[float] = typer.Option(None, "--sale-price"),
    notes: Optional[str] = typer.Option(None, "--notes"),
):
    init_db()
    payload = ManualPriceCreate(store_slug=store, item_query=item, product_name=product, size_text=size, price=price, sale_price=sale_price, zip_code=zip_code, notes=notes)
    with SessionLocal() as db:
        entry = create_manual_price(db, payload)
    console.print(f"Added manual price #{entry.id}: {entry.product_name} (${entry.sale_price or entry.price})")


@manual_app.command("list")
def manual_list():
    init_db()
    with SessionLocal() as db:
        rows = db.query(ManualPriceEntry).order_by(ManualPriceEntry.created_at.desc()).all()
    table = Table(title="Manual prices")
    for col in ["ID", "Store", "Item", "Product", "Price", "Expires", "Active"]:
        table.add_column(col)
    for row in rows:
        table.add_row(str(row.id), row.store_slug, row.item_query, row.product_name, str(row.sale_price or row.price), str(row.expires_at), str(row.is_active))
    console.print(table)


@manual_app.command("edit")
def manual_edit(entry_id: int, price: Optional[float] = typer.Option(None), active: Optional[bool] = typer.Option(None)):
    init_db()
    with SessionLocal() as db:
        row = db.get(ManualPriceEntry, entry_id)
        if not row:
            raise typer.BadParameter("Manual price not found")
        if price is not None:
            row.price = price
        if active is not None:
            row.is_active = active
        row.updated_at = datetime.utcnow()
        db.commit()
    console.print("Updated manual price")


@manual_app.command("delete")
def manual_delete(entry_id: int):
    init_db()
    with SessionLocal() as db:
        row = db.get(ManualPriceEntry, entry_id)
        if not row:
            raise typer.BadParameter("Manual price not found")
        row.is_active = False
        db.commit()
    console.print("Deleted manual price")


@coupon_app.command("add")
def coupon_add(
    store: str = typer.Option(..., "--store"),
    coupon_type: str = typer.Option(..., "--type"),
    item: Optional[str] = typer.Option(None, "--item"),
    amount: Optional[float] = typer.Option(None, "--amount"),
    percent: Optional[float] = typer.Option(None, "--percent"),
    expires: Optional[datetime] = typer.Option(None, "--expires"),
    minimum_purchase: Optional[float] = typer.Option(None, "--minimum-purchase"),
    promo_code: Optional[str] = typer.Option(None, "--promo-code"),
    loyalty_required: bool = typer.Option(False, "--loyalty-required"),
):
    init_db()
    payload = CouponCreate(
        store_slug=store,
        coupon_name=f"{store} {coupon_type}",
        coupon_type=coupon_type,
        item_query=item,
        amount_off=amount,
        percent_off=percent,
        expires_at=expires,
        minimum_purchase_amount=minimum_purchase,
        promo_code=promo_code,
        loyalty_required=loyalty_required,
        source_label="Manual coupon entry",
    )
    data = payload.model_dump()
    data["store_name"] = payload.store_name or store
    with SessionLocal() as db:
        coupon = Coupon(**data)
        db.add(coupon)
        db.commit()
        db.refresh(coupon)
    console.print(f"Added coupon #{coupon.id}")


@coupon_app.command("list")
def coupon_list():
    init_db()
    with SessionLocal() as db:
        rows = db.query(Coupon).order_by(Coupon.created_at.desc()).all()
    table = Table(title="Coupons")
    for col in ["ID", "Store", "Type", "Item", "Amount", "Percent", "Expires", "Active"]:
        table.add_column(col)
    for row in rows:
        table.add_row(str(row.id), row.store_slug, row.coupon_type, row.item_query or "-", str(row.amount_off or "-"), str(row.percent_off or "-"), str(row.expires_at), str(row.is_active))
    console.print(table)


@coupon_app.command("edit")
def coupon_edit(coupon_id: int, active: Optional[bool] = typer.Option(None)):
    init_db()
    with SessionLocal() as db:
        row = db.get(Coupon, coupon_id)
        if not row:
            raise typer.BadParameter("Coupon not found")
        if active is not None:
            row.is_active = active
        db.commit()
    console.print("Updated coupon")


@coupon_app.command("delete")
def coupon_delete(coupon_id: int):
    init_db()
    with SessionLocal() as db:
        row = db.get(Coupon, coupon_id)
        if not row:
            raise typer.BadParameter("Coupon not found")
        row.is_active = False
        db.commit()
    console.print("Deleted coupon")


if __name__ == "__main__":
    app()
