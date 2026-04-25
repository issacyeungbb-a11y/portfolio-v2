from __future__ import annotations

import argparse
import logging
from datetime import datetime

from app.config import Settings
from app.logger import configure_logging
from app.services.gemini_analyzer import GeminiAnalyzer
from app.services.graph_mail import GraphMailClient
from app.services.http import HttpClient
from app.services.mail_sender import MailSender
from app.services.orchestrator import DigestOrchestrator
from app.services.state_store import StateStore


logger = logging.getLogger(__name__)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Kenji daily email digest system")
    subparsers = parser.add_subparsers(dest="command", required=True)

    run_parser = subparsers.add_parser("run", help="Fetch, analyze and send digest")
    run_parser.add_argument("--date", help="Target date in YYYY-MM-DD; defaults to today in app timezone")
    run_parser.add_argument("--force", action="store_true", help="Force rerun even if digest was already sent")

    check_parser = subparsers.add_parser("check-config", help="Validate environment configuration")
    check_parser.add_argument("--show", action="store_true", help="Print basic non-secret settings")
    return parser


def main() -> int:
    args = build_parser().parse_args()
    settings = Settings.from_env()
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    settings.output_dir.mkdir(parents=True, exist_ok=True)
    configure_logging(settings.log_level, settings.data_dir / "logs")

    if args.command == "check-config":
        missing = settings.validate()
        if args.show:
            print(
                {
                    "timezone": str(settings.timezone),
                    "recipient_email": settings.recipient_email,
                    "sender_email": settings.sender_email,
                    "source_sender_email": settings.source_sender_email,
                    "llm_provider": settings.llm_provider,
                    "llm_model": settings.llm_model,
                    "state_db_path": str(settings.state_db_path),
                }
            )
        if missing:
            print(f"Missing required environment variables: {', '.join(sorted(missing))}")
            return 1
        print("Configuration looks valid.")
        return 0

    missing = settings.validate()
    if missing:
        print(f"Missing required environment variables: {', '.join(sorted(missing))}")
        return 1

    target_date = (
        datetime.strptime(args.date, "%Y-%m-%d").replace(tzinfo=settings.timezone)
        if args.date
        else datetime.now(settings.timezone)
    )
    http_client = HttpClient(timeout=settings.llm_timeout_seconds)
    orchestrator = DigestOrchestrator(
        settings=settings,
        state_store=StateStore(settings.state_db_path),
        mail_client=GraphMailClient(settings, http_client=http_client),
        analyzer=GeminiAnalyzer(settings, http_client=http_client),
        sender=MailSender(GraphMailClient(settings, http_client=http_client), settings.digest_backup_dir),
    )
    try:
        result = orchestrator.run(target_date=target_date, force=args.force)
        print(f"Run result: {result}")
        return 0
    except Exception as exc:
        StateStore(settings.state_db_path).record_failure(str(exc))
        logger.exception("Run failed")
        print(f"Run failed: {exc}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
