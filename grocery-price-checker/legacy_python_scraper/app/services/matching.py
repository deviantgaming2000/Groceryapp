from __future__ import annotations

import re

from rapidfuzz import fuzz

from app.schemas import ProductResult

PENALTIES = {
    "milk": ["chocolate", "strawberry", "almond", "oat", "soy", "powdered", "evaporated", "condensed", "creamer"],
    "eggs": ["egg noodles", "egg bites", "egg substitute", "candy eggs", "cadbury"],
    "butter": ["peanut butter", "almond butter", "cookie butter"],
}

PREFERENCES = {
    "eggs": ["large eggs", "dozen eggs", "18 count"],
    "butter": ["butter sticks", "salted butter", "unsalted butter"],
}


def words(text: str) -> set[str]:
    return set(re.findall(r"[a-z0-9]+", text.lower()))


def score_match(query: str, product_name: str, brand: str | None = None) -> tuple[float, list[str]]:
    q = query.lower().strip()
    title = product_name.lower()
    warnings: list[str] = []
    score = fuzz.token_set_ratio(q, title) / 100
    q_words = words(q)
    title_words = words(title)
    if q_words and q_words.issubset(title_words):
        score += 0.4
    for key, bad_terms in PENALTIES.items():
        if key in q_words:
            for term in bad_terms:
                if term in title and term not in q:
                    score -= 0.9
                    warnings.append(f"Possible mismatch: contains '{term}'")
    for key, terms in PREFERENCES.items():
        if key in q_words and any(term in title for term in terms):
            score += 0.08
    score = max(0.0, min(1.0, score))
    if score < 0.7:
        warnings.append("Low confidence match")
    return score, warnings


def rank_results(query: str, results: list[ProductResult]) -> list[ProductResult]:
    ranked = []
    for result in results:
        if result.scrape_status != "ok":
            result.confidence_score = None
            ranked.append(result)
            continue
        score, warnings = score_match(query, result.product_name, result.brand)
        result.confidence_score = score
        result.warnings = list(dict.fromkeys([*result.warnings, *warnings]))
        ranked.append(result)
    return sorted(ranked, key=lambda item: (item.confidence_score or 0, item.final_price or item.sale_price or item.price or 0), reverse=True)
