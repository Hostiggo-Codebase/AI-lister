from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urljoin

import httpx
from selectolax.parser import HTMLParser

from app.config import settings

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)

_JUNK_IMAGE = re.compile(
    r"(platform-assets|platformassets|search-bar-icons|userprofile|user_|profile_|avatar"
    r"|[/-]icons?[/-]|sprite|[/-]logo|maps\.googleapis|pinimg|fbcdn|analytics)",
    re.IGNORECASE,
)
_IMG_URL = re.compile(
    r"https?:\\?/\\?/[^\s\"'<>()]+?\.(?:jpe?g|png|webp|avif)(?:\?[^\s\"'<>()]*)?", re.IGNORECASE
)
_PRICE = re.compile(r"(₹|Rs\.?|INR|\$|USD|EUR|€|£)\s?([\d,]{2,})", re.IGNORECASE)
_STOP_DESC = re.compile(
    r"(What this place offers|Where you'?ll sleep|Meet your [Hh]ost|Things to know|House rules"
    r"|Safety & property|Cancellation policy|Show all \d+ reviews|·\s*\d+ reviews|\d+ reviews\b"
    r"|\bRare find\b|Availability|Select check-?in|Report this listing|Show all photos"
    r"|Guest favou?rite"
    r"|\n(?:January|February|March|April|May|June|July|August|September|October|November|December)"
    r" \d{4}\b)"
)


@dataclass
class PageHints:
    price_candidates: list[dict] = field(default_factory=list)
    person_capacity: int | None = None
    bedrooms: int | None = None
    beds: int | None = None
    bathrooms: float | None = None
    amenity_names: list[str] = field(default_factory=list)
    lat: float | None = None
    lng: float | None = None
    city: str | None = None
    long_description: str | None = None
    description_parts: list[str] = field(default_factory=list)


@dataclass
class ParsedPage:
    html: str
    bytes: int
    final_url: str
    status: int
    title: str | None
    json_ld: list[Any]
    open_graph: dict[str, str]
    meta: dict[str, str]
    embedded_json: list[Any]
    image_urls: list[str]
    text_excerpt: str
    hints: PageHints


async def tier1_fetch(url: str) -> ParsedPage:
    async with httpx.AsyncClient(
        follow_redirects=True,
        timeout=settings.import_fetch_timeout_s,
        headers={
            "user-agent": UA,
            "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "accept-language": "en-IN,en;q=0.9",
        },
    ) as client:
        r = await client.get(url)
        return parse_html(r.text, str(r.url) or url, r.status_code)


def _num(v: Any) -> float | None:
    try:
        if isinstance(v, (int, float)):
            return float(v)
        s = re.sub(r"[^\d.]", "", str(v))
        return float(s) if s else None
    except (TypeError, ValueError):
        return None


def _walk(node: Any, visit, depth: int = 0) -> None:
    if depth > 8 or node is None:
        return
    if isinstance(node, list):
        for v in node:
            _walk(v, visit, depth + 1)
    elif isinstance(node, dict):
        for k, v in node.items():
            visit(k, v)
            _walk(v, visit, depth + 1)


def _collect_images(s: str, sink: set[str]) -> None:
    for m in _IMG_URL.finditer(s):
        sink.add(m.group(0).replace("\\/", "/"))


def _extract_hints(sources: list[Any], text: str) -> PageHints:
    h = PageHints()
    amenities: set[str] = set()
    seen_price: set[str] = set()
    desc_parts: dict[str, str] = {}

    def visit(key: str, value: Any) -> None:
        k = key.lower()
        if re.search(r"personcapacity|maxguest|max_occupancy|guestcount|sleeps", k):
            n = _num(value)
            if n and 1 <= n <= 60 and h.person_capacity is None:
                h.person_capacity = int(n)
        elif re.search(r"^bedrooms?$|bedroomcount|numberofrooms", k):
            n = _num(value)
            if n is not None and n <= 30 and h.bedrooms is None:
                h.bedrooms = int(n)
        elif re.search(r"^beds?$|bedcount", k):
            n = _num(value)
            if n is not None and n <= 60 and h.beds is None:
                h.beds = int(n)
        elif re.search(r"bathroom|bathcount", k):
            n = _num(value)
            if n is not None and 0 < n <= 30 and h.bathrooms is None:
                h.bathrooms = n
        elif re.search(r"latitude|^lat$", k):
            n = _num(value)
            if n is not None and -90 <= n <= 90 and h.lat is None:
                h.lat = n
        elif re.search(r"longitude|^lng$|^lon$", k):
            n = _num(value)
            if n is not None and -180 <= n <= 180 and h.lng is None:
                h.lng = n
        elif re.search(r"(^city$|addresslocality|cityname|localizedcity)", k) and isinstance(
            value, str
        ):
            if len(value) < 60 and h.city is None:
                h.city = value
        elif (
            isinstance(value, str)
            and 120 <= len(value) <= 12000
            and re.search(
                r"description|htmldescription|localizeddescription|summary|space|neighbou?rhood"
                r"|getting_?around|access|notes|the_?space|guest_?access|other_?things|about",
                k,
            )
            and not value.lstrip().startswith(("[", "{"))
            and re.search(r"[.!?]", value)
        ):
            cleaned = re.sub(r"<br\s*/?>", "\n", value)
            cleaned = re.sub(r"<[^>]+>", "", cleaned).replace("\\n", "\n")
            cleaned = re.sub(r"[ \t]+", " ", cleaned).strip()
            if len(cleaned) >= 120:
                desc_parts[cleaned[:200]] = cleaned
        elif re.search(r"amenit", k) and isinstance(value, list):
            for a in value:
                if isinstance(a, str):
                    amenities.add(a)
                elif isinstance(a, dict):
                    nm = a.get("name") or a.get("title")
                    if isinstance(nm, str):
                        amenities.add(nm)
        elif re.fullmatch(
            r"price|pricerange|baseprice|base_price|amount|nightlyprice|rate|priceperbight"
            r"|price_per_night|nightly_price",
            k,
        ) and (_num(value) or 0) >= 300:
            amount = float(_num(value))
            sig = f"{amount}-INR"
            if sig not in seen_price:
                seen_price.add(sig)
                h.price_candidates.append({"amount": amount, "currency": "INR", "context": key})
        elif (
            isinstance(value, str)
            and _PRICE.search(value)
            and re.search(r"price|rate|night|total|amount|display", k)
        ):
            m = _PRICE.search(value)
            if m:
                amount = float(m.group(2).replace(",", ""))
                cur = (
                    "INR"
                    if re.search(r"₹|rs|inr", m.group(1), re.IGNORECASE)
                    else "USD"
                    if re.search(r"\$|usd", m.group(1), re.IGNORECASE)
                    else "EUR"
                    if re.search(r"€|eur", m.group(1), re.IGNORECASE)
                    else "GBP"
                )
                sig = f"{amount}-{cur}"
                if amount >= 100 and sig not in seen_price:
                    seen_price.add(sig)
                    h.price_candidates.append({"amount": amount, "currency": cur, "context": key})

    for src in sources:
        _walk(src, visit)

    for pat in (
        r"(₹|Rs\.?|INR)\s?([\d,]{3,})",
        r"([\d,]{3,})\s*(?:per night|/ ?night|a night|nightly)",
    ):
        for m in re.finditer(pat, text, re.IGNORECASE):
            amount = float(m.groups()[-1].replace(",", ""))
            sig = f"{amount}-INR"
            if amount >= 300 and sig not in seen_price:
                seen_price.add(sig)
                h.price_candidates.append(
                    {"amount": amount, "currency": "INR", "context": "visible-text"}
                )

    h.amenity_names = list(amenities)[:80]

    parts = sorted(desc_parts.values(), key=len, reverse=True)
    kept: list[str] = []
    for p in parts:
        if any(p in k or k in p for k in kept):
            continue
        kept.append(p)
        if len("\n\n".join(kept)) > 6000:
            break
    assembled = "\n\n".join(kept) if kept else None

    anchor = (assembled or "")[:60].strip()
    if not anchor:
        m = re.search(r"[A-Z][^.!?]{40,120}[.!?]", text)
        anchor = m.group(0) if m else ""
    if anchor:
        start = text.find(anchor[:40])
        if start > -1:
            rest = text[start:]
            m = _STOP_DESC.search(rest)
            region = (rest[: m.start()] if (m and m.start() > 200) else rest[:3500]).strip()
            region = re.sub(r"\s*\bShow more\b\s*$", "", region, flags=re.IGNORECASE)
            region = re.sub(r"[ \t]+", " ", region)
            region = re.sub(r"\n{3,}", "\n\n", region).strip()
            if len(region) > len(assembled or ""):
                assembled = region

    h.long_description = assembled
    h.description_parts = kept if kept else ([assembled] if assembled else [])
    return h


def parse_html(html: str, final_url: str, status: int = 200) -> ParsedPage:
    tree = HTMLParser(html)

    json_ld: list[Any] = []
    for node in tree.css('script[type="application/ld+json"]'):
        try:
            parsed = json.loads(node.text() or "")
            json_ld.extend(parsed if isinstance(parsed, list) else [parsed])
        except (json.JSONDecodeError, ValueError):
            pass

    embedded_json: list[Any] = []
    for sel in (
        'script[type="application/json"]',
        "script[id*=deferred-state]",
        "script[id*=__NEXT_DATA__]",
        "script[id=data-state]",
    ):
        for node in tree.css(sel):
            raw = node.text() or ""
            if not raw or len(raw) > 4_000_000:
                continue
            try:
                embedded_json.append(json.loads(raw))
            except (json.JSONDecodeError, ValueError):
                pass

    open_graph: dict[str, str] = {}
    meta: dict[str, str] = {}
    for node in tree.css("meta"):
        prop = node.attributes.get("property")
        name = node.attributes.get("name")
        content = node.attributes.get("content")
        if not content:
            continue
        if prop and prop.startswith("og:"):
            open_graph[prop[3:]] = content
        if name:
            meta[name] = content

    images: set[str] = set()

    def push(u: str | None) -> None:
        if not u or u.startswith("data:"):
            return
        try:
            absu = urljoin(final_url, u)
        except ValueError:
            return
        if _JUNK_IMAGE.search(absu):
            return
        if re.search(r"\.(jpe?g|png|webp|avif)(\?|$)", absu, re.IGNORECASE) or re.search(
            r"image|photo|media|muscache", absu, re.IGNORECASE
        ):
            images.add(absu)

    for node in tree.css("img"):
        push(node.attributes.get("src"))
        push(node.attributes.get("data-src"))
        ss = node.attributes.get("srcset") or node.attributes.get("data-srcset")
        if ss:
            push(ss.split(",")[-1].strip().split(" ")[0])
    if open_graph.get("image"):
        push(open_graph["image"])

    json_imgs: set[str] = set()
    for blob in embedded_json:
        _collect_images(json.dumps(blob), json_imgs)
    _collect_images(html, json_imgs)
    for u in json_imgs:
        push(u)

    body = tree.body
    text = ""
    if body:
        for bad in body.css("script, style, noscript, svg"):
            bad.decompose()
        text = body.text(separator="\n") or ""
    text = re.sub(r"\r", "", text)
    text = re.sub(r"[ \t ]+", " ", text)
    text = re.sub(r" ?\n ?", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    text_excerpt = text[:16000]

    hints = _extract_hints([*json_ld, *embedded_json], text_excerpt)
    if hints.lat is None and open_graph.get("latitude"):
        hints.lat = _num(open_graph["latitude"])
    if hints.lng is None and open_graph.get("longitude"):
        hints.lng = _num(open_graph["longitude"])

    title_node = tree.css_first("title")
    return ParsedPage(
        html=html,
        bytes=len(html.encode("utf-8")),
        final_url=final_url,
        status=status,
        title=(title_node.text().strip() if title_node else None) or open_graph.get("title"),
        json_ld=json_ld,
        open_graph=open_graph,
        meta=meta,
        embedded_json=embedded_json,
        image_urls=list(images),
        text_excerpt=text_excerpt,
        hints=hints,
    )
