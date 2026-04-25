from __future__ import annotations

import json
import logging
from typing import Any, Dict, Optional
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


logger = logging.getLogger(__name__)


class HttpClient:
    def __init__(self, timeout: int = 90) -> None:
        self.timeout = timeout

    def request(
        self,
        method: str,
        url: str,
        headers: Optional[Dict[str, str]] = None,
        json_body: Optional[Dict[str, Any]] = None,
        form_body: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        payload = None
        request_headers = headers.copy() if headers else {}
        if json_body is not None:
            payload = json.dumps(json_body).encode("utf-8")
            request_headers["Content-Type"] = "application/json"
        elif form_body is not None:
            payload = urlencode(form_body).encode("utf-8")
            request_headers["Content-Type"] = "application/x-www-form-urlencoded"

        request = Request(url=url, data=payload, headers=request_headers, method=method.upper())
        try:
            with urlopen(request, timeout=self.timeout) as response:
                charset = response.headers.get_content_charset() or "utf-8"
                raw = response.read().decode(charset)
                if not raw.strip():
                    return {}
                return json.loads(raw)
        except HTTPError as exc:
            body = exc.read().decode("utf-8", errors="ignore")
            logger.error("HTTP request failed: %s %s %s", method, url, body[:500])
            raise RuntimeError(f"HTTP {exc.code} calling {url}: {body[:500]}") from exc
        except URLError as exc:
            logger.error("Network request failed: %s %s %s", method, url, exc)
            raise RuntimeError(f"Network error calling {url}: {exc}") from exc

