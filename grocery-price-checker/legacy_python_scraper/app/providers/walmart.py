from __future__ import annotations

import re
from datetime import datetime, timezone
from decimal import Decimal
from urllib.parse import quote_plus

from app.providers.base import GroceryProvider
from app.schemas import ProductResult
from app.scraping.browser import BrowserSession
from app.scraping.selectors import WALMART_SELECTORS


def parse_price(text: str | None) -> Decimal | None:
    if not text:
        return None
    match = re.search(r"\$?\s*(\d+(?:\.\d{2})?)", text.replace(",", ""))
    return Decimal(match.group(1)) if match else None


class WalmartProvider(GroceryProvider):
    name = "Walmart"
    slug = "walmart"

    async def search_item(self, query: str, zip_code: str, limit: int = 10) -> list[ProductResult]:
        url = f"https://www.walmart.com/search?q={quote_plus(query)}&facet=fulfillment_method_in_store%3AIn-store&postal_code={quote_plus(zip_code)}"
        location_status = f"ZIP {zip_code} passed in Walmart search URL; exact store selection may still depend on Walmart session/location cookies."
        try:
            data = await BrowserSession(self.slug).search_and_extract(url, {**WALMART_SELECTORS, "limit": limit})
        except PermissionError as exc:
            return self.error_result(query, zip_code, "scraper_blocked", str(exc), search_url=url, location_status=location_status)
        except Exception as exc:
            return self.error_result(query, zip_code, "no_live_data_available", f"Walmart scrape failed: {exc}", search_url=url, location_status=location_status)
        rows = data.get("rows", [])
        if data.get("blocked"):
            return self.error_result(
                query,
                zip_code,
                "scraper_blocked",
                "Walmart returned a Robot or human challenge to the scraper. Open the debug screenshot to confirm.",
                search_url=url,
                location_status=location_status,
                debug_html_path=data.get("debug_html_path"),
                debug_screenshot_path=data.get("debug_screenshot_path"),
            )
        results = []
        for row in rows:
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
                    source_label="Walmart public product search",
                    search_url=url,
                    location_status=location_status,
                    selected_store_id=data.get("selected_store_id"),
                    selected_store_name=data.get("selected_store_name"),
                    debug_html_path=data.get("debug_html_path"),
                    debug_screenshot_path=data.get("debug_screenshot_path"),
                )
            )
        if not results:
            return self.error_result(
                query,
                zip_code,
                "no_live_data_available",
                f"Walmart returned no parseable product cards at ZIP {zip_code}",
                search_url=url,
                location_status=location_status,
                debug_html_path=data.get("debug_html_path"),
                debug_screenshot_path=data.get("debug_screenshot_path"),
            )
        return results
