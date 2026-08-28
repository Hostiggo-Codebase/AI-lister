"""
publish_draft — the import's equivalent of SupabaseOnboardingRepository.publishDraft.

Writes the same rows a manual listing would, plus provenance. Every table/column
name comes from ``app.schema_map`` — reconcile there, not here. A missing column
mapping is skipped and recorded in the returned ``skipped`` list rather than
raising.
"""

from __future__ import annotations

from typing import Any

from app import schema_map as sm
from app.config import settings
from app.db import tx
from app.models import ListingDraft

IS = settings.import_schema


async def _resolve_taxonomy(
    conn, entity_type: str, external_value: str | None, provider: str
) -> Any | None:
    """external_taxonomy_map first, then the catalog table by fuzzy label."""
    if not external_value:
        return None
    row = await conn.fetchrow(
        f'select internal_id from "{IS}"."external_taxonomy_map" '
        "where source = $1 and entity_type = $2 and lower(external_value) = lower($3)",
        provider, entity_type, external_value,
    )
    if row and row["internal_id"] is not None:
        return row["internal_id"]

    catalog = {
        "property_type": (sm.TBL_PROPERTY_TYPES, sm.PROPERTY_TYPE_ID, sm.PROPERTY_TYPE_LABEL),
        "stay_type": (sm.TBL_STAY_TYPES, sm.STAY_TYPE_ID, sm.STAY_TYPE_LABEL),
        "amenity": (sm.TBL_AMENITY_CATALOG, sm.AMENITY_ID, sm.AMENITY_LABEL),
    }.get(entity_type)
    if not catalog:
        return None
    table, id_col, label_col = catalog
    row = await conn.fetchrow(
        f'select "{id_col}" as id from {sm.t(table)} '
        f'where lower(replace("{label_col}", \' \', \'_\')) = lower($1) '
        f'   or lower("{label_col}") = lower(replace($1, \'_\', \' \')) limit 1',
        external_value,
    )
    return row["id"] if row else None


async def _insert(conn, table: str, mapping: dict, data: dict) -> Any:
    keys, values = sm.cols(mapping, data)
    if not keys:
        return None
    ph = ", ".join(f"${i + 1}" for i in range(len(values)))
    id_col = mapping.get("id", "id")
    row = await conn.fetchrow(
        f"insert into {sm.t(table)} ({', '.join(keys)}) values ({ph}) returning \"{id_col}\"",
        *values,
    )
    return row[0] if row else None


async def publish_draft(record: dict, draft: ListingDraft) -> dict:
    provider = record["provider"]
    skipped: list[str] = []

    async with tx() as conn:
        pt_id = await _resolve_taxonomy(conn, "property_type", draft.property_type, provider)
        st_id = await _resolve_taxonomy(conn, "stay_type", draft.stay_type, provider)
        if pt_id is None:
            skipped.append(f"property_type '{draft.property_type}' unresolved")
        if st_id is None:
            skipped.append(f"stay_type '{draft.stay_type}' unresolved")

        listing_data = {
            "host_uuid": record.get("host_uuid"),
            "title": draft.title,
            "description": draft.description,
            "property_type_id": pt_id,
            "stay_type_id": st_id,
            "address_line": draft.address.line,
            "landmark": draft.address.landmark,
            "city": draft.address.city,
            "state": draft.address.state,
            "country": draft.address.country,
            "pincode": draft.address.postal_code,
            "latitude": draft.location.lat,
            "longitude": draft.location.lng,
            "max_guests": draft.capacity.max_guests,
            "bedrooms": draft.capacity.bedrooms,
            "beds": draft.capacity.beds,
            "bathrooms": draft.capacity.bathrooms,
            "base_price": draft.pricing.nightly_amount,
            "weekend_price": draft.pricing.weekend_amount,
            "currency": draft.pricing.currency,
            "booking_mode": draft.booking_mode,
            "check_in_time": draft.availability.check_in_time,
            "check_out_time": draft.availability.check_out_time,
            "min_nights": draft.availability.min_nights,
            "max_nights": draft.availability.max_nights,
            "cancellation_policy": draft.cancellation_policy,
            "status": "draft",
            "source": "airbnb_import" if provider == "airbnb" else f"{provider}_import",
            "import_id": record["import_id"],
            "external_url": record["source_url"],
            "external_listing_id": record.get("external_listing_id"),
            "import_confirmed_by_host": bool(record.get("host_confirmed_ownership")),
        }
        skipped += [f"listings.{f}" for f in sm.unknown_fields(sm.LISTINGS_COLS, listing_data)]
        listing_id = await _insert(conn, sm.TBL_LISTINGS, sm.LISTINGS_COLS, listing_data)
        if listing_id is None:
            raise RuntimeError("could not insert listing — check schema_map.LISTINGS_COLS")

        # media
        for i, p in enumerate(record.get("mirrored_photos") or []):
            if p["status"] != "mirrored":
                continue
            await _insert(conn, sm.TBL_MEDIA, sm.MEDIA_COLS, {
                "listing_id": listing_id,
                "url": p["public_url"],
                "storage_path": p["storage_path"],
                "is_cover": i == 0,
                "sort_order": i,
                "caption": p.get("caption"),
                "source": "airbnb_import",
                "source_url": p["original_url"],
                "import_id": record["import_id"],
            })

        # bedroom breakdown
        for idx, bd in enumerate(draft.capacity.bedroom_breakdown or [], start=1):
            await _insert(conn, sm.TBL_BEDROOMS, sm.BEDROOM_COLS, {
                "listing_id": listing_id,
                "bedroom_number": bd.get("number", idx),
                "beds": bd.get("beds"),
                "bed_type": bd.get("bed_type"),
            })

        # amenities
        for a in draft.amenities:
            aid = await _resolve_taxonomy(conn, "amenity", a, provider)
            if aid is None:
                skipped.append(f"amenity '{a}' unresolved")
                continue
            await _insert(conn, sm.TBL_AMENITIES, sm.LISTING_AMENITY_COLS, {
                "listing_id": listing_id, "amenity_id": aid,
            })

        # discounts
        if any(v is not None for v in (
            draft.pricing.new_listing_discount_pct,
            draft.pricing.weekly_discount_pct,
            draft.pricing.monthly_discount_pct,
        )):
            await _insert(conn, sm.TBL_DISCOUNTS, sm.DISCOUNT_COLS, {
                "listing_id": listing_id,
                "new_listing_pct": draft.pricing.new_listing_discount_pct,
                "weekly_pct": draft.pricing.weekly_discount_pct,
                "monthly_pct": draft.pricing.monthly_discount_pct,
            })

        # house rules
        hr = draft.house_rules
        await _insert(conn, sm.TBL_HOUSE_RULES, sm.HOUSE_RULE_COLS, {
            "listing_id": listing_id,
            "check_in_time": draft.availability.check_in_time,
            "check_out_time": draft.availability.check_out_time,
            "smoking_allowed": hr.smoking_allowed,
            "pets_allowed": hr.pets_allowed,
            "parties_allowed": hr.parties_allowed,
            "quiet_hours": hr.quiet_hours,
            "additional_rules": "\n".join(hr.additional_rules) or None,
        })

        # safety
        sfy = draft.safety
        await _insert(conn, sm.TBL_SAFETY, sm.SAFETY_COLS, {
            "listing_id": listing_id,
            "security_camera": sfy.security_camera,
            "noise_monitoring": sfy.noise_monitoring,
            "weapons_on_property": sfy.weapons_on_property,
            "smoke_alarm": sfy.smoke_alarm,
            "carbon_monoxide_alarm": sfy.carbon_monoxide_alarm,
            "first_aid_kit": sfy.first_aid_kit,
            "fire_extinguisher": sfy.fire_extinguisher,
        })

        # iCal feed(s)
        ical = record.get("ical")
        if ical and not ical.get("error"):
            await conn.execute(
                f'insert into "{IS}"."listing_ical_feeds" '
                "(listing_id, import_id, feed_url, calendar_name, last_pulled_at, last_status, "
                " blocked_dates, events) "
                "values ($1,$2,$3,$4, now(), 'ok', $5, $6)",
                listing_id, record["import_id"], ical["url"], ical.get("calendar_name"),
                ical.get("blocked_dates") or [], ical.get("events") or [],
            )

        # link the import row back to the listing
        await conn.execute(
            f'update "{IS}"."listing_imports" '
            "set listing_id = $1, status = 'published', updated_at = now() where import_id = $2",
            listing_id, record["import_id"],
        )

    return {"listing_id": listing_id, "skipped": skipped}
