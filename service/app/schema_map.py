"""
Single source of truth for the EXISTING Hostiggo listing schema
(`hostiggo_testing_schema`). Reconciled 2026-08-30 against the live DB.

`publish.py` builds every INSERT from this map. A column mapped to ``None`` is
skipped (and reported on the import's `skipped` list) rather than crashing.
"""

from __future__ import annotations

from app.config import settings

S = settings.db_schema


def t(name: str) -> str:
    return f'"{S}"."{name}"'


# --------------------------------------------------------------------------- #
# Table names
# --------------------------------------------------------------------------- #
TBL_LISTINGS = "listings"
TBL_MEDIA = "listing_media"
TBL_BEDROOMS = "listing_bedrooms"
TBL_AMENITIES = "listing_amenities"
TBL_DISCOUNTS = "listing_discounts"
TBL_HOUSE_RULES = "listing_house_rules"
TBL_SAFETY = "listing_safety"
TBL_PROPERTY_TYPES = "property_types"
TBL_STAY_TYPES = "stay_types"
TBL_AMENITY_CATALOG = "amenities"

# --------------------------------------------------------------------------- #
# listings — logical field -> real column
# --------------------------------------------------------------------------- #
LISTINGS_PK = "listing_id"
LISTINGS_COLS: dict[str, str | None] = {
    "id": "listing_id",
    "host_uuid": "host_uuid",
    "title": "title",
    "description": "description",
    "property_type_id": "property_type_id",
    "stay_type_id": "stay_type_id",
    "address_line1": "address_line1",
    "address_line2": "address_line2",
    "landmark": "landmark",
    "pincode": "pincode",  # integer
    "latitude": "latitude",
    "longitude": "longitude",
    "num_guests": "num_guests",
    "num_bedrooms": "num_bedrooms",
    "num_beds": "num_beds",
    "num_bathrooms": "num_bathrooms",  # integer
    "price_weekday": "price_weekday",
    "price_weekend": "price_weekend",
    "currency": "currency",
    "booking_mode": "booking_mode",
    "check_in_time": "check_in_time",
    "check_out_time": "check_out_time",
    "cancellation_policy": "cancellation_policy",
    "ical_link": "icalLink",
    "is_active": "is_active",
    # provenance columns added by sql/004_provenance.sql
    "source": "source",
    "import_id": "import_id",
    "external_url": "external_url",
    "external_listing_id": "external_listing_id",
    "import_confirmed_by_host": "import_confirmed_by_host",
    "min_nights": "min_nights",
    "max_nights": "max_nights",
}

MEDIA_COLS: dict[str, str | None] = {
    "id": "id",
    "listing_id": "listing_id",
    "media_url": "media_url",
    "media_type": "media_type",  # 'image'
    "is_cover": "is_cover",
    # provenance columns added by sql/004
    "source": "source",
    "source_url": "source_url",
    "import_id": "import_id",
}

BEDROOM_COLS: dict[str, str | None] = {
    "id": "id",
    "listing_id": "listing_id",
    "bedroom_index": "bedroom_index",
    "beds": "beds",
    "bathrooms": "bathrooms",
    "max_guests": "max_guests",
}

LISTING_AMENITY_COLS: dict[str, str | None] = {
    "id": None,  # composite (listing_id, amenity_id) — no surrogate key
    "listing_id": "listing_id",
    "amenity_id": "amenity_id",
}

DISCOUNT_COLS: dict[str, str | None] = {
    "id": "id",
    "listing_id": "listing_id",
    "discount_type": "discount_type",  # 'weekly' | 'monthly' | 'new_listing'
    "percent": "percent",
    "enabled": "enabled",
    "min_stay_nights": "min_stay_nights",
}

HOUSE_RULE_COLS: dict[str, str | None] = {
    "id": "id",
    "listing_id": "listing_id",
    "check_in_time": "check_in_time",
    "check_out_time": "check_out_time",
    "smoking_allowed": "smoking_allowed",
    "pets_allowed": "pets_allowed",
    "parties_allowed": "parties_allowed",
    "quiet_hours": "quiet_hours",  # BOOLEAN in this schema
}

SAFETY_COLS: dict[str, str | None] = {
    "id": None,
    "listing_id": "listing_id",
    "security_camera": "security_camera",
    "noise_monitoring": "noise_monitoring",
    "weapons": "weapons",
    "smoke_alarm": "smoke_alarm",
}

# catalog lookups
PROPERTY_TYPE_ID = "id"          # FK target = property_types.id
PROPERTY_TYPE_SLUG = "type_id"   # text slug column, e.g. 'house', 'guest-house'
PROPERTY_TYPE_LABEL = "name"
STAY_TYPE_ID = "id"
STAY_TYPE_SLUG = "type_id"       # 'entire' | 'private' | 'shared'
STAY_TYPE_LABEL = "title"
AMENITY_ID = "amenity_id"
AMENITY_LABEL = "name"


def cols(mapping: dict[str, str | None], data: dict) -> tuple[list[str], list]:
    keys, values = [], []
    for logical, value in data.items():
        col = mapping.get(logical)
        if col is None:
            continue
        keys.append(f'"{col}"')
        values.append(value)
    return keys, values


def unknown_fields(mapping: dict[str, str | None], data: dict) -> list[str]:
    return [k for k in data if mapping.get(k) is None]
