from __future__ import annotations

import base64
import os
import re
from datetime import datetime, timezone
from decimal import Decimal
from urllib.parse import quote_plus

import httpx

from app.providers.base import GroceryProvider
from app.schemas import ProductResult
from app.scraping.browser import BrowserSession
from app.scraping.selectors import KROGER_SELECTORS
from app.scraping.session_config import get_store_config


def parse_price(text: str | None) -> Decimal | None:
    if not text:
        return None
    match = re.search(r"\$?\s*(\d+(?:\.\d{2})?)", text.replace(",", ""))
    return Decimal(match.group(1)) if match else None


class KrogerProvider(GroceryProvider):
    name = "Fry's / Kroger"
    slug = "kroger"

    async def _api_search(self, query: str, zip_code: str, limit: int) -> list[ProductResult]:
        client_id = os.getenv("KROGER_CLIENT_ID")
        secret = os.getenv("KROGER_CLIENT_SECRET")
        if not client_id or not secret:
            raise RuntimeError("API credentials missing")
        auth = base64.b64encode(f"{client_id}:{secret}".encode()).decode()
        async with httpx.AsyncClient(timeout=20) as client:
            token = await client.post(
                "https://api.kroger.com/v1/connect/oauth2/token",
                data={"grant_type": "client_credentials", "scope": "product.compact"},
                headers={"Authorization": f"Basic {auth}"},
            )
            token.raise_for_status()
            access_token = token.json()["access_token"]
            response = await client.get(
                "https://api.kroger.com/v1/products",
                params={"filter.term": query, "filter.limit": limit},
                headers={"Authorization": f"Bearer {access_token}"},
            )
            response.raise_for_status()
        results = []
        for item in response.json().get("data", []):
            price_data = (item.get("items") or [{}])[0].get("price") or {}
            price = price_data.get("regular")
            promo = price_data.get("promo")
            results.append(
                ProductResult(
                    query=query,
                    store=self.name,
                    store_slug=self.slug,
                    product_name=item.get("description") or "Kroger product",
                    brand=item.get("brand"),
                    price=Decimal(str(price)) if price is not None else None,
                    sale_price=Decimal(str(promo)) if promo is not None else None,
                    size_text=item.get("items", [{}])[0].get("size"),
                    product_url=f"https://www.kroger.com/p/{item.get('productId')}" if item.get("productId") else None,
                    zip_code=zip_code,
                    checked_at=datetime.now(timezone.utc),
                    source_type="api",
                    source_label="Kroger Product API",
                    search_url="https://api.kroger.com/v1/products",
                    location_status=f"ZIP {zip_code} provided; compact product API response may not include local store pricing without location filters.",
                )
            )
        return results

    async def search_item(self, query: str, zip_code: str, limit: int = 10) -> list[ProductResult]:
        try:
            api_results = await self._api_search(query, zip_code, limit)
            if api_results:
                return api_results
        except Exception as api_exc:
            api_message = str(api_exc)
        config = get_store_config(self.slug)
        url = f"https://www.frysfood.com/search?query={quote_plus(query)}"
        location_status = (
            f"ZIP {zip_code} provided, but Fry's/Kroger web pricing generally requires selecting a store."
            if not (config.selected_store_id or config.selected_store_name)
            else f"ZIP {zip_code}; configured Fry's/Kroger store: {config.selected_store_name or config.selected_store_id}."
        )
        try:
            data = await BrowserSession(self.slug).search_and_extract(url, {**KROGER_SELECTORS, "limit": limit})
        except Exception as scrape_exc:
            status = "api_credentials_missing" if "credentials" in api_message.lower() else "no_live_data_available"
            return self.error_result(query, zip_code, status, f"Kroger API: {api_message}; scraper failed: {scrape_exc}", search_url=url, location_status=location_status)
        if data.get("blocked"):
            return self.error_result(
                query,
                zip_code,
                "scraper_blocked",
                f"Kroger API: {api_message}; Fry's returned a CAPTCHA/block page to the scraper.",
                search_url=url,
                location_status=location_status,
                debug_html_path=data.get("debug_html_path"),
                debug_screenshot_path=data.get("debug_screenshot_path"),
            )
        results = []
        for row in data.get("rows", []):
            title = row.get("title")
            price = parse_price(row.get("price"))
            if not title or price is None:
                continue
            results.append(
                ProductResult(
                    query=query,
                    store=self.name,
                    store_slug=self.slug,
                    product_name=title,
                    price=price,
                    size_text=title,
                    zip_code=zip_code,
                    checked_at=datetime.now(timezone.utc),
                    source_type="scrape",
                    source_label="Fry's public product search",
                    warnings=[f"Kroger API unavailable: {api_message}"],
                    search_url=url,
                    location_status=location_status,
                    selected_store_id=config.selected_store_id,
                    selected_store_name=config.selected_store_name,
                    debug_html_path=data.get("debug_html_path"),
                    debug_screenshot_path=data.get("debug_screenshot_path"),
                )
            )
        if not results:
            return self.error_result(
                query,
                zip_code,
                "location_required" if not (config.selected_store_id or config.selected_store_name) else "no_live_data_available",
                f"Kroger API: {api_message}; scraper found no products",
                search_url=url,
                location_status=location_status,
                debug_html_path=data.get("debug_html_path"),
                debug_screenshot_path=data.get("debug_screenshot_path"),
            )
        return results
