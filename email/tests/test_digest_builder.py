import unittest

from app.models import ArticleAnalysis
from app.services.digest_builder import build_digest


def sample_analysis(title: str, asset: str, level: str) -> ArticleAnalysis:
    return ArticleAnalysis(
        title=title,
        received_at="2026-04-19T08:00:00Z",
        one_line_summary="文章總結",
        key_points=["重點一", "重點二", "重點三"],
        core_thesis="核心論點",
        mentioned_specific_assets=True,
        mentioned_assets=[asset],
        recommendation_level=level,
        recommended_assets=[asset] if level != "只有分析，未見明確推介" else [],
        recommendation_reasons=["估值偏低"],
        supporting_rationale=["現金流改善"],
        risks_mentioned=["需求放緩"],
        worth_reading="值得",
    )


class DigestBuilderTest(unittest.TestCase):
    def test_multiple_articles_rollup(self) -> None:
        digest = build_digest(
            "2026-04-19",
            [
                sample_analysis("A", "Bitcoin", "明確推介"),
                sample_analysis("B", "Bitcoin", "間接偏好"),
                sample_analysis("C", "Gold", "只有分析，未見明確推介"),
            ],
        )
        self.assertIn("今日收到文章總數：3", digest.body)
        self.assertIn("Bitcoin", digest.body)
        self.assertIn("Gold", digest.body)
        self.assertEqual(digest.top_assets[0], "Bitcoin")

    def test_no_new_mail_digest(self) -> None:
        digest = build_digest("2026-04-19", [])
        self.assertIn("今天沒有收到 Kenji 的新文章", digest.body)
        self.assertEqual(digest.total_articles, 0)

    def test_email_format(self) -> None:
        digest = build_digest("2026-04-19", [sample_analysis("A", "Bitcoin", "明確推介")])
        self.assertTrue(digest.subject.startswith("【Kenji 每日文章摘要】"))
        self.assertIn("一、今日總覽", digest.body)
        self.assertIn("二、逐篇摘要", digest.body)
        self.assertIn("三、今日資產重點整理", digest.body)
        self.assertIn("四、今日必讀投資重點", digest.body)


if __name__ == "__main__":
    unittest.main()

