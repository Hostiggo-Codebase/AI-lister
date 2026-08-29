from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass, field
from typing import Any

from app.config import settings
from app.models import LLM_TOOL_SCHEMA, Provider
from app.pipeline.tier1 import ParsedPage

log = logging.getLogger("import.extract")

SYSTEM = """You extract a structured homestay/vacation-rental listing from the raw content of an \
online travel agency (OTA) page.

Rules:
- Use ONLY information present in the provided content. Never invent amenities, prices, coordinates \
or addresses. Missing value -> null / omit.
- "description" should be the host's FULL property write-up, cleaned of navigation/boilerplate. \
Prefer the FULL PROPERTY DESCRIPTION block verbatim.
- "photos" = direct image URLs from og:image, gallery <img>, JSON-LD image arrays, or the \
EMBEDDED STATE JSON. Exclude icons, avatars, map tiles, "platform-assets".
- Prices: nightly rate + ISO-4217 currency (INR for ₹/Rs). The nightly rate is the smallest \
per-night figure, not a multi-night total or a fee-inclusive number.
- Mine the EMBEDDED STATE JSON for price, capacity, bedrooms, beds, bathrooms, coordinates, city, \
amenities, cancellation policy and check-in/out when the visible text lacks them.
- Return via the "emit_listing_draft" tool."""


@dataclass
class ExtractionResult:
    engine: str
    model: str
    raw: dict[str, Any]
    warnings: list[str] = field(default_factory=list)


def _relevant_embedded(page: ParsedPage) -> str:
    """Only the slice of embedded JSON near listing-ish keys — keeps the prompt
    small and focused instead of dumping Airbnb's whole 500KB deferred state."""
    if not page.embedded_json:
        return ""
    blob = json.dumps(page.embedded_json)
    if len(blob) <= 45000:
        return blob
    keys = ("description", "price", "amenit", "bedroom", "bathroom", "personCapacity",
            "latitude", "longitude", "localizedCity", "checkIn", "checkOut", "cancel",
            "rating", "review", "superhost", "hostName")
    lo = len(blob)
    hi = 0
    low = blob.lower()
    for k in keys:
        i = low.find(k.lower())
        if i != -1:
            lo = min(lo, i)
            hi = max(hi, i + len(k))
    if hi <= lo:
        return blob[:45000]
    start = max(0, lo - 4000)
    return blob[start : min(len(blob), hi + 20000)][:60000]


def _build_content(page: ParsedPage, provider: Provider) -> str:
    h = page.hints
    embedded = _relevant_embedded(page)
    hints_lite = {
        "price_candidates": h.price_candidates,
        "person_capacity": h.person_capacity,
        "bedrooms": h.bedrooms,
        "beds": h.beds,
        "bathrooms": h.bathrooms,
        "amenity_names": h.amenity_names,
        "lat": h.lat,
        "lng": h.lng,
        "city": h.city,
    }
    parts = [
        f"PROVIDER: {provider}",
        f"PAGE TITLE: {page.title or ''}",
        f"OPENGRAPH: {json.dumps(page.open_graph)}",
        f"META: {json.dumps({'description': page.meta.get('description'), 'keywords': page.meta.get('keywords')})}",
    ]
    if h.long_description:
        joined = "\n\n---\n\n".join(h.description_parts or [h.long_description])
        parts.append(
            "FULL PROPERTY DESCRIPTION (use verbatim for \"description\", only cleaning "
            f"boilerplate):\n{joined}"
        )
    parts.append(f"JSON-LD: {json.dumps(page.json_ld)[:20000]}")
    parts.append(f"PRE-EXTRACTED HINTS (verify before trusting): {json.dumps(hints_lite)}")
    if embedded:
        parts.append(f"EMBEDDED STATE JSON (truncated): {embedded}")
    parts.append(f"CANDIDATE IMAGE URLS: {json.dumps(page.image_urls[:80])}")
    parts.append(f"VISIBLE TEXT (truncated): {page.text_excerpt}")
    return "\n\n".join(parts)


async def extract_listing(
    page: ParsedPage, provider: Provider, model_override: str | None = None
) -> ExtractionResult:
    model = model_override or settings.import_llm_model
    if not settings.has_llm:
        raw, warnings = _heuristic(page)
        return ExtractionResult("heuristic", "heuristic-mock", raw, warnings)

    from anthropic import AsyncAnthropic

    content = _build_content(page, provider)
    log.info("llm input: %d chars (~%d tokens)", len(content), len(content) // 4)

    client = AsyncAnthropic(api_key=settings.anthropic_api_key, timeout=120.0, max_retries=2)
    try:
        msg = await client.messages.create(
            model=model,
            max_tokens=8192,
            system=SYSTEM,
            tools=[
                {
                    "name": "emit_listing_draft",
                    "description": "Return the extracted listing draft.",
                    "input_schema": LLM_TOOL_SCHEMA,
                }
            ],
            tool_choice={"type": "tool", "name": "emit_listing_draft"},
            messages=[{"role": "user", "content": content}],
        )
        tool_use = next((b for b in msg.content if b.type == "tool_use"), None)
        if tool_use is None:
            raise RuntimeError("LLM returned no tool_use block")
        return ExtractionResult("anthropic", model, dict(tool_use.input), [])
    except Exception as e:  # noqa: BLE001 — never let a bad LLM call strand the import
        log.warning("LLM extraction failed (%s: %s) — falling back to heuristic", type(e).__name__, e)
        raw, warnings = _heuristic(page)
        return ExtractionResult(
            "heuristic-fallback",
            "heuristic-mock",
            raw,
            [f"LLM call failed ({type(e).__name__}: {e}); used heuristic extractor", *warnings],
        )


# --------------------------------------------------------------------------- #
# Offline heuristic
# --------------------------------------------------------------------------- #
def _find_ld(page: ParsedPage) -> dict:
    for x in page.json_ld:
        if isinstance(x, dict) and re.search(
            r"Hotel|Lodging|Product|Place|Accommodation|Apartment|House",
            str(x.get("@type", "")),
        ):
            return x
    return {}


def _heuristic(page: ParsedPage) -> tuple[dict, list[str]]:
    warnings = ["Using offline heuristic extractor (no ANTHROPIC_API_KEY set)"]
    ld = _find_ld(page)
    h = page.hints
    text = page.text_excerpt

    price_cand = sorted(h.price_candidates, key=lambda c: c["amount"])
    m = re.search(r"(?:₹|Rs\.?|INR)\s?([\d,]{3,})", text, re.IGNORECASE)
    nightly = (
        price_cand[0]["amount"]
        if price_cand
        else (float(m.group(1).replace(",", "")) if m else None)
    )
    currency = price_cand[0]["currency"] if price_cand else "INR"

    def _int(pat: str) -> int | None:
        mm = re.search(pat, text, re.IGNORECASE)
        return int(mm.group(1)) if mm else None

    guests = h.person_capacity or _int(r"(\d+)\s*guests?")
    bedrooms = h.bedrooms if h.bedrooms is not None else _int(r"(\d+)\s*bedrooms?")
    beds = h.beds if h.beds is not None else _int(r"(\d+)\s*beds?")
    bath_m = re.search(r"(\d+(?:\.\d)?)\s*(?:bath|bathrooms?)", text, re.IGNORECASE)
    bathrooms = h.bathrooms if h.bathrooms is not None else (float(bath_m.group(1)) if bath_m else None)

    haystack = (" ".join(h.amenity_names) + " " + text).lower()
    from app.taxonomy import _AMENITY_MAP

    amenities = sorted({out for pat, out in _AMENITY_MAP if re.search(pat, haystack)})

    ld_images = ld.get("image") or []
    if isinstance(ld_images, str):
        ld_images = [ld_images]
    photos = [
        {"url": u}
        for u in dict.fromkeys([*map(str, ld_images), *page.image_urls])
        if str(u).startswith("http")
    ][:40]

    addr = ld.get("address") or {}
    geo = ld.get("geo") or {}
    agg = ld.get("aggregateRating") or {}

    descs = [
        h.long_description,
        ld.get("description"),
        page.meta.get("description"),
        page.open_graph.get("description"),
    ]
    description = max((d for d in descs if isinstance(d, str) and d), key=len, default=text[:1200])

    return (
        {
            "title": ld.get("name") or page.open_graph.get("title") or page.title or "Imported listing",
            "summary": page.open_graph.get("description") or page.meta.get("description"),
            "description": description,
            "property_type": "villa" if re.search(r"villa", text, re.IGNORECASE) else (
                "apartment" if re.search(r"apartment|flat", text, re.IGNORECASE) else (
                    "cottage" if re.search(r"cottage", text, re.IGNORECASE) else "homestay"
                )
            ),
            "stay_type": "entire_property"
            if re.search(r"entire (home|place|villa|apartment)", text, re.IGNORECASE)
            else ("private_room" if re.search(r"private room", text, re.IGNORECASE) else "entire_property"),
            "booking_mode": "instant" if re.search(r"instant book", text, re.IGNORECASE) else None,
            "address": {
                "line": addr.get("streetAddress"),
                "city": addr.get("addressLocality") or h.city,
                "state": addr.get("addressRegion"),
                "country": addr.get("addressCountry") or "India",
                "postal_code": addr.get("postalCode"),
            },
            "location": {
                "lat": float(geo["latitude"]) if geo.get("latitude") is not None else h.lat,
                "lng": float(geo["longitude"]) if geo.get("longitude") is not None else h.lng,
            },
            "capacity": {
                "max_guests": guests or 2,
                "bedrooms": bedrooms,
                "beds": beds,
                "bathrooms": bathrooms,
            },
            "pricing": {
                "nightly_amount": nightly,
                "currency": currency,
                "cleaning_fee": None,
                "weekly_discount_pct": None,
                "monthly_discount_pct": None,
            },
            "availability": {
                "min_nights": _int(r"minimum (?:stay|nights?)[^\d]{0,10}(\d+)"),
                "max_nights": None,
                "check_in_time": (re.search(r"check[- ]?in[^\d]{0,12}(\d{1,2}[:.]?\d{0,2}\s?[ap]?m?)", text, re.IGNORECASE) or [None, None])[1],
                "check_out_time": (re.search(r"check[- ]?out[^\d]{0,12}(\d{1,2}[:.]?\d{0,2}\s?[ap]?m?)", text, re.IGNORECASE) or [None, None])[1],
            },
            "amenities": amenities,
            "house_rules": {
                "smoking_allowed": False if re.search(r"no smoking", text, re.IGNORECASE) else None,
                "pets_allowed": True if re.search(r"pets allowed|pet friendly", text, re.IGNORECASE) else None,
                "parties_allowed": False if re.search(r"no part(y|ies)", text, re.IGNORECASE) else None,
                "quiet_hours": None,
                "additional_rules": [],
            },
            "safety": {
                "smoke_alarm": True if "smoke_alarm" in amenities else None,
                "fire_extinguisher": True if "fire_extinguisher" in amenities else None,
                "first_aid_kit": True if "first_aid_kit" in amenities else None,
                "carbon_monoxide_alarm": True if "carbon_monoxide_alarm" in amenities else None,
            },
            "cancellation_policy": "flexible" if re.search(r"free cancellation", text, re.IGNORECASE) else "unknown",
            "photos": photos,
            "host": {"name": (ld.get("author") or {}).get("name")},
            "ratings": {
                "overall": float(agg["ratingValue"]) if agg.get("ratingValue") is not None else None,
                "count": int(agg["reviewCount"]) if agg.get("reviewCount") is not None else None,
            },
        },
        warnings,
    )
