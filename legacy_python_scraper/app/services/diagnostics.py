from __future__ import annotations

import os
from urllib.parse import quote_plus

from app.scraping.browser import BrowserSession
from app.scraping.selectors import KROGER_SELECTORS, SAFEWAY_SELECTORS, WALMART_SELECTORS
from app.scraping.session_config import get_store_status


def provider_search_url(store_slug: str, query: str, zip_code: str) -> str:
    if store_slug == "walmart":
        return f"https://www.walmart.com/search?q={quote_plus(query)}&facet=fulfillment_method_in_store%3AIn-store&postal_code={quote_plus(zip_code)}"
    if store_slug == "safeway":
        return f"https://www.safeway.com/shop/search-results.html?q={quote_plus(query)}"
    if store_slug == "kroger":
        return f"https://www.frysfood.com/search?query={quote_plus(query)}"
    raise ValueError("Unknown store")


def provider_selectors(store_slug: str) -> dict:
    if store_slug == "walmart":
        return WALMART_SELECTORS
    if store_slug == "safeway":
        return SAFEWAY_SELECTORS
    if store_slug == "kroger":
        return KROGER_SELECTORS
    raise ValueError("Unknown store")


async def diagnose_provider(store_slug: str, query: str, zip_code: str) -> dict:
    url = provider_search_url(store_slug, query, zip_code)
    status = get_store_status(store_slug)
    result = {
        "store_slug": store_slug,
        "query": query,
        "zip_code": zip_code,
        "search_url": url,
        "session": status.model_dump(),
        "environment": {
            "headless": os.getenv("HEADLESS", "true"),
            "save_failed_debug_artifacts": os.getenv("SAVE_FAILED_DEBUG_ARTIFACTS", "true"),
        },
    }
    if store_slug == "kroger" and not (os.getenv("KROGER_CLIENT_ID") and os.getenv("KROGER_CLIENT_SECRET")):
        result["api_warning"] = "Kroger API credentials missing; scraper fallback will be attempted."
    try:
        result["browser"] = await BrowserSession(store_slug).diagnose(url, provider_selectors(store_slug))
    except Exception as exc:
        result["error"] = str(exc)
    return result
