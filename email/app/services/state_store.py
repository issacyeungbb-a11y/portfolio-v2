from __future__ import annotations

import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Optional


class StateStore:
    def __init__(self, db_path: Path) -> None:
        self.db_path = db_path
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._initialize()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _initialize(self) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS processed_emails (
                    message_id TEXT PRIMARY KEY,
                    internet_message_id TEXT,
                    digest_date TEXT NOT NULL,
                    received_at TEXT NOT NULL,
                    processed_at TEXT NOT NULL
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS app_state (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                )
                """
            )
            conn.commit()

    def has_processed(self, message_id: str) -> bool:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT 1 FROM processed_emails WHERE message_id = ?",
                (message_id,),
            ).fetchone()
            return row is not None

    def mark_processed(
        self,
        message_id: str,
        internet_message_id: str,
        digest_date: str,
        received_at: str,
    ) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                INSERT OR REPLACE INTO processed_emails (
                    message_id, internet_message_id, digest_date, received_at, processed_at
                ) VALUES (?, ?, ?, ?, ?)
                """,
                (
                    message_id,
                    internet_message_id,
                    digest_date,
                    received_at,
                    datetime.utcnow().isoformat(),
                ),
            )
            conn.commit()

    def get_state(self, key: str) -> Optional[str]:
        with self._connect() as conn:
            row = conn.execute("SELECT value FROM app_state WHERE key = ?", (key,)).fetchone()
            return None if row is None else str(row["value"])

    def set_state(self, key: str, value: str) -> None:
        with self._connect() as conn:
            conn.execute(
                "INSERT OR REPLACE INTO app_state (key, value) VALUES (?, ?)",
                (key, value),
            )
            conn.commit()

    def was_digest_sent(self, digest_date: str) -> bool:
        return self.get_state("last_successful_digest_date") == digest_date

    def record_run_success(self, digest_date: str, send_status: str) -> None:
        now = datetime.utcnow().isoformat()
        self.set_state("last_successful_run_time", now)
        self.set_state("last_successful_digest_date", digest_date)
        self.set_state("last_send_status", send_status)
        self.set_state("last_error_message", "")

    def record_failure(self, error_message: str) -> None:
        self.set_state("last_error_message", error_message[:1000])
        self.set_state("last_send_status", "failed")

