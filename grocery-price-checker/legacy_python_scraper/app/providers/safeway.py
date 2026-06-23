from __future__ import annotations

import re
from datetime import datetime, timezone
from decimal import Decimal
from urllib.parse import quote_plus

from app.providers.base import GroceryProvider
from app.schemas import ProductResult
from app.scraping.browser import BrowserSession
from app.scraping.selectors import SAFEWAY_SELECTORS
from app.scraping.session_config import get_store_config


def parse_price(text: str | None) -> Decimal | None:
    if not text:
        return None
    match = re.search(r"\$?\s*(\d+(?:\.\d{2})?)", text.replace(",", ""))
    return Decimal(match.group(1)) if match else None


class SafewayProvider(GroceryProvider):
    name = "Safeway"
    slug = "safeway"

    async def set_location(self, zip_code: str):
        return None

    async def search_item(self, query: str, zip_code: str, limit: int = 10) -> list[ProductResult]:
        config = get_store_config(self.slug)
        url = f"https://www.safeway.com/shop/search-results.html?q={quote_plus(query)}"
        location_status = (
            f"ZIP {zip_code} provided, but Safeway generally requires selecting a local store for accurate pricing."
            if not (config.selected_store_id or config.selected_store_name)
            else f"ZIP {zip_code}; configured Safeway store: {config.selected_store_name or config.selected_store_id}."
        )
        try:
            data = await BrowserSession(self.slug).search_and_extract(url, {**SAFEWAY_SELECTORS, "limit": limit})
        except Exception as exc:
            return self.error_result(query, zip_code, "location_required", f"Safeway scrape failed or requires store selection/cookies: {exc}", search_url=url, location_status=location_status)
        if data.get("blocked"):
            return self.error_result(
                query,
                zip_code,
                "scraper_blocked",
                "Safeway returned a CAPTCHA/block page to the scraper.",
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
                    source_label="Safeway public product search",
                    warnings=["Safeway local pricing may require selected store or loyalty account"],
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
                f"Safeway returned no parseable product cards; page state was {data.get('page_state')}; selected store/session may be required",
                search_url=url,
                location_status=location_status,
                debug_html_path=data.get("debug_html_path"),
                debug_screenshot_path=data.get("debug_screenshot_path"),
            )
        return results
