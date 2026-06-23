from __future__ import annotations

import hashlib
import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

CACHE_DIR = Path(".cache")
CACHE_DIR.mkdir(exist_ok=True)


def cache_key(*parts: str) -> Path:
    digest = hashlib.sha256("|".join(parts).encode()).hexdigest()
    return CACHE_DIR / f"{digest}.json"


def get_cached(*parts: str):
    path = cache_key(*parts)
    if not path.exists():
        return None
    ttl = int(os.getenv("CACHE_TTL_MINUTES", "60"))
    data = json.loads(path.read_text())
    created = datetime.fromisoformat(data["created_at"])
    if created + timedelta(minutes=ttl) < datetime.now(timezone.utc):
        return None
    return data["payload"]


def set_cached(payload, *parts: str) -> None:
    path = cache_key(*parts)
    path.write_text(json.dumps({"created_at": datetime.now(timezone.utc).isoformat(), "payload": payload}, default=str))

