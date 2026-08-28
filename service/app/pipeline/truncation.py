from __future__ import annotations

import re
from dataclasses import dataclass

from app.pipeline.tier1 import ParsedPage

_BOT_WALL = re.compile(
    r"(enable javascript|please verify you are a human|are you a robot|px-captcha|access denied"
    r"|unusual traffic|cf-browser-verification|challenge-platform|distil_r_captcha)",
    re.IGNORECASE,
)
_PRICE_HINT = re.compile(r"(₹|\$|€|£|\bper night\b|\bnight\b|price|from\s*[₹$])", re.IGNORECASE)


@dataclass
class TruncationVerdict:
    truncated: bool
    reasons: list[str]
    score: int


def detect_truncation(page: ParsedPage) -> TruncationVerdict:
    reasons: list[str] = []
    score = 0

    if page.status >= 400:
        reasons.append(f"HTTP {page.status}")
        score += 3
    if page.bytes < 20_000:
        reasons.append(f"tiny document ({page.bytes} bytes)")
        score += 2
    if _BOT_WALL.search(page.html):
        reasons.append("bot-wall / JS-challenge markers present")
        score += 3

    structured = (
        any(
            isinstance(x, dict)
            and re.search(
                r"Hotel|Lodging|Product|Place|Accommodation|Apartment|House|Room",
                str(x.get("@type", "")),
            )
            for x in page.json_ld
        )
        or bool(page.embedded_json)
    )

    h = page.hints
    if (
        structured
        and not h.price_candidates
        and h.person_capacity is None
        and not _PRICE_HINT.search(page.text_excerpt)
    ):
        reasons.append("structured data has no price / capacity — likely JS-rendered")
        score += 2

    if not structured:
        if len(page.open_graph) < 3:
            reasons.append("no JSON-LD / __NEXT_DATA__ / rich OpenGraph")
            score += 2
        if len(page.image_urls) < 3:
            reasons.append(f"few images found ({len(page.image_urls)})")
            score += 2
        if len(page.text_excerpt) < 1500:
            reasons.append(f"sparse visible text ({len(page.text_excerpt)} chars)")
            score += 2
        if not _PRICE_HINT.search(page.text_excerpt):
            reasons.append("no price signal in visible text")
            score += 1

    return TruncationVerdict(truncated=score >= 3, reasons=reasons, score=score)
