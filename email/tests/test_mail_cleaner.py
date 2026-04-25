from pathlib import Path
import unittest

from app.services.mail_cleaner import clean_email_body


class MailCleanerTest(unittest.TestCase):
    def test_cleans_footer_and_keeps_main_content(self) -> None:
        html = Path("tests/fixtures/sample_email.html").read_text(encoding="utf-8")
        cleaned = clean_email_body(html)

        self.assertIn("Why Japanese small caps still look cheap", cleaned)
        self.assertIn("Read full article (https://example.com/full-article)", cleaned)
        self.assertNotIn("Unsubscribe", cleaned)
        self.assertNotIn("Share this post", cleaned)


if __name__ == "__main__":
    unittest.main()

