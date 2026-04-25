import unittest

from app.services.asset_intelligence import extract_assets_from_text, infer_recommendation_level, merge_assets


class AssetIntelligenceTest(unittest.TestCase):
    def test_asset_recognition(self) -> None:
        text = "Kenji likes Bitcoin, gold, and Nintendo (NTDOY), but is watching the USD."
        assets = extract_assets_from_text(text)
        self.assertIn("Bitcoin", assets)
        self.assertIn("Gold", assets)
        self.assertIn("NTDOY", assets)
        self.assertIn("USD", assets)

    def test_recommendation_level(self) -> None:
        self.assertEqual(infer_recommendation_level("We should allocate more to gold here."), "明確推介")
        self.assertEqual(infer_recommendation_level("I prefer Japanese banks over defensives."), "間接偏好")
        self.assertEqual(infer_recommendation_level("This note analyzes oil demand."), "只有分析，未見明確推介")

    def test_merge_assets(self) -> None:
        self.assertEqual(merge_assets(["Bitcoin"], ["Gold", "Bitcoin"]), ["Bitcoin", "Gold"])


if __name__ == "__main__":
    unittest.main()

