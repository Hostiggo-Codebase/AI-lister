from __future__ import annotations

import re
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

from app.models import Provider

_RULES: list[tuple[Provider, re.Pattern]] = [
    ("airbnb", re.compile(r"(^|\.)airbnb\.[a-z.]+$", re.IGNORECASE)),
    ("booking", re.compile(r"(^|\.)booking\.com$", re.IGNORECASE)),
    ("agoda", re.compile(r"(^|\.)agoda\.com$", re.IGNORECASE)),
    ("makemytrip", re.compile(r"(^|\.)makemytrip\.(com|co\.in)$", re.IGNORECASE)),
    ("goibibo", re.compile(r"(^|\.)goibibo\.com$", re.IGNORECASE)),
]

_LISTING_ID: dict[Provider, re.Pattern] = {
    "airbnb": re.compile(r"/rooms/(?:plus/)?(\d{4,})"),
    "booking": re.compile(r"/hotel/[a-z]{2}/([a-z0-9-]+)\.[a-z-]+\.html", re.IGNORECASE),
    "agoda": re.compile(r"/hotel/([a-z0-9-]+)\.html", re.IGNORECASE),
    "makemytrip": re.compile(r"hotels/([a-z0-9_-]+)-details", re.IGNORECASE),
    "goibibo": re.compile(r"/hotels/([a-z0-9-]+-hotel-in-[a-z0-9-]+)/", re.IGNORECASE),
}

_TRACKING = re.compile(
    r"^(utm_|_|source_|federated_|previous_page)"
    r"|^(source|ref|adults|children|infants|pets|check[_-]?in|check[_-]?out|guests"
    r"|search_mode|modal|unique_share_id|s|c|room_types|category_tag|photo_id|translate_ugc)$",
    re.IGNORECASE,
)

PROFILE_HINT = re.compile(
    r"/users/show/|/users/\d+|/host/|hostprofile|/wishlists?/|/s/|search|/property-owner/", re.IGNORECASE
)


def detect_provider(url: str) -> Provider:
    try:
        host = urlparse(url).hostname or ""
    except ValueError:
        return "unknown"
    for name, pat in _RULES:
        if pat.search(host):
            return name
    return "unknown"


def external_listing_id(url: str, provider: Provider) -> str | None:
    pat = _LISTING_ID.get(provider)
    if not pat:
        return None
    m = pat.search(url)
    return m.group(1) if m else None


def clean_url(url: str) -> str:
    p = urlparse(url.strip())
    q = [(k, v) for k, v in parse_qsl(p.query) if not _TRACKING.match(k)]
    return urlunparse((p.scheme, p.netloc, p.path, p.params, urlencode(q), ""))


class UrlError(ValueError):
    pass


def validate_import_url(url: str) -> tuple[str, Provider, str | None]:
    url = (url or "").strip()
    try:
        p = urlparse(url)
    except ValueError as e:
        raise UrlError("not a valid URL") from e
    if p.scheme not in ("http", "https") or not p.netloc:
        raise UrlError("URL must be http(s)")
    provider = detect_provider(url)
    if provider == "unknown":
        raise UrlError(
            "Unsupported site. Supported: Airbnb, Booking.com, Agoda, MakeMyTrip, Goibibo."
        )
    cleaned = clean_url(url)
    return cleaned, provider, external_listing_id(cleaned, provider)


def is_profile_url(url: str) -> bool:
    return bool(PROFILE_HINT.search(url))
