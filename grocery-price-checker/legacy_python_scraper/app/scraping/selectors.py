WALMART_SELECTORS = {
    "card": "[data-testid='list-view'] [data-item-id], [data-testid='item-stack']",
    "title": "[data-automation-id='product-title'], span[data-automation-id='product-title']",
    "price": "[data-automation-id='product-price'], [itemprop='price']",
    "unit_price": "[data-testid='unit-price']",
}

SAFEWAY_SELECTORS = {
    "card": "[data-testid='product-card'], .product-card-container",
    "title": "[data-testid='product-title'], .product-title",
    "price": "[data-testid='product-price'], .product-price",
    "unit_price": ".unit-price",
}

KROGER_SELECTORS = {
    "card": "[data-testid='product-card'], .ProductCard",
    "title": "[data-testid='cart-page-item-description'], .kds-Text--l",
    "price": "[data-testid='product-price'], .ProductPrice",
    "unit_price": ".ProductCard-sellBy",
}

