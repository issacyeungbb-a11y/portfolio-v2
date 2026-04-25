from __future__ import annotations

import logging
from pathlib import Path

from app.models import DailyDigest
from app.services.graph_mail import GraphMailClient


logger = logging.getLogger(__name__)


class MailSender:
    def __init__(self, client: GraphMailClient, backup_dir: Path) -> None:
        self.client = client
        self.backup_dir = backup_dir
        self.backup_dir.mkdir(parents=True, exist_ok=True)

    def send_digest(self, digest: DailyDigest) -> str:
        last_error = None
        for attempt in range(1, 3):
            try:
                self.client.send_mail(digest.subject, digest.body)
                logger.info("Digest sent on attempt %s", attempt)
                return "sent"
            except Exception as exc:  # pragma: no cover - exercised via tests through stubs
                last_error = exc
                logger.exception("Send attempt %s failed", attempt)
        backup_file = self.backup_dir / f"digest-{digest.date_label}.txt"
        backup_file.write_text(f"{digest.subject}\n\n{digest.body}", encoding="utf-8")
        raise RuntimeError(
            f"Digest email failed after retry. Backup written to {backup_file}. Last error: {last_error}"
        ) from last_error

