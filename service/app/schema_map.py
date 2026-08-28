"""
Single source of truth for the EXISTING Hostiggo listing schema
(`hostiggo_testing_schema`).

The "Import from an Airbnb link" brainstorm describes these tables in prose but
not as DDL, so the exact column names below are best-effort. Reconcile them with
your real schema HERE and nowhere else — `publish.py` builds every INSERT from
this map, and a column set to ``None`` is simply skipped (and noted on the
import record) rather than crashing the publish.

New tables the import feature owns (`listing_imports`, `external_taxonomy_map`,
`listing_ical_feeds`) are defined in ``sql/001_import_tables.sql`` and are NOT
part of this reconciliation.
"""

from __future__ import annotations

from app.config import settings

S = settings.db_schema  # existing listing schema


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
TBL_ADDONS = "listing_addons"  # MANUAL — never written by the importer
TBL_PROPERTY_TYPES = "property_types"
TBL_STAY_TYPES = "stay_types"
TBL_AMENITY_CATALOG = "amenities"


# --------------------------------------------------------------------------- #
# listings — logical field -> real column (None = not stored / unknown -> skip)
# --------------------------------------------------------------------------- #
LISTINGS_COLS: dict[str, str | None] = {
    "id": "id",
    "host_uuid": "host_uuid",
    "title": "title",
    "description": "description",
    "property_type_id": "property_type_id",
    "stay_type_id": "stay_type_id",
    "address_line": "address_line",
    "landmark": "landmark",
    "city": "city",
    "state": "state",
    "country": "country",
    "pincode": "pincode",
    "latitude": "latitude",
    "longitude": "longitude",
    "max_guests": "max_guests",
    "bedrooms": "bedrooms",
    "beds": "beds",
    "bathrooms": "bathrooms",
    "base_price": "base_price",  # weekday nightly, INR
    "weekend_price": "weekend_price",
    "currency": "currency",
    "min_price": "min_price",
    "booking_mode": "booking_mode",  # 'instant' | 'request'
    "check_in_time": "check_in_time",
    "check_out_time": "check_out_time",
    "status": "status",  # 'draft' | 'published'
    # provenance columns added by sql/001_import_tables.sql
    "source": "source",  # 'native' | 'airbnb_import'
    "import_id": "import_id",
    "external_url": "external_url",
    "external_listing_id": "external_listing_id",
    "import_confirmed_by_host": "import_confirmed_by_host",
    # phase-2 columns from the brainstorm
    "min_nights": "min_nights",
    "max_nights": "max_nights",
    "cancellation_policy": "cancellation_policy",
    "created_at": "created_at",
    "updated_at": "updated_at",
}

MEDIA_COLS: dict[str, str | None] = {
    "id": "id",
    "listing_id": "listing_id",
    "url": "url",  # public URL of the re-hosted photo
    "storage_path": "storage_path",
    "is_cover": "is_cover",
    "sort_order": "sort_order",
    "caption": "caption",
    "source": "source",  # 'upload' | 'airbnb_import'
    "source_url": "source_url",
    "import_id": "import_id",
}

BEDROOM_COLS: dict[str, str | None] = {
    "id": "id",
    "listing_id": "listing_id",
    "bedroom_number": "bedroom_number",
    "beds": "beds",
    "bed_type": "bed_type",
}

LISTING_AMENITY_COLS: dict[str, str | None] = {
    "id": "id",
    "listing_id": "listing_id",
    "amenity_id": "amenity_id",
}

DISCOUNT_COLS: dict[str, str | None] = {
    "id": "id",
    "listing_id": "listing_id",
    "new_listing_pct": "new_listing_pct",
    "weekly_pct": "weekly_pct",
    "monthly_pct": "monthly_pct",
}

HOUSE_RULE_COLS: dict[str, str | None] = {
    "id": "id",
    "listing_id": "listing_id",
    "check_in_time": "check_in_time",
    "check_out_time": "check_out_time",
    "smoking_allowed": "smoking_allowed",
    "pets_allowed": "pets_allowed",
    "parties_allowed": "parties_allowed",
    "quiet_hours": "quiet_hours",
    "additional_rules": "additional_rules",
}

SAFETY_COLS: dict[str, str | None] = {
    "id": "id",
    "listing_id": "listing_id",
    "security_camera": "security_camera",
    "noise_monitoring": "noise_monitoring",
    "weapons_on_property": "weapons_on_property",
    "smoke_alarm": "smoke_alarm",
    "carbon_monoxide_alarm": "carbon_monoxide_alarm",
    "first_aid_kit": "first_aid_kit",
    "fire_extinguisher": "fire_extinguisher",
}

# catalog lookups: which column holds the human label to fuzzy-match against
PROPERTY_TYPE_ID = "type_id"
PROPERTY_TYPE_LABEL = "name"
STAY_TYPE_ID = "type_id"
STAY_TYPE_LABEL = "name"
AMENITY_ID = "amenity_id"
AMENITY_LABEL = "name"


def cols(mapping: dict[str, str | None], data: dict) -> tuple[list[str], list]:
    """Filter *data* to the columns that actually exist in *mapping*."""
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
