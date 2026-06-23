from __future__ import annotations

from abc import ABC, abstractmethod
from datetime import datetime, timezone

from app.schemas import ProductResult


class GroceryProvider(ABC):
    name: str
    slug: str

    @abstractmethod
    async def search_item(self, query: str, zip_code: str, limit: int = 10) -> list[ProductResult]:
        pass

    def error_result(
        self,
        query: str,
        zip_code: str,
        status: str,
        message: str,
        search_url: str | None = None,
        location_status: str | None = None,
        debug_html_path: str | None = None,
        debug_screenshot_path: str | None = None,
    ) -> list[ProductResult]:
        return [
            ProductResult(
                query=query,
                store=self.name,
                store_slug=self.slug,
                product_name=f"{self.name} unavailable",
                zip_code=zip_code,
                checked_at=datetime.now(timezone.utc),
                scrape_status=status,
                error_message=message,
                warnings=[message],
                source_type="scrape",
                source_label=f"{self.name} public product search",
                search_url=search_url,
                location_status=location_status,
                debug_html_path=debug_html_path,
                debug_screenshot_path=debug_screenshot_path,
            )
        ]
