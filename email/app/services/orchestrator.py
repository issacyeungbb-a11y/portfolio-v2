from __future__ import annotations

import logging
from datetime import datetime
from typing import List

from app.config import Settings
from app.models import ArticleAnalysis, SourceEmail
from app.services.digest_builder import build_digest
from app.services.graph_mail import GraphMailClient
from app.services.mail_cleaner import clean_email_body
from app.services.mail_sender import MailSender
from app.services.state_store import StateStore


logger = logging.getLogger(__name__)


class DigestOrchestrator:
    def __init__(
        self,
        settings: Settings,
        state_store: StateStore,
        mail_client: GraphMailClient,
        analyzer,
        sender: MailSender,
    ) -> None:
        self.settings = settings
        self.state_store = state_store
        self.mail_client = mail_client
        self.analyzer = analyzer
        self.sender = sender

    def _filter_unprocessed(self, emails: List[SourceEmail]) -> List[SourceEmail]:
        return [email for email in emails if not self.state_store.has_processed(email.message_id)]

    def run(self, target_date: datetime, force: bool = False) -> str:
        digest_date = target_date.strftime("%Y-%m-%d")
        if self.state_store.was_digest_sent(digest_date) and not force:
            logger.info("Digest for %s already sent; skipping.", digest_date)
            return "skipped:already_sent"

        emails = self.mail_client.fetch_today_messages(target_date)
        emails = self._filter_unprocessed(emails) if not force else emails
        analyses: List[ArticleAnalysis] = []

        for email in emails:
            cleaned = clean_email_body(email.body_html, email.body_text)
            if not cleaned.strip():
                logger.warning("Email %s became empty after cleaning.", email.message_id)
                continue
            analysis = self.analyzer.analyze(email.subject, email.received_at, cleaned)
            analyses.append(analysis)
            self.state_store.mark_processed(
                email.message_id,
                email.internet_message_id,
                digest_date,
                email.received_at,
            )

        digest = build_digest(digest_date, analyses)
        send_status = self.sender.send_digest(digest)
        self.state_store.record_run_success(digest_date, send_status)
        logger.info("Run completed for %s with %s articles.", digest_date, len(analyses))
        return send_status
