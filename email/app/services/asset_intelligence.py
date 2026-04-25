from __future__ import annotations

import re
from collections import defaultdict
from typing import Dict, Iterable, List

from app.models import ArticleAnalysis


ASSET_HINTS = {
    "bitcoin": "Bitcoin",
    "btc": "Bitcoin",
    "ethereum": "Ethereum",
    "eth": "Ethereum",
    "gold": "Gold",
    "silver": "Silver",
    "treasury": "US Treasury",
    "treasuries": "US Treasury",
    "oil": "Crude Oil",
    "s&p 500": "S&P 500",
    "nasdaq": "NASDAQ",
    "usd": "USD",
    "jpy": "JPY",
    "eur": "EUR",
}

EXPLICIT_RECOMMEND_PATTERNS = [
    r"buy",
    r"add",
    r"accumulate",
    r"hold",
    r"overweight",
    r"allocate",
    r"bullish",
    r"favorable risk/reward",
    r"attractive valuation",
]

INDIRECT_PREFERENCE_PATTERNS = [
    r"prefer",
    r"lean",
    r"watch",
    r"interesting",
    r"constructive",
    r"positive",
]


def extract_assets_from_text(text: str) -> List[str]:
    found = set()
    lowered = text.lower()
    for hint, name in ASSET_HINTS.items():
        if hint in lowered:
            found.add(name)
    for match in re.findall(r"\(([A-Z]{1,5})\)", text):
        found.add(match)
    return sorted(found)


def infer_recommendation_level(text: str) -> str:
    lowered = text.lower()
    if any(re.search(pattern, lowered) for pattern in EXPLICIT_RECOMMEND_PATTERNS):
        return "明確推介"
    if any(re.search(pattern, lowered) for pattern in INDIRECT_PREFERENCE_PATTERNS):
        return "間接偏好"
    return "只有分析，未見明確推介"


def merge_assets(model_assets: Iterable[str], text_assets: Iterable[str]) -> List[str]:
    merged = {asset.strip() for asset in model_assets if asset and asset.strip()}
    merged.update(asset.strip() for asset in text_assets if asset and asset.strip())
    return sorted(merged)


def build_asset_rollup(analyses: List[ArticleAnalysis]) -> Dict[str, Dict[str, object]]:
    rollup: Dict[str, Dict[str, object]] = defaultdict(
        lambda: {
            "count": 0,
            "recommendation_levels": [],
            "reasons": [],
            "titles": [],
        }
    )
    for analysis in analyses:
        assets = analysis.mentioned_assets or analysis.recommended_assets
        for asset in assets:
            item = rollup[asset]
            item["count"] += 1
            item["titles"].append(analysis.title)
            if analysis.recommendation_level not in item["recommendation_levels"]:
                item["recommendation_levels"].append(analysis.recommendation_level)
            for reason in analysis.recommendation_reasons:
                if reason not in item["reasons"]:
                    item["reasons"].append(reason)
    return dict(rollup)

