from app.providers.base import GroceryProvider
from app.providers.kroger import KrogerProvider
from app.providers.safeway import SafewayProvider
from app.providers.walmart import WalmartProvider
from app.schemas import StoreInfo

PROVIDERS: dict[str, GroceryProvider] = {
    "walmart": WalmartProvider(),
    "safeway": SafewayProvider(),
    "kroger": KrogerProvider(),
}


def get_provider(slug: str) -> GroceryProvider:
    return PROVIDERS[slug]


def stores() -> list[StoreInfo]:
    return [StoreInfo(name=p.name, slug=p.slug) for p in PROVIDERS.values()]

