from __future__ import annotations

from collections import Counter
from typing import List

from app.models import ArticleAnalysis, DailyDigest
from app.services.asset_intelligence import build_asset_rollup


def _overall_theme(analyses: List[ArticleAnalysis]) -> str:
    phrases = [analysis.core_thesis for analysis in analyses if analysis.core_thesis]
    if not phrases:
        return "今天未有文章，因此沒有整體主題。"
    return phrases[0] if len(phrases) == 1 else "；".join(phrases[:2])


def _top_assets(analyses: List[ArticleAnalysis]) -> List[str]:
    counts = Counter()
    for analysis in analyses:
        counts.update(analysis.recommended_assets or analysis.mentioned_assets)
    return [name for name, _ in counts.most_common(3)]


def build_digest(date_label: str, analyses: List[ArticleAnalysis]) -> DailyDigest:
    if not analyses:
        subject = f"【Kenji 每日文章摘要】{date_label}"
        body = (
            "一、今日總覽\n"
            "- 今日收到文章總數：0\n"
            "- 今日整體主題：今天沒有收到 Kenji 的新文章\n"
            "- 今日是否有明確推介資產：否\n"
            "- 今日最值得關注的資產：無\n"
            "- 今日最重要的一篇文章：無\n\n"
            "二、逐篇摘要\n"
            "今天沒有收到 Kenji 的新文章。\n\n"
            "三、今日資產重點整理\n"
            "今天未有明確推介資產。\n\n"
            "四、今日必讀投資重點\n"
            "今天沒有收到 Kenji 的新文章，暫時沒有新的投資重點需要跟進。"
        )
        return DailyDigest(
            subject=subject,
            body=body,
            date_label=date_label,
            total_articles=0,
            overall_theme="今天沒有收到 Kenji 的新文章",
            has_explicit_recommendation=False,
            top_assets=[],
            top_article_title="",
            asset_rollup={},
        )

    rollup = build_asset_rollup(analyses)
    top_assets = _top_assets(analyses)
    top_article = analyses[0].title
    has_explicit = any(item.recommendation_level == "明確推介" for item in analyses)

    lines = [
        "一、今日總覽",
        f"- 今日收到文章總數：{len(analyses)}",
        f"- 今日整體主題：{_overall_theme(analyses)}",
        f"- 今日是否有明確推介資產：{'有' if has_explicit else '沒有'}",
        f"- 今日最值得關注的資產：{', '.join(top_assets) if top_assets else '無'}",
        f"- 今日最重要的一篇文章：{top_article}",
        "",
        "二、逐篇摘要",
    ]

    for idx, analysis in enumerate(analyses, start=1):
        lines.extend(
            [
                f"{idx}. 標題：{analysis.title}",
                f"收件時間：{analysis.received_at}",
                f"一句總結：{analysis.one_line_summary}",
                "三至五個重點：",
                *[f"- {point}" for point in analysis.key_points],
                f"核心論點：{analysis.core_thesis}",
                f"提及資產：{', '.join(analysis.mentioned_assets) if analysis.mentioned_assets else '無'}",
                f"推介判斷：{analysis.recommendation_level}",
                f"推介原因：{'; '.join(analysis.recommendation_reasons) if analysis.recommendation_reasons else '無明確推介原因'}",
                f"風險提示：{'; '.join(analysis.risks_mentioned) if analysis.risks_mentioned else '文中未明確提及'}",
                f"是否值得細讀：{analysis.worth_reading}",
                "",
            ]
        )

    lines.extend(["三、今日資產重點整理"])
    if top_assets:
        lines.append(f"- 今日提及過的所有資產清單：{', '.join(sorted(rollup.keys()))}")
        lines.append(f"- 今日最值得關注的資產：{', '.join(top_assets)}")
        reasons = []
        for asset in top_assets:
            reasons.extend(rollup.get(asset, {}).get("reasons", []))
        lines.append(f"- Kenji 推介它的核心原因：{'; '.join(reasons[:5]) if reasons else '文中未給出明確原因'}")
    else:
        lines.append("今天未有明確推介資產。")

    lines.extend(["", "四、今日必讀投資重點"])
    if top_assets:
        for analysis in analyses[:5]:
            focus_assets = analysis.recommended_assets or analysis.mentioned_assets
            target = "、".join(focus_assets) if focus_assets else analysis.title
            reason = analysis.recommendation_reasons[0] if analysis.recommendation_reasons else analysis.core_thesis
            lines.append(f"- {target}：{reason}")
    else:
        lines.append("- 今天未有值得跟進的明確推介資產。")

    return DailyDigest(
        subject=f"【Kenji 每日文章摘要】{date_label}",
        body="\n".join(lines),
        date_label=date_label,
        total_articles=len(analyses),
        overall_theme=_overall_theme(analyses),
        has_explicit_recommendation=has_explicit,
        top_assets=top_assets,
        top_article_title=top_article,
        asset_rollup=rollup,
    )

