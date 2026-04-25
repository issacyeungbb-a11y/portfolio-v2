from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Dict, List
from urllib.parse import quote

from app.config import Settings
from app.models import SourceEmail
from app.services.http import HttpClient


logger = logging.getLogger(__name__)


class GraphMailClient:
    def __init__(self, settings: Settings, http_client: HttpClient | None = None) -> None:
        self.settings = settings
        self.http = http_client or HttpClient(timeout=settings.llm_timeout_seconds)
        self._access_token = ""

    def _token_endpoint(self) -> str:
        return f"https://login.microsoftonline.com/{self.settings.graph_tenant_id}/oauth2/v2.0/token"

    def _get_access_token(self) -> str:
        if self._access_token:
            return self._access_token
        response = self.http.request(
            "POST",
            self._token_endpoint(),
            form_body={
                "client_id": self.settings.graph_client_id,
                "client_secret": self.settings.graph_client_secret,
                "grant_type": "refresh_token",
                "refresh_token": self.settings.graph_refresh_token,
                "scope": self.settings.graph_scope,
            },
        )
        token = response.get("access_token", "")
        if not token:
            raise RuntimeError("Unable to obtain Microsoft Graph access token.")
        self._access_token = token
        return token

    def _headers(self) -> Dict[str, str]:
        return {
            "Authorization": f"Bearer {self._get_access_token()}",
            "Accept": "application/json",
        }

    def _date_range_utc(self, target_date: datetime) -> tuple[str, str]:
        local_midnight = target_date.replace(hour=0, minute=0, second=0, microsecond=0)
        next_midnight = local_midnight + timedelta(days=1)
        start_utc = local_midnight.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
        end_utc = next_midnight.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
        return start_utc, end_utc

    def fetch_today_messages(self, target_date: datetime) -> List[SourceEmail]:
        start_utc, end_utc = self._date_range_utc(target_date)
        sender = self.settings.source_sender_email.replace("'", "''")
        filter_parts = [
            f"receivedDateTime ge {start_utc}",
            f"receivedDateTime lt {end_utc}",
            f"from/emailAddress/address eq '{sender}'",
        ]
        filter_query = quote(" and ".join(filter_parts), safe="=()'/:.- ")
        query = (
            f"{self.settings.graph_base_url}/me/messages"
            "?$select=id,internetMessageId,subject,receivedDateTime,webLink,from,body"
            "&$top=50"
            f"&$orderby=receivedDateTime asc&$filter={filter_query}"
        )
        payload = self.http.request("GET", query, headers=self._headers())
        messages = payload.get("value", [])
        results: List[SourceEmail] = []
        for message in messages:
            sender_info = message.get("from", {}).get("emailAddress", {})
            results.append(
                SourceEmail(
                    message_id=message.get("id", ""),
                    internet_message_id=message.get("internetMessageId", ""),
                    subject=message.get("subject", "").strip() or "(無標題)",
                    received_at=message.get("receivedDateTime", ""),
                    sender_email=sender_info.get("address", "").lower(),
                    sender_name=sender_info.get("name", ""),
                    body_text="",
                    body_html=message.get("body", {}).get("content", ""),
                    web_link=message.get("webLink", ""),
                )
            )
        logger.info("Fetched %s messages from Graph.", len(results))
        return results

    def send_mail(self, subject: str, body: str) -> None:
        if self.settings.disable_send:
            logger.warning("DISABLE_EMAIL_SEND enabled; skipping remote send.")
            return
        url = f"{self.settings.graph_base_url}/me/sendMail"
        payload = {
            "message": {
                "subject": subject,
                "body": {
                    "contentType": "Text",
                    "content": body,
                },
                "toRecipients": [
                    {
                        "emailAddress": {
                            "address": self.settings.recipient_email,
                        }
                    }
                ],
            },
            "saveToSentItems": True,
        }
        self.http.request("POST", url, headers=self._headers(), json_body=payload)
