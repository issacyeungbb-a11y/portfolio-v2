from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List


@dataclass
class SourceEmail:
    message_id: str
    internet_message_id: str
    subject: str
    received_at: str
    sender_email: str
    sender_name: str
    body_text: str
    body_html: str
    web_link: str


@dataclass
class ArticleAnalysis:
    title: str
    received_at: str
    one_line_summary: str
    key_points: List[str]
    core_thesis: str
    mentioned_specific_assets: bool
    mentioned_assets: List[str]
    recommendation_level: str
    recommended_assets: List[str]
    recommendation_reasons: List[str]
    supporting_rationale: List[str]
    risks_mentioned: List[str]
    worth_reading: str
    raw_json: Dict[str, object] = field(default_factory=dict)


@dataclass
class DailyDigest:
    subject: str
    body: str
    date_label: str
    total_articles: int
    overall_theme: str
    has_explicit_recommendation: bool
    top_assets: List[str]
    top_article_title: str
    asset_rollup: Dict[str, Dict[str, object]]

