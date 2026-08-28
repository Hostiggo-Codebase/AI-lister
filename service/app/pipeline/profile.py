from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from urllib.parse import urlparse

from app.models import Provider
from app.pipeline.tier1 import tier1_fetch
from app.pipeline.tier2 import tier2_scrape
from app.providers import detect_provider, is_profile_url

_LISTING_PATH: dict[str, re.Pattern] = {
    "airbnb": re.compile(r"/rooms/(?:plus/)?(\d{4,})"),
    "booking": re.compile(r"/hotel/[a-z]{2}/([a-z0-9-]+)\.[a-z-]+\.html", re.IGNORECASE),
    "agoda": re.compile(r"/hotel/([a-z0-9-]+)\.html", re.IGNORECASE),
    "makemytrip": re.compile(r"hotels/([a-z0-9_-]+)-details", re.IGNORECASE),
    "goibibo": re.compile(r"/hotels/([a-z0-9-]+-hotel-in-[a-z0-9-]+)/", re.IGNORECASE),
}


@dataclass
class DiscoveredListing:
    url: str
    external_id: str
    title: str | None = None
    thumbnail: str | None = None


@dataclass
class ProfileScan:
    provider: Provider
    is_profile_url: bool
    host_name: str | None
    listings: list[DiscoveredListing] = field(default_factory=list)
    tier_used: int = 1
    note: str | None = None


async def scan_profile(raw_url: str) -> ProfileScan:
    provider = detect_provider(raw_url)
    scan = ProfileScan(provider=provider, is_profile_url=is_profile_url(raw_url), host_name=None)
    if provider == "unknown":
        scan.note = "Unsupported site."
        return scan

    origin = ""
    try:
        p = urlparse(raw_url)
        origin = f"{p.scheme}://{p.netloc}"
    except ValueError:
        pass

    pat = _LISTING_PATH.get(provider)

    def harvest(html: str) -> list[DiscoveredListing]:
        if not pat:
            return []
        seen: dict[str, DiscoveredListing] = {}
        for m in pat.finditer(html):
            ext = m.group(1)
            if not ext or ext in seen:
                continue
            path = f"/rooms/{ext}" if provider == "airbnb" else m.group(0)
            if not path.startswith("/"):
                path = "/" + path
            seen[ext] = DiscoveredListing(url=origin + path, external_id=ext)
        return list(seen.values())

    page = await tier1_fetch(raw_url)
    tier = 1
    listings = harvest(page.html)

    if not listings:
        t2 = await tier2_scrape(raw_url)
        if t2.ok and t2.page:
            page = t2.page
            tier = 2
            listings = harvest(page.html)
        else:
            scan.note = f"Tier 2 needed but unavailable: {t2.reason}"

    blob = json.dumps(page.embedded_json)
    for listing in listings:
        near = blob.find(listing.external_id)
        if near > -1:
            window = blob[near : near + 1200]
            tm = re.search(r'"(?:name|title|localizedName)"\s*:\s*"([^"]{4,120})"', window)
            im = re.search(r'"(https?://[^"]+?\.(?:jpe?g|png|webp)[^"]*)"', window)
            listing.title = tm.group(1) if tm else None
            listing.thumbnail = im.group(1).replace("\\/", "/") if im else None

    hm = re.search(
        r"([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)'s (?:listings|home)", page.html
    )
    scan.host_name = (hm.group(1) if hm else None) or page.open_graph.get("title")
    scan.tier_used = tier
    scan.listings = listings[:40]
    scan.note = scan.note or (None if listings else "No listings found on this page.")
    return scan
