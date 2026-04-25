from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Dict
from zoneinfo import ZoneInfo


def load_env_file(path: str = ".env") -> None:
    env_path = Path(path)
    if not env_path.exists():
        return
    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip("'").strip('"')
        os.environ.setdefault(key, value)


def _bool_env(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class Settings:
    timezone: ZoneInfo
    data_dir: Path
    output_dir: Path
    log_level: str
    sender_email: str
    recipient_email: str
    source_sender_email: str
    source_sender_name: str
    llm_provider: str
    llm_api_key: str
    llm_base_url: str
    llm_model: str
    llm_timeout_seconds: int
    llm_max_chunk_chars: int
    graph_client_id: str
    graph_client_secret: str
    graph_refresh_token: str
    graph_tenant_id: str
    graph_scope: str
    graph_base_url: str
    state_db_path: Path
    digest_backup_dir: Path
    disable_send: bool

    @classmethod
    def from_env(cls) -> "Settings":
        load_env_file()
        timezone_name = os.getenv("APP_TIMEZONE", "Asia/Hong_Kong")
        data_dir = Path(os.getenv("DATA_DIR", "var")).resolve()
        output_dir = Path(os.getenv("OUTPUT_DIR", str(data_dir / "output"))).resolve()
        state_db_path = Path(os.getenv("STATE_DB_PATH", str(data_dir / "state.sqlite3"))).resolve()
        digest_backup_dir = Path(
            os.getenv("DIGEST_BACKUP_DIR", str(output_dir / "digests"))
        ).resolve()
        return cls(
            timezone=ZoneInfo(timezone_name),
            data_dir=data_dir,
            output_dir=output_dir,
            log_level=os.getenv("LOG_LEVEL", "INFO"),
            sender_email=os.getenv("OUTLOOK_SENDER_EMAIL", "").strip(),
            recipient_email=os.getenv("DIGEST_RECIPIENT_EMAIL", "").strip(),
            source_sender_email=os.getenv("SOURCE_SENDER_EMAIL", "kenjiosone@substack.com").strip().lower(),
            source_sender_name=os.getenv("SOURCE_SENDER_NAME", "Kenji San from Kenji's Substack").strip(),
            llm_provider=os.getenv("LLM_PROVIDER", "gemini").strip().lower(),
            llm_api_key=os.getenv("LLM_API_KEY", os.getenv("GEMINI_API_KEY", "")).strip(),
            llm_base_url=os.getenv(
                "LLM_BASE_URL",
                os.getenv("GEMINI_BASE_URL", "https://generativelanguage.googleapis.com/v1beta"),
            ).rstrip("/"),
            llm_model=os.getenv("LLM_MODEL", os.getenv("GEMINI_MODEL", "gemini-3.1-pro-preview")).strip(),
            llm_timeout_seconds=int(os.getenv("LLM_TIMEOUT_SECONDS", os.getenv("GEMINI_TIMEOUT_SECONDS", "90"))),
            llm_max_chunk_chars=int(
                os.getenv("LLM_MAX_CHUNK_CHARS", os.getenv("GEMINI_MAX_CHUNK_CHARS", "12000"))
            ),
            graph_client_id=os.getenv("MS_GRAPH_CLIENT_ID", "").strip(),
            graph_client_secret=os.getenv("MS_GRAPH_CLIENT_SECRET", "").strip(),
            graph_refresh_token=os.getenv("MS_GRAPH_REFRESH_TOKEN", "").strip(),
            graph_tenant_id=os.getenv("MS_GRAPH_TENANT_ID", "consumers").strip(),
            graph_scope=os.getenv(
                "MS_GRAPH_SCOPE",
                "offline_access https://graph.microsoft.com/Mail.Read https://graph.microsoft.com/Mail.Send https://graph.microsoft.com/User.Read",
            ).strip(),
            graph_base_url=os.getenv("MS_GRAPH_BASE_URL", "https://graph.microsoft.com/v1.0").rstrip("/"),
            state_db_path=state_db_path,
            digest_backup_dir=digest_backup_dir,
            disable_send=_bool_env("DISABLE_EMAIL_SEND", False),
        )

    def validate(self) -> Dict[str, str]:
        missing = {}
        required = {
            "OUTLOOK_SENDER_EMAIL": self.sender_email,
            "DIGEST_RECIPIENT_EMAIL": self.recipient_email,
            "LLM_API_KEY": self.llm_api_key,
            "MS_GRAPH_CLIENT_ID": self.graph_client_id,
            "MS_GRAPH_CLIENT_SECRET": self.graph_client_secret,
            "MS_GRAPH_REFRESH_TOKEN": self.graph_refresh_token,
        }
        for key, value in required.items():
            if not value:
                missing[key] = "missing"
        return missing
