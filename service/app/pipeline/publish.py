"""
publish_draft — writes the imported draft into the real hostiggo_testing_schema
tables (the same rows a manual listing produces), plus provenance.

Column names come from app.schema_map. A missing column is skipped and reported
in the response's `skipped[]` rather than raising.
"""

from __future__ import annotations

import logging

from app import schema_map as sm
from app.config import settings
from app.db import tx
from app.models import ListingDraft

log = logging.getLogger("import.publish")
IS = settings.import_schema

# our extraction slug  ->  their property_types.type_id
_PROP_SLUG = {
    "guesthouse": "guest-house",
    "boutique_hotel": "hotel",
    "homestay": "bnb",
    "farm_stay": "farm-stay",
}
# our stay slug -> their stay_types.type_id
_STAY_SLUG = {
    "entire_property": "entire",
    "private_room": "private",
    "shared_space": "shared",
}
# our amenity slug -> their amenities.name (only where the simple
# replace('_',' ')/title rule doesn't already match)
_AMENITY_NAME = {
    "wifi": "WiFi",
    "pets_allowed": "Pet Friendly",
    "free_parking": "Free Parking",
    "air_conditioning": "Air Conditioning",
    "tv": "TV",
    "bbq_grill": "BBQ Grill",
}


def _to_time(v):
    """Parse a loose check-in/out string like '2:00 PM' or '14:00' to HH:MM:SS."""
    if not v:
        return None
    import re

    m = re.search(r"(\d{1,2})[:.]?(\d{2})?\s*([ap]\.?m\.?)?", str(v), re.IGNORECASE)
    if not m:
        return None
    hh = int(m.group(1))
    mm = int(m.group(2) or 0)
    ap = (m.group(3) or "").lower().replace(".", "")
    if ap == "pm" and hh < 12:
        hh += 12
    if ap == "am" and hh == 12:
        hh = 0
    hh = min(hh, 23)
    return f"{hh:02d}:{mm:02d}:00"


def _int(v):
    try:
        return round(float(v)) if v is not None else None
    except (TypeError, ValueError):
        return None


async def _resolve_property_type(conn, slug: str) -> int | None:
    for cand in (slug, slug.replace("_", "-"), _PROP_SLUG.get(slug)):
        if not cand:
            continue
        r = await conn.fetchrow(
            f'select "{sm.PROPERTY_TYPE_ID}" id from {sm.t(sm.TBL_PROPERTY_TYPES)} '
            f'where lower("{sm.PROPERTY_TYPE_SLUG}") = lower($1) limit 1',
            cand,
        )
        if r:
            return r["id"]
    r = await conn.fetchrow(
        f'select "{sm.PROPERTY_TYPE_ID}" id from {sm.t(sm.TBL_PROPERTY_TYPES)} '
        f'where lower("{sm.PROPERTY_TYPE_LABEL}") ilike $1 limit 1',
        f"%{slug.replace('_', ' ')}%",
    )
    return r["id"] if r else None


async def _resolve_stay_type(conn, slug: str) -> int | None:
    cand = _STAY_SLUG.get(slug, slug)
    r = await conn.fetchrow(
        f'select "{sm.STAY_TYPE_ID}" id from {sm.t(sm.TBL_STAY_TYPES)} '
        f'where lower("{sm.STAY_TYPE_SLUG}") = lower($1) limit 1',
        cand,
    )
    return r["id"] if r else None


async def _resolve_amenity(conn, slug: str) -> int | None:
    name = _AMENITY_NAME.get(slug) or slug.replace("_", " ").title()
    r = await conn.fetchrow(
        f'select "{sm.AMENITY_ID}" id from {sm.t(sm.TBL_AMENITY_CATALOG)} '
        f'where lower("{sm.AMENITY_LABEL}") = lower($1) '
        f'   or lower(replace("{sm.AMENITY_LABEL}", \' \', \'_\')) = lower($2) limit 1',
        name, slug,
    )
    return r["id"] if r else None


async def _insert(conn, table: str, mapping: dict, data: dict, pk: str = "id"):
    keys, values = sm.cols(mapping, data)
    if not keys:
        return None
    ph = ", ".join(f"${i + 1}" for i in range(len(values)))
    try:
        row = await conn.fetchrow(
            f'insert into {sm.t(table)} ({", ".join(keys)}) values ({ph}) returning "{pk}"',
            *values,
        )
        return row[0] if row else None
    except Exception:  # noqa: BLE001 — retry without RETURNING for keyless tables
        await conn.execute(
            f'insert into {sm.t(table)} ({", ".join(keys)}) values ({ph})', *values
        )
        return None


async def publish_draft(record: dict, draft: ListingDraft) -> dict:
    provider = record["provider"]
    skipped: list[str] = []

    async with tx() as conn:
        pt_id = await _resolve_property_type(conn, draft.property_type)
        st_id = await _resolve_stay_type(conn, draft.stay_type)
        if pt_id is None:
            skipped.append(f"property_type '{draft.property_type}' unresolved")
        if st_id is None:
            skipped.append(f"stay_type '{draft.stay_type}' unresolved")

        ical = record.get("ical") or {}
        listing_data = {
            "host_uuid": record.get("host_uuid"),
            "title": draft.title,
            "description": draft.description,
            "property_type_id": pt_id,
            "stay_type_id": st_id,
            "address_line1": draft.address.line,
            "address_line2": None,
            "landmark": draft.address.landmark,
            "pincode": _int(draft.address.postal_code),
            "latitude": draft.location.lat,
            "longitude": draft.location.lng,
            "num_guests": _int(draft.capacity.max_guests),
            "num_bedrooms": _int(draft.capacity.bedrooms),
            "num_beds": _int(draft.capacity.beds),
            "num_bathrooms": _int(draft.capacity.bathrooms),
            "price_weekday": draft.pricing.nightly_amount,
            "price_weekend": draft.pricing.weekend_amount,
            "currency": draft.pricing.currency or "INR",
            "booking_mode": draft.booking_mode,
            "check_in_time": _to_time(draft.availability.check_in_time),
            "check_out_time": _to_time(draft.availability.check_out_time),
            "cancellation_policy": draft.cancellation_policy
            if draft.cancellation_policy != "unknown" else "moderate",
            "ical_link": ical.get("url"),
            "is_active": False,  # imported draft — host reviews then activates
            "source": "airbnb_import" if provider == "airbnb" else f"{provider}_import",
            "import_id": record["import_id"],
            "external_url": record["source_url"],
            "external_listing_id": record.get("external_listing_id"),
            "import_confirmed_by_host": bool(record.get("host_confirmed_ownership")),
            "min_nights": _int(draft.availability.min_nights),
            "max_nights": _int(draft.availability.max_nights),
        }
        skipped += [f"listings.{f}" for f in sm.unknown_fields(sm.LISTINGS_COLS, listing_data)]
        listing_id = await _insert(
            conn, sm.TBL_LISTINGS, sm.LISTINGS_COLS, listing_data, pk=sm.LISTINGS_PK
        )
        if listing_id is None:
            raise RuntimeError("could not insert listing — check schema_map.LISTINGS_COLS")

        # media
        for i, p in enumerate(record.get("mirrored_photos") or []):
            if p.get("status") != "mirrored" or not p.get("public_url"):
                continue
            await _insert(conn, sm.TBL_MEDIA, sm.MEDIA_COLS, {
                "listing_id": listing_id,
                "media_url": p["public_url"],
                "media_type": "image",
                "is_cover": i == 0,
                "source": "airbnb_import",
                "source_url": p.get("original_url"),
                "import_id": record["import_id"],
            })

        # per-bedroom breakdown (all columns NOT NULL)
        bd = draft.capacity.bedroom_breakdown or []
        n_bed = _int(draft.capacity.bedrooms) or (len(bd) if bd else 0)
        for idx in range(1, n_bed + 1):
            beds_here = 1
            if idx - 1 < len(bd):
                import re as _re

                mm = _re.search(r"\d+", str(bd[idx - 1].get("beds", "")))
                beds_here = int(mm.group(0)) if mm else 1
            await _insert(conn, sm.TBL_BEDROOMS, sm.BEDROOM_COLS, {
                "listing_id": listing_id,
                "bedroom_index": idx,
                "beds": beds_here,
                "bathrooms": _int(draft.capacity.bathrooms) or 1,
                "max_guests": _int(draft.capacity.max_guests) or 2,
            })

        # amenities
        for a in draft.amenities:
            aid = await _resolve_amenity(conn, a)
            if aid is None:
                skipped.append(f"amenity '{a}' unresolved")
                continue
            await _insert(conn, sm.TBL_AMENITIES, sm.LISTING_AMENITY_COLS, {
                "listing_id": listing_id, "amenity_id": aid,
            })

        # discounts (one row per type)
        for dtype, pct in (
            ("weekly", draft.pricing.weekly_discount_pct),
            ("monthly", draft.pricing.monthly_discount_pct),
            ("new_listing", draft.pricing.new_listing_discount_pct),
        ):
            if pct is None:
                continue
            await _insert(conn, sm.TBL_DISCOUNTS, sm.DISCOUNT_COLS, {
                "listing_id": listing_id, "discount_type": dtype,
                "percent": pct, "enabled": True,
            })

        # house rules (quiet_hours is a boolean here)
        hr = draft.house_rules
        await _insert(conn, sm.TBL_HOUSE_RULES, sm.HOUSE_RULE_COLS, {
            "listing_id": listing_id,
            "check_in_time": _to_time(draft.availability.check_in_time),
            "check_out_time": _to_time(draft.availability.check_out_time),
            "smoking_allowed": bool(hr.smoking_allowed),
            "pets_allowed": bool(hr.pets_allowed),
            "parties_allowed": bool(hr.parties_allowed),
            "quiet_hours": hr.quiet_hours is not None,
        })

        # safety (this schema has security_camera / noise_monitoring / weapons / smoke_alarm)
        sfy = draft.safety
        await _insert(conn, sm.TBL_SAFETY, sm.SAFETY_COLS, {
            "listing_id": listing_id,
            "security_camera": bool(sfy.security_camera),
            "noise_monitoring": bool(sfy.noise_monitoring),
            "weapons": bool(sfy.weapons_on_property),
            "smoke_alarm": bool(sfy.smoke_alarm),
        })

        # parsed iCal events -> listing_ical_feeds (import-owned table)
        if ical and not ical.get("error"):
            await conn.execute(
                f'insert into "{IS}"."listing_ical_feeds" '
                "(listing_id, import_id, feed_url, calendar_name, last_pulled_at, last_status, "
                " blocked_dates, events) values ($1,$2,$3,$4, now(), 'ok', $5, $6)",
                listing_id, record["import_id"], ical["url"], ical.get("calendar_name"),
                ical.get("blocked_dates") or [], ical.get("events") or [],
            )

        await conn.execute(
            f'update "{IS}"."listing_imports" '
            "set listing_id = $1, status = 'published', updated_at = now() where import_id = $2",
            listing_id, record["import_id"],
        )

    if skipped:
        log.info("publish import %s -> listing %s, skipped: %s",
                 record["import_id"], listing_id, skipped)
    return {"listing_id": listing_id, "skipped": skipped}
