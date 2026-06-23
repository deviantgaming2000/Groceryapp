from __future__ import annotations

import os
from pathlib import Path

from playwright.async_api import async_playwright

from app.scraping.rate_limit import wait_for_store
from app.scraping.session_config import get_store_config

DEBUG_DIR = Path("debug_snapshots")
DEBUG_DIR.mkdir(exist_ok=True)


class BrowserSession:
    def __init__(self, store_slug: str):
        self.store_slug = store_slug
        self.headless = os.getenv("HEADLESS", "true").lower() != "false"
        self.timeout_ms = int(os.getenv("SCRAPE_TIMEOUT_MS", "25000"))
        self.config = get_store_config(store_slug)

    def _debug_path(self, suffix: str) -> Path:
        return DEBUG_DIR / f"{self.store_slug}_{suffix}"

    def _page_state(self, html: str) -> str:
        lowered = html.lower()
        if "robot or human" in lowered or "px-captcha" in lowered or "captcha" in lowered:
            return "blocked_or_captcha"
        if "enable javascript" in lowered:
            return "javascript_required"
        if "sign in" in lowered and "product" not in lowered and self.store_slug in {"safeway", "kroger"}:
            return "login_or_location_required"
        return "loaded"

    async def open_page(self, url: str):
        await wait_for_store(self.store_slug)
        playwright = await async_playwright().start()
        user_agent = os.getenv("USER_AGENT", "Mozilla/5.0")
        if self.config.profile_dir:
            context = await playwright.chromium.launch_persistent_context(
                str(Path(self.config.profile_dir).expanduser()),
                headless=self.headless,
                user_agent=user_agent,
            )
            browser = None
            page = context.pages[0] if context.pages else await context.new_page()
        else:
            browser = await playwright.chromium.launch(headless=self.headless)
            context = await browser.new_context(user_agent=user_agent)
            page = await context.new_page()
        page.set_default_timeout(self.timeout_ms)
        try:
            response = await page.goto(url, wait_until="domcontentloaded")
            return playwright, context, browser, page, response
        except Exception:
            if os.getenv("SAVE_DEBUG_SCREENSHOTS", "false").lower() == "true":
                await page.screenshot(path=str(self._debug_path("failure.png")), full_page=True)
            await context.close()
            if browser:
                await browser.close()
            await playwright.stop()
            raise

    async def search_and_extract(self, url: str, selectors: dict):
        playwright, context, browser, page, response = await self.open_page(url)
        html_path = None
        screenshot_path = None
        try:
            await page.wait_for_timeout(2500)
            content = await page.content()
            page_state = self._page_state(content)
            cards = await page.locator(selectors["card"]).all()
            extracted = []
            for card in cards[: selectors.get("limit", 10)]:
                row = {}
                for key, selector in selectors.items():
                    if key in {"card", "limit"}:
                        continue
                    locator = card.locator(selector).first
                    try:
                        row[key] = (await locator.inner_text()).strip()
                    except Exception:
                        row[key] = None
                extracted.append(row)
            save_html = os.getenv("SAVE_DEBUG_HTML", "false").lower() == "true"
            save_screenshot = os.getenv("SAVE_DEBUG_SCREENSHOTS", "false").lower() == "true"
            save_failed = os.getenv("SAVE_FAILED_DEBUG_ARTIFACTS", "true").lower() == "true"
            if save_html or (save_failed and not extracted):
                html_path = str(self._debug_path("browser.html"))
                Path(html_path).write_text(content)
            if not extracted and (save_screenshot or save_failed):
                screenshot_path = str(self._debug_path("no_cards.png"))
                await page.screenshot(path=screenshot_path, full_page=True)
            return {
                "status": response.status if response else None,
                "rows": extracted,
                "card_count": len(cards),
                "page_state": page_state,
                "blocked": page_state == "blocked_or_captcha",
                "url": url,
                "debug_html_path": html_path,
                "debug_screenshot_path": screenshot_path,
                "profile_dir": self.config.profile_dir,
                "selected_store_id": self.config.selected_store_id,
                "selected_store_name": self.config.selected_store_name,
            }
        finally:
            await context.close()
            if browser:
                await browser.close()
            await playwright.stop()

    async def diagnose(self, url: str, selectors: dict):
        playwright, context, browser, page, response = await self.open_page(url)
        try:
            await page.wait_for_timeout(2500)
            html_path = str(self._debug_path("diagnostic.html"))
            screenshot_path = str(self._debug_path("diagnostic.png"))
            content = await page.content()
            page_state = self._page_state(content)
            Path(html_path).write_text(content)
            await page.screenshot(path=screenshot_path, full_page=True)
            card_count = await page.locator(selectors["card"]).count()
            title = await page.title()
            current_url = page.url
            return {
                "requested_url": url,
                "final_url": current_url,
                "title": title,
                "http_status": response.status if response else None,
                "card_selector": selectors["card"],
                "card_count": card_count,
                "page_state": page_state,
                "blocked": page_state == "blocked_or_captcha",
                "html_path": html_path,
                "screenshot_path": screenshot_path,
                "profile_dir": self.config.profile_dir,
                "selected_store_id": self.config.selected_store_id,
                "selected_store_name": self.config.selected_store_name,
            }
        finally:
            await context.close()
            if browser:
                await browser.close()
            await playwright.stop()
