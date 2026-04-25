import tempfile
import unittest
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from app.config import Settings
from app.models import ArticleAnalysis, SourceEmail
from app.services.mail_sender import MailSender
from app.services.orchestrator import DigestOrchestrator
from app.services.state_store import StateStore


class FakeMailClient:
    def __init__(self, emails):
        self.emails = emails
        self.sent = []

    def fetch_today_messages(self, target_date):
        return self.emails

    def send_mail(self, subject, body):
        self.sent.append((subject, body))


class FakeAnalyzer:
    def analyze(self, title, received_at, cleaned_text):
        return ArticleAnalysis(
            title=title,
            received_at=received_at,
            one_line_summary="一句總結",
            key_points=["重點一", "重點二", "重點三"],
            core_thesis="核心論點",
            mentioned_specific_assets=True,
            mentioned_assets=["Bitcoin"],
            recommendation_level="明確推介",
            recommended_assets=["Bitcoin"],
            recommendation_reasons=["估值偏低"],
            supporting_rationale=["資金流入"],
            risks_mentioned=["波動高"],
            worth_reading="值得",
        )


class FlakyMailClient(FakeMailClient):
    def __init__(self):
        super().__init__([])
        self.attempts = 0

    def send_mail(self, subject, body):
        self.attempts += 1
        if self.attempts == 1:
            raise RuntimeError("temporary failure")
        self.sent.append((subject, body))


class OrchestratorTest(unittest.TestCase):
    def _settings(self, root: Path) -> Settings:
        return Settings(
            timezone=ZoneInfo("Asia/Hong_Kong"),
            data_dir=root,
            output_dir=root / "output",
            log_level="INFO",
            sender_email="me@example.com",
            recipient_email="me@example.com",
            source_sender_email="kenjiosone@substack.com",
            source_sender_name="Kenji",
            llm_provider="gemini",
            llm_api_key="test",
            llm_base_url="https://generativelanguage.googleapis.com/v1beta",
            llm_model="gemini-3.1-pro-preview",
            llm_timeout_seconds=10,
            llm_max_chunk_chars=1000,
            graph_client_id="client",
            graph_client_secret="secret",
            graph_refresh_token="refresh",
            graph_tenant_id="consumers",
            graph_scope="scope",
            graph_base_url="https://graph.microsoft.com/v1.0",
            state_db_path=root / "state.sqlite3",
            digest_backup_dir=root / "output" / "digests",
            disable_send=False,
        )

    def test_no_new_mail_still_sends_notification(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            settings = self._settings(Path(tmp))
            state = StateStore(settings.state_db_path)
            mail_client = FakeMailClient([])
            sender = MailSender(mail_client, settings.digest_backup_dir)
            orchestrator = DigestOrchestrator(settings, state, mail_client, FakeAnalyzer(), sender)

            result = orchestrator.run(datetime.now())

            self.assertEqual(result, "sent")
            self.assertEqual(len(mail_client.sent), 1)
            self.assertIn("今天沒有收到 Kenji 的新文章", mail_client.sent[0][1])

    def test_duplicate_emails_are_skipped(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            settings = self._settings(Path(tmp))
            state = StateStore(settings.state_db_path)
            email = SourceEmail(
                message_id="abc",
                internet_message_id="internet-abc",
                subject="Hello",
                received_at="2026-04-19T08:00:00Z",
                sender_email="kenjiosone@substack.com",
                sender_name="Kenji",
                body_text="",
                body_html="<p>Bitcoin looks attractive.</p>",
                web_link="",
            )
            state.mark_processed(email.message_id, email.internet_message_id, "2026-04-19", email.received_at)
            mail_client = FakeMailClient([email])
            sender = MailSender(mail_client, settings.digest_backup_dir)
            orchestrator = DigestOrchestrator(settings, state, mail_client, FakeAnalyzer(), sender)

            orchestrator.run(datetime(2026, 4, 19))

            self.assertEqual(len(mail_client.sent), 1)
            self.assertIn("今天沒有收到 Kenji 的新文章", mail_client.sent[0][1])

    def test_send_retry_and_backup_logic(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            settings = self._settings(Path(tmp))
            client = FlakyMailClient()
            sender = MailSender(client, settings.digest_backup_dir)
            digest = type("Digest", (), {"subject": "s", "body": "b", "date_label": "2026-04-19"})()

            status = sender.send_digest(digest)

            self.assertEqual(status, "sent")
            self.assertEqual(client.attempts, 2)


if __name__ == "__main__":
    unittest.main()
