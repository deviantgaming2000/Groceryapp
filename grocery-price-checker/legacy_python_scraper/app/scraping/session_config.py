from __future__ import annotations

import json
import os
from pathlib import Path

from app.schemas import StoreSessionConfig, StoreSessionStatus

CONFIG_PATH = Path("store_sessions.json")
STORE_NAMES = {"walmart": "Walmart", "safeway": "Safeway", "kroger": "Fry's / Kroger"}


def _load() -> dict:
    if not CONFIG_PATH.exists():
        return {}
    return json.loads(CONFIG_PATH.read_text())


def _save(data: dict) -> None:
    CONFIG_PATH.write_text(json.dumps(data, indent=2))


def get_store_config(store_slug: str) -> StoreSessionConfig:
    data = _load().get(store_slug, {})
    env_profile = os.getenv(f"{store_slug.upper()}_PROFILE_DIR")
    if env_profile and not data.get("profile_dir"):
        data["profile_dir"] = env_profile
    return StoreSessionConfig(store_slug=store_slug, **data)


def save_store_config(config: StoreSessionConfig) -> StoreSessionStatus:
    data = _load()
    payload = config.model_dump(exclude={"store_slug"})
    data[config.store_slug] = payload
    _save(data)
    return get_store_status(config.store_slug)


def get_store_status(store_slug: str) -> StoreSessionStatus:
    config = get_store_config(store_slug)
    profile_exists = Path(config.profile_dir).expanduser().exists() if config.profile_dir else False
    warnings = []
    if store_slug in {"safeway", "kroger"} and not config.selected_store_id and not config.selected_store_name:
        warnings.append("Local prices may require selecting a specific store for this ZIP code.")
    if not config.profile_dir:
        warnings.append("No signed-in browser profile configured.")
    elif not profile_exists:
        warnings.append("Configured browser profile path does not exist yet.")
    return StoreSessionStatus(
        store_slug=store_slug,
        store_name=STORE_NAMES.get(store_slug, store_slug),
        profile_dir=config.profile_dir,
        selected_store_id=config.selected_store_id,
        selected_store_name=config.selected_store_name,
        notes=config.notes,
        profile_dir_exists=profile_exists,
        signed_in=None,
        warnings=warnings,
    )


def all_store_statuses() -> list[StoreSessionStatus]:
    return [get_store_status(slug) for slug in STORE_NAMES]
