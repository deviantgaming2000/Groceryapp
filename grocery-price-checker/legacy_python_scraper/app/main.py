from __future__ import annotations

from datetime import datetime, timezone

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from sqlalchemy.orm import Session

from app.database import get_db, init_db
from app.models import Coupon, ManualPriceEntry, PriceCheck
from app.providers.registry import PROVIDERS, stores
from app.schemas import CompareRequest, CouponCreate, ManualPriceCreate, StoreSessionConfig
from app.scraping.session_config import all_store_statuses, save_store_config
from app.services.comparison import compare_prices
from app.services.diagnostics import diagnose_provider
from app.services.manual_prices import create_manual_price

app = FastAPI(title="Grocery Price Checker")
app.mount("/static", StaticFiles(directory="app/static"), name="static")
app.mount("/debug-snapshots", StaticFiles(directory="debug_snapshots"), name="debug_snapshots")
templates = Jinja2Templates(directory="app/templates")


@app.on_event("startup")
def startup() -> None:
    init_db()


@app.get("/", response_class=HTMLResponse)
def index(request: Request):
    return templates.TemplateResponse("index.html", {"request": request, "stores": stores()})


@app.post("/api/compare")
async def api_compare(payload: CompareRequest, db: Session = Depends(get_db)):
    return await compare_prices(db, payload)


@app.get("/api/stores")
def api_stores():
    return stores()


@app.get("/api/store-sessions")
def api_store_sessions():
    return all_store_statuses()


@app.post("/api/store-sessions")
def api_save_store_session(payload: StoreSessionConfig):
    return save_store_config(payload)


@app.get("/api/history")
def api_history(db: Session = Depends(get_db)):
    rows = db.query(PriceCheck).order_by(PriceCheck.checked_at.desc()).limit(100).all()
    return rows


@app.post("/api/debug/search")
async def api_debug_search(payload: dict):
    slug = payload.get("store")
    if slug not in PROVIDERS:
        raise HTTPException(status_code=404, detail="Unknown store")
    return await PROVIDERS[slug].search_item(payload["query"], payload["zip_code"], payload.get("limit", 10))


@app.post("/api/debug/diagnose")
async def api_debug_diagnose(payload: dict):
    slug = payload.get("store")
    if slug not in PROVIDERS:
        raise HTTPException(status_code=404, detail="Unknown store")
    return await diagnose_provider(slug, payload["query"], payload["zip_code"])


@app.post("/api/manual-prices")
def create_manual(payload: ManualPriceCreate, db: Session = Depends(get_db)):
    return create_manual_price(db, payload)


@app.get("/api/manual-prices")
def list_manual(db: Session = Depends(get_db)):
    return db.query(ManualPriceEntry).order_by(ManualPriceEntry.created_at.desc()).all()


@app.patch("/api/manual-prices/{entry_id}")
def update_manual(entry_id: int, payload: dict, db: Session = Depends(get_db)):
    entry = db.get(ManualPriceEntry, entry_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Manual price not found")
    for key, value in payload.items():
        if hasattr(entry, key):
            setattr(entry, key, value)
    entry.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(entry)
    return entry


@app.delete("/api/manual-prices/{entry_id}")
def delete_manual(entry_id: int, db: Session = Depends(get_db)):
    entry = db.get(ManualPriceEntry, entry_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Manual price not found")
    entry.is_active = False
    db.commit()
    return {"ok": True}


@app.post("/api/coupons")
def create_coupon(payload: CouponCreate, db: Session = Depends(get_db)):
    data = payload.model_dump()
    data["store_name"] = payload.store_name or payload.store_slug
    coupon = Coupon(**data)
    db.add(coupon)
    db.commit()
    db.refresh(coupon)
    return coupon


@app.get("/api/coupons")
def list_coupons(db: Session = Depends(get_db)):
    return db.query(Coupon).order_by(Coupon.created_at.desc()).all()


@app.patch("/api/coupons/{coupon_id}")
def update_coupon(coupon_id: int, payload: dict, db: Session = Depends(get_db)):
    coupon = db.get(Coupon, coupon_id)
    if not coupon:
        raise HTTPException(status_code=404, detail="Coupon not found")
    for key, value in payload.items():
        if hasattr(coupon, key):
            setattr(coupon, key, value)
    coupon.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(coupon)
    return coupon


@app.delete("/api/coupons/{coupon_id}")
def delete_coupon(coupon_id: int, db: Session = Depends(get_db)):
    coupon = db.get(Coupon, coupon_id)
    if not coupon:
        raise HTTPException(status_code=404, detail="Coupon not found")
    coupon.is_active = False
    db.commit()
    return {"ok": True}
