from __future__ import annotations

import asyncio
import os
from collections import defaultdict
from datetime import datetime, timezone

_locks = defaultdict(asyncio.Lock)
_last_seen: dict[str, datetime] = {}


async def wait_for_store(store_slug: str) -> None:
    async with _locks[store_slug]:
        delay = float(os.getenv("SCRAPE_DELAY_SECONDS", "2"))
        previous = _last_seen.get(store_slug)
        if previous:
            elapsed = (datetime.now(timezone.utc) - previous).total_seconds()
            if elapsed < delay:
                await asyncio.sleep(delay - elapsed)
        _last_seen[store_slug] = datetime.now(timezone.utc)

