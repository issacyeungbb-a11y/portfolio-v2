from __future__ import annotations

import html
import re
from html.parser import HTMLParser
from typing import List


FOOTER_PATTERNS = [
    r"unsubscribe",
    r"manage preferences",
    r"view in browser",
    r"share this post",
    r"substack",
    r"facebook",
    r"twitter",
    r"linkedin",
    r"instagram",
    r"tiktok",
    r"threads",
    r"podcast",
]

QUOTE_PATTERNS = [
    r"^on .+ wrote:$",
    r"^from:.+$",
    r"^sent:.+$",
    r"^subject:.+$",
]


class _HTMLTextExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.parts: List[str] = []
        self.current_href = ""

    def handle_starttag(self, tag: str, attrs) -> None:
        attrs_dict = dict(attrs)
        if tag == "a":
            self.current_href = attrs_dict.get("href", "")
        elif tag in {"p", "div", "br", "li", "h1", "h2", "h3"}:
            self.parts.append("\n")

    def handle_data(self, data: str) -> None:
        text = data.strip()
        if text:
            self.parts.append(text)
            if self.current_href:
                self.parts.append(f" ({self.current_href})")

    def handle_endtag(self, tag: str) -> None:
        if tag == "a":
            self.current_href = ""
        elif tag in {"p", "div", "li"}:
            self.parts.append("\n")

    def get_text(self) -> str:
        return "".join(self.parts)


def html_to_text(body_html: str) -> str:
    parser = _HTMLTextExtractor()
    parser.feed(body_html)
    return html.unescape(parser.get_text())


def clean_email_body(body_html: str, fallback_text: str = "") -> str:
    raw_text = html_to_text(body_html) if body_html.strip() else fallback_text
    raw_text = raw_text.replace("\r\n", "\n").replace("\r", "\n")
    raw_text = re.sub(r"\n{3,}", "\n\n", raw_text)

    cleaned_lines: List[str] = []
    seen = set()
    for line in raw_text.splitlines():
        stripped = re.sub(r"\s+", " ", line).strip(" \t-")
        if not stripped:
            if cleaned_lines and cleaned_lines[-1]:
                cleaned_lines.append("")
            continue

        lower = stripped.lower()
        if any(re.search(pattern, lower) for pattern in FOOTER_PATTERNS):
            continue
        if any(re.search(pattern, lower) for pattern in QUOTE_PATTERNS):
            break
        if len(stripped) <= 2:
            continue
        if stripped in seen:
            continue
        seen.add(stripped)
        cleaned_lines.append(stripped)

    text = "\n".join(cleaned_lines)
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    return text

