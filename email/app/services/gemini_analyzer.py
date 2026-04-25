from __future__ import annotations

import json
import logging
from typing import Any, Dict, List

from app.config import Settings
from app.models import ArticleAnalysis
from app.prompts.analysis_prompts import chunk_analysis_messages, final_analysis_messages
from app.services.asset_intelligence import extract_assets_from_text, infer_recommendation_level, merge_assets
from app.services.http import HttpClient


logger = logging.getLogger(__name__)


class GeminiAnalyzer:
    def __init__(self, settings: Settings, http_client: HttpClient | None = None) -> None:
        self.settings = settings
        self.http = http_client or HttpClient(timeout=settings.llm_timeout_seconds)

    def _generate_json(self, messages: List[Dict[str, str]]) -> Dict[str, Any]:
        url = (
            f"{self.settings.llm_base_url}/models/"
            f"{self.settings.llm_model}:generateContent?key={self.settings.llm_api_key}"
        )
        text_parts = []
        system_instruction = ""
        for message in messages:
            if message["role"] == "system":
                system_instruction = f"{system_instruction}\n{message['content']}".strip()
            else:
                text_parts.append(f"{message['role']}:\n{message['content']}")
        response = self.http.request(
            "POST",
            url,
            headers={"Content-Type": "application/json"},
            json_body={
                "systemInstruction": {
                    "parts": [{"text": system_instruction}],
                },
                "contents": [
                    {
                        "role": "user",
                        "parts": [{"text": "\n\n".join(text_parts)}],
                    }
                ],
                "generationConfig": {
                    "temperature": 0.2,
                    "responseMimeType": "application/json",
                },
            },
        )
        candidates = response.get("candidates", [])
        if not candidates:
            raise RuntimeError(f"Gemini returned no candidates: {response}")
        parts = candidates[0].get("content", {}).get("parts", [])
        content = "".join(part.get("text", "") for part in parts).strip()
        if not content:
            raise RuntimeError(f"Gemini returned empty content: {response}")
        return json.loads(content)

    def _chunk_text(self, text: str) -> List[str]:
        limit = max(4000, self.settings.llm_max_chunk_chars)
        if len(text) <= limit:
            return [text]
        chunks = []
        current = []
        current_len = 0
        for paragraph in text.split("\n\n"):
            if current_len + len(paragraph) + 2 > limit and current:
                chunks.append("\n\n".join(current))
                current = [paragraph]
                current_len = len(paragraph)
            else:
                current.append(paragraph)
                current_len += len(paragraph) + 2
        if current:
            chunks.append("\n\n".join(current))
        return chunks

    def analyze(self, title: str, received_at: str, cleaned_text: str) -> ArticleAnalysis:
        chunks = self._chunk_text(cleaned_text)
        chunk_summaries = []
        for chunk in chunks:
            chunk_summaries.append(self._generate_json(chunk_analysis_messages(chunk, title, received_at)))
        final = self._generate_json(
            final_analysis_messages(title, received_at, cleaned_text[:30000], chunk_summaries)
        )

        text_assets = extract_assets_from_text(cleaned_text)
        merged_assets = merge_assets(final.get("mentioned_assets", []), text_assets)
        recommendation_level = final.get("recommendation_level") or infer_recommendation_level(cleaned_text)
        recommended_assets = merge_assets(final.get("recommended_assets", []), [])

        if recommendation_level == "只有分析，未見明確推介":
            recommended_assets = []

        analysis = ArticleAnalysis(
            title=final.get("title", title),
            received_at=final.get("received_at", received_at),
            one_line_summary=final.get("one_line_summary", ""),
            key_points=list(final.get("key_points", []))[:5],
            core_thesis=final.get("core_thesis", ""),
            mentioned_specific_assets=bool(final.get("mentioned_specific_assets", bool(merged_assets))),
            mentioned_assets=merged_assets,
            recommendation_level=recommendation_level,
            recommended_assets=recommended_assets,
            recommendation_reasons=list(final.get("recommendation_reasons", []))[:8],
            supporting_rationale=list(final.get("supporting_rationale", []))[:8],
            risks_mentioned=list(final.get("risks_mentioned", []))[:6],
            worth_reading=final.get("worth_reading", "可略讀"),
            raw_json=final,
        )
        logger.info("Analyzed article '%s' with level=%s", analysis.title, analysis.recommendation_level)
        return analysis
