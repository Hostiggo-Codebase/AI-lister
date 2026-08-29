from __future__ import annotations

import re
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

from app.models import (
    Address,
    Availability,
    Capacity,
    FieldNote,
    GeoPoint,
    HouseRules,
    ListingDraft,
    Photo,
    Pricing,
    Safety,
)
from app.taxonomy import (
    nearest_cancellation,
    nearest_property_type,
    nearest_stay_type,
    normalize_amenity,
)

_UUID_RE = re.compile(
    r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", re.IGNORECASE
)
_JUNK_IMG = re.compile(
    r"(platform-assets|platformassets|search-bar-icons|userprofile|user_|profile_|avatar"
    r"|[/-]icons?[/-]|sprite|[/-]logo|maps\.googleapis|pinimg|fbcdn)",
    re.IGNORECASE,
)
_PHOTO_Q = re.compile(r"^(w|h|width|height|quality|q|im_|_|aki_policy|cs|impolicy)", re.IGNORECASE)
_CURRENCY_SYMBOL = {"₹": "INR", "Rs": "INR", "$": "USD", "€": "EUR", "£": "GBP"}


def _num(v: Any) -> float | None:
    if v is None or v == "":
        return None
    if isinstance(v, (int, float)):
        import math

        return None if math.isnan(v) else float(v)
    m = re.search(r"-?\d+(\.\d+)?", str(v).replace(",", "").replace(" ", ""))
    return float(m.group(0)) if m else None


def _int(v: Any) -> int | None:
    n = _num(v)
    return None if n is None else round(n)


def _str(v: Any) -> str | None:
    if not isinstance(v, str):
        return None
    s = v.strip()
    return s or None


def _clamp(n: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, n))


def _bool(v: Any) -> bool | None:
    if isinstance(v, bool):
        return v
    if isinstance(v, str):
        if v.lower() in ("true", "yes", "1"):
            return True
        if v.lower() in ("false", "no", "0"):
            return False
    return None


def validate_draft(raw: dict[str, Any]) -> tuple[ListingDraft, list[FieldNote]]:
    report: list[FieldNote] = []

    def add(path: str, status, note: str) -> None:
        report.append(FieldNote(path=path, status=status, note=note))

    title = _str(raw.get("title"))
    if not title:
        add("title", "missing", "No title extracted")
    description = _str(raw.get("description"))
    if not description:
        add("description", "missing", "No description extracted")

    pt = nearest_property_type(_str(raw.get("property_type")))
    if _str(raw.get("property_type")) and pt != (_str(raw.get("property_type")) or "").lower():
        add("property_type", "coerced", f"-> {pt}")
    elif not _str(raw.get("property_type")):
        add("property_type", "missing", f"defaulted to {pt}")
    st = nearest_stay_type(_str(raw.get("stay_type")))
    if not _str(raw.get("stay_type")):
        add("stay_type", "missing", f"defaulted to {st}")

    loc = raw.get("location") or {}
    lat, lng = _num(loc.get("lat")), _num(loc.get("lng"))
    if lat is not None and not (-90 <= lat <= 90):
        add("location.lat", "dropped", f"out of range ({lat})")
        lat = None
    if lng is not None and not (-180 <= lng <= 180):
        add("location.lng", "dropped", f"out of range ({lng})")
        lng = None

    cap = raw.get("capacity") or {}
    max_guests = _int(cap.get("max_guests"))
    if max_guests is None:
        add("capacity.max_guests", "missing", "defaulted to 2")
        max_guests = 2
    elif max_guests != _clamp(max_guests, 1, 50):
        add("capacity.max_guests", "clamped", f"{max_guests} -> {int(_clamp(max_guests,1,50))}")
        max_guests = int(_clamp(max_guests, 1, 50))
    bedrooms = _int(cap.get("bedrooms"))
    beds = _int(cap.get("beds"))
    bathrooms = _num(cap.get("bathrooms"))
    breakdown = cap.get("bedroom_breakdown") or []
    if bedrooms and not breakdown:
        add("capacity.bedroom_breakdown", "missing", "per-bedroom sleeping split not provided")

    pr = raw.get("pricing") or {}
    raw_cur = _str(pr.get("currency")) or ""
    currency = raw_cur.upper()
    if not re.fullmatch(r"[A-Z]{3}", currency):
        mapped = (
            _CURRENCY_SYMBOL.get(raw_cur)
            or _CURRENCY_SYMBOL.get(raw_cur.title())
            or ("INR" if re.search(r"₹|rs\b|inr|rupee", raw_cur, re.IGNORECASE) else "")
        )
        if mapped:
            add("pricing.currency", "coerced", f'"{raw_cur}" -> {mapped}')
            currency = mapped
        else:
            add("pricing.currency", "missing", "defaulted to INR")
            currency = "INR"
    nightly = _num(pr.get("nightly_amount"))
    if nightly is None:
        add("pricing.nightly_amount", "missing", "left null for host to set")
    elif nightly < 0:
        add("pricing.nightly_amount", "dropped", "negative")
        nightly = None
    weekly_disc = _num(pr.get("weekly_discount_pct"))
    if weekly_disc is not None:
        weekly_disc = _clamp(weekly_disc, 0, 100)
    monthly_disc = _num(pr.get("monthly_discount_pct"))
    if monthly_disc is not None:
        monthly_disc = _clamp(monthly_disc, 0, 100)

    amen_seen: set[str] = set()
    amen_unmapped: list[str] = []
    for a in raw.get("amenities") or []:
        norm = normalize_amenity(str(a))
        if not norm:
            s = _str(a)
            if s and s not in amen_unmapped:
                amen_unmapped.append(s)
            continue
        amen_seen.add(norm)
    amenities = sorted(amen_seen)
    if amen_unmapped:
        add("amenities", "dropped", f"{len(amen_unmapped)} not in taxonomy (kept in amenities_unmapped)")

    av = raw.get("availability") or {}
    hr = raw.get("house_rules") or {}
    sf = raw.get("safety") or {}

    # photos
    photo_seen: set[str] = set()
    photos: list[Photo] = []
    dropped = 0
    for p in raw.get("photos") or []:
        rurl = p if isinstance(p, str) else p.get("url")
        caption = None if isinstance(p, str) else _str(p.get("caption"))
        if not rurl:
            continue
        try:
            parsed = urlparse(rurl if "://" in rurl else "https://x/" + rurl.lstrip("/"))
        except ValueError:
            dropped += 1
            continue
        if parsed.scheme not in ("http", "https") or parsed.netloc in ("", "x"):
            dropped += 1
            continue
        if _JUNK_IMG.search(rurl):
            dropped += 1
            continue
        q = [(k, v) for k, v in parse_qsl(parsed.query) if not _PHOTO_Q.match(k)]
        clean = urlunparse(("https", parsed.netloc, parsed.path, "", urlencode(q), ""))
        uu = _UUID_RE.search(parsed.path)
        key = uu.group(0).lower() if uu else parsed.netloc + parsed.path
        if key in photo_seen:
            continue
        photo_seen.add(key)
        photos.append(Photo(url=clean, caption=caption))
    if dropped:
        add("photos", "dropped", f"{dropped} invalid / non-listing image(s)")
    from app.config import settings as _s

    if len(photos) > _s.import_max_photos:
        add("photos", "clamped", f"{len(photos)} -> {_s.import_max_photos}")
        photos = photos[: _s.import_max_photos]
    if not photos:
        add("photos", "missing", "no photos extracted")

    cp = nearest_cancellation(_str(raw.get("cancellation_policy")))
    booking_mode = _str(raw.get("booking_mode"))
    if booking_mode not in ("instant", "request", None):
        booking_mode = None
    host = raw.get("host") or {}
    ratings = raw.get("ratings") or {}

    draft = ListingDraft(
        title=title or "Untitled listing",
        summary=_str(raw.get("summary")),
        description=description or "",
        property_type=pt,
        stay_type=st,
        booking_mode=booking_mode,
        address=Address(
            line=_str((raw.get("address") or {}).get("line")),
            landmark=_str((raw.get("address") or {}).get("landmark")),
            city=_str((raw.get("address") or {}).get("city")),
            state=_str((raw.get("address") or {}).get("state")),
            country=_str((raw.get("address") or {}).get("country")),
            postal_code=_str((raw.get("address") or {}).get("postal_code")),
        ),
        location=GeoPoint(lat=lat, lng=lng),
        capacity=Capacity(
            max_guests=max_guests, bedrooms=bedrooms, beds=beds, bathrooms=bathrooms,
            bedroom_breakdown=breakdown if isinstance(breakdown, list) else [],
        ),
        pricing=Pricing(
            nightly_amount=nightly,
            currency=currency,
            cleaning_fee=_num(pr.get("cleaning_fee")),
            weekly_discount_pct=weekly_disc,
            monthly_discount_pct=monthly_disc,
        ),
        availability=Availability(
            min_nights=_int(av.get("min_nights")),
            max_nights=_int(av.get("max_nights")),
            check_in_time=_str(av.get("check_in_time")),
            check_out_time=_str(av.get("check_out_time")),
        ),
        amenities=amenities,
        amenities_unmapped=amen_unmapped,
        house_rules=HouseRules(
            smoking_allowed=_bool(hr.get("smoking_allowed")),
            pets_allowed=_bool(hr.get("pets_allowed")),
            parties_allowed=_bool(hr.get("parties_allowed")),
            quiet_hours=_str(hr.get("quiet_hours")),
            additional_rules=[s for s in (hr.get("additional_rules") or []) if _str(s)],
        ),
        safety=Safety(
            security_camera=_bool(sf.get("security_camera")),
            noise_monitoring=_bool(sf.get("noise_monitoring")),
            weapons_on_property=_bool(sf.get("weapons_on_property")),
            smoke_alarm=_bool(sf.get("smoke_alarm")),
            carbon_monoxide_alarm=_bool(sf.get("carbon_monoxide_alarm")),
            first_aid_kit=_bool(sf.get("first_aid_kit")),
            fire_extinguisher=_bool(sf.get("fire_extinguisher")),
        ),
        cancellation_policy=cp,
        photos=photos,
        host_name=_str(host.get("name")),
        ratings_overall=_num(ratings.get("overall")),
        ratings_count=_int(ratings.get("count")),
    )

    for path, present in (
        ("title", bool(title)),
        ("description", bool(description)),
        ("pricing.nightly_amount", nightly is not None),
        ("location", lat is not None and lng is not None),
        ("amenities", bool(amenities)),
        ("photos", bool(photos)),
    ):
        if present and not any(r.path == path for r in report):
            add(path, "ok", "extracted cleanly")

    return draft, report


def committable_issues(draft: ListingDraft) -> list[str]:
    errs = []
    if not draft.title or draft.title == "Untitled listing":
        errs.append("title required")
    if not draft.description:
        errs.append("description required")
    if draft.pricing.nightly_amount is None:
        errs.append("nightly price required")
    if not draft.address.city:
        errs.append("city required")
    if len(draft.photos) < 3:
        errs.append("at least 3 photos required")
    return errs
