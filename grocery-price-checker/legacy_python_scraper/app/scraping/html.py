from __future__ import annotations

import os
from pathlib import Path

import httpx
from bs4 import BeautifulSoup

from app.scraping.rate_limit import wait_for_store
from app.scraping.robots import allowed_by_robots

DEBUG_DIR = Path("debug_snapshots")
DEBUG_DIR.mkdir(exist_ok=True)


async def fetch_html(url: str, store_slug: str) -> tuple[int, str, str | None]:
    user_agent = os.getenv("USER_AGENT", "Mozilla/5.0 compatible grocery-price-checker/1.0")
    if not await allowed_by_robots(url, user_agent):
        raise PermissionError("robots.txt disallows this path")
    await wait_for_store(store_slug)
    async with httpx.AsyncClient(timeout=20, follow_redirects=True, headers={"User-Agent": user_agent}) as client:
        response = await client.get(url)
    snapshot = None
    if os.getenv("SAVE_DEBUG_HTML", "false").lower() == "true":
        snapshot = str(DEBUG_DIR / f"{store_slug}.html")
        Path(snapshot).write_text(response.text)
    return response.status_code, response.text, snapshot


def soup(html: str) -> BeautifulSoup:
    return BeautifulSoup(html, "html.parser")

