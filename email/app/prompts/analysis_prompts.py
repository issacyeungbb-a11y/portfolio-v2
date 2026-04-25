from __future__ import annotations

import json
from typing import Dict, List


ARTICLE_SCHEMA: Dict[str, object] = {
    "type": "object",
    "properties": {
        "title": {"type": "string"},
        "received_at": {"type": "string"},
        "one_line_summary": {"type": "string"},
        "key_points": {"type": "array", "items": {"type": "string"}},
        "core_thesis": {"type": "string"},
        "mentioned_specific_assets": {"type": "boolean"},
        "mentioned_assets": {"type": "array", "items": {"type": "string"}},
        "recommendation_level": {
            "type": "string",
            "enum": ["明確推介", "間接偏好", "只有分析，未見明確推介"],
        },
        "recommended_assets": {"type": "array", "items": {"type": "string"}},
        "recommendation_reasons": {"type": "array", "items": {"type": "string"}},
        "supporting_rationale": {"type": "array", "items": {"type": "string"}},
        "risks_mentioned": {"type": "array", "items": {"type": "string"}},
        "worth_reading": {"type": "string", "enum": ["值得", "可略讀"]},
    },
    "required": [
        "title",
        "received_at",
        "one_line_summary",
        "key_points",
        "core_thesis",
        "mentioned_specific_assets",
        "mentioned_assets",
        "recommendation_level",
        "recommended_assets",
        "recommendation_reasons",
        "supporting_rationale",
        "risks_mentioned",
        "worth_reading",
    ],
}


def chunk_analysis_messages(chunk_text: str, article_title: str, received_at: str) -> List[Dict[str, str]]:
    return [
        {
            "role": "system",
            "content": (
                "你是一位嚴謹的投資內容分析助手。"
                "你會忽略頁腳、退訂、社交分享、按鈕、重複引用內容，只聚焦文章主體。"
                "請用繁體中文輸出 JSON。"
            ),
        },
        {
            "role": "user",
            "content": (
                f"文章標題：{article_title}\n"
                f"收件時間：{received_at}\n"
                "以下是文章其中一段內容，請先抽取這一段的核心觀點、資產、推介語氣、理據、風險。\n"
                "只輸出 JSON，格式如下："
                '{"chunk_summary":"","assets":[],"recommendation_signals":[],"risks":[],"reasons":[]}\n\n'
                f"{chunk_text}"
            ),
        },
    ]


def final_analysis_messages(article_title: str, received_at: str, cleaned_text: str, chunk_summaries: List[Dict[str, object]]) -> List[Dict[str, str]]:
    schema_text = json.dumps(ARTICLE_SCHEMA, ensure_ascii=False, indent=2)
    chunk_text = json.dumps(chunk_summaries, ensure_ascii=False)
    return [
        {
            "role": "system",
            "content": (
                "你是一位嚴謹的投資研究助理。"
                "任務是分析 Kenji 的文章內容，不能憑空補充未提及的投資結論。"
                "若文章只在分析某資產而沒有推介，必須輸出「只有分析，未見明確推介」。"
                "若文章有偏好但無直接買入語句，輸出「間接偏好」。"
                "若文章有配置、買入、持有、增持、低吸、看好等明顯意思，輸出「明確推介」。"
                "輸出必須是合法 JSON，不可加 markdown。"
            ),
        },
        {
            "role": "user",
            "content": (
                f"文章標題：{article_title}\n"
                f"收件時間：{received_at}\n"
                f"清洗後正文：\n{cleaned_text}\n\n"
                f"分段摘要：{chunk_text}\n\n"
                f"請根據以下 JSON Schema 輸出：\n{schema_text}"
            ),
        },
    ]

