"""
Hostiggo's own taxonomies + the fallback code-level mapping from OTA vocabulary.

At runtime `resolve_*` first consults the DB table `external_taxonomy_map`
(seeded from ``sql/002_taxonomy_seed.sql``); these constants are the offline
fallback and the seed source.
"""

from __future__ import annotations

import re

# --- 19 property types (Popular / Unique / Specialty) ----------------------- #
PROPERTY_TYPES = [
    "house", "apartment", "villa", "cabin", "cottage", "bungalow", "farm_stay",
    "guesthouse", "boutique_hotel", "hostel", "homestay", "houseboat", "boat",
    "treehouse", "dome", "yurt", "cave", "tent", "other",
]

# --- 3 stay types ---------------------------------------------------------- #
STAY_TYPES = ["entire_property", "private_room", "shared_space"]

# --- 22 facilities in 4 groups ------------------------------------------------ #
AMENITIES = [
    # essentials
    "wifi", "air_conditioning", "heating", "kitchen", "washer", "tv", "workspace",
    # features
    "pool", "hot_tub", "free_parking", "gym", "balcony", "garden", "bbq_grill",
    # safety
    "smoke_alarm", "carbon_monoxide_alarm", "fire_extinguisher", "first_aid_kit",
    # location / services
    "breakfast", "power_backup", "hot_water", "elevator",
]

CANCELLATION_POLICIES = ["flexible", "moderate", "firm", "strict", "non_refundable", "unknown"]
BOOKING_MODES = ["instant", "request"]

# --------------------------------------------------------------------------- #
# OTA free-text -> Hostiggo enum (fallback used when the DB map misses)
# --------------------------------------------------------------------------- #
_PROP_MAP: list[tuple[str, str]] = [
    (r"villa", "villa"), (r"apart(ment)?|flat|condo", "apartment"),
    (r"cabin|log home", "cabin"), (r"cottage", "cottage"), (r"bungalow", "bungalow"),
    (r"farm ?stay|farmhouse|agriturismo", "farm_stay"), (r"guest ?house|guest ?suite", "guesthouse"),
    (r"boutique|hotel", "boutique_hotel"), (r"hostel", "hostel"),
    (r"home ?stay|bed and breakfast|b&b", "homestay"),
    (r"house ?boat", "houseboat"), (r"\bboat\b|yacht", "boat"),
    (r"tree ?house", "treehouse"), (r"dome", "dome"), (r"yurt", "yurt"),
    (r"cave", "cave"), (r"tent|camp", "tent"), (r"house|home|place", "house"),
]

_STAY_MAP: list[tuple[str, str]] = [
    (r"entire", "entire_property"),
    (r"private room", "private_room"),
    (r"shared", "shared_space"),
]

_AMENITY_MAP: list[tuple[str, str]] = [
    (r"wi[\s-]?fi|wireless internet|internet", "wifi"),
    (r"air.?condition|\bac\b|a/c", "air_conditioning"),
    (r"heating|heater|radiator|bukhari", "heating"),
    (r"kitchen|kitchenette", "kitchen"),
    (r"washing machine|washer", "washer"),
    (r"\btv\b|television|hdtv|cable", "tv"),
    (r"workspace|work desk|dedicated workspace", "workspace"),
    (r"swimming pool|\bpool\b", "pool"),
    (r"hot tub|jacuzzi", "hot_tub"),
    (r"free.*parking|free parking on premises|complimentary parking|\bparking\b", "free_parking"),
    (r"\bgym\b|fitness|exercise equipment", "gym"),
    (r"balcony|terrace|patio", "balcony"),
    (r"garden|lawn|backyard|private backyard", "garden"),
    (r"bbq|barbecue|grill", "bbq_grill"),
    (r"smoke (alarm|detector)", "smoke_alarm"),
    (r"carbon monoxide", "carbon_monoxide_alarm"),
    (r"fire extinguisher", "fire_extinguisher"),
    (r"first aid", "first_aid_kit"),
    (r"breakfast", "breakfast"),
    (r"power backup|generator|inverter|ups", "power_backup"),
    (r"hot water|geyser", "hot_water"),
    (r"elevator|lift", "elevator"),
]


def _match(value: str, table: list[tuple[str, str]]) -> str | None:
    s = value.lower().strip()
    for pat, out in table:
        if re.search(pat, s):
            return out
    return None


def nearest_property_type(value: str | None) -> str:
    if not value:
        return "homestay"
    s = value.lower().replace(" ", "_").replace("-", "_")
    if s in PROPERTY_TYPES:
        return s
    return _match(value, _PROP_MAP) or "homestay"


def nearest_stay_type(value: str | None) -> str:
    if not value:
        return "entire_property"
    s = value.lower().replace(" ", "_").replace("-", "_")
    if s in STAY_TYPES:
        return s
    return _match(value, _STAY_MAP) or "entire_property"


def normalize_amenity(value: str) -> str | None:
    s = value.lower().strip()
    if s in AMENITIES:
        return s
    return _match(value, _AMENITY_MAP)


def nearest_cancellation(value: str | None) -> str:
    if not value:
        return "unknown"
    s = value.lower()
    for p in CANCELLATION_POLICIES:
        if p.replace("_", " ") in s or p in s:
            return p
    if "free cancellation" in s:
        return "flexible"
    return "unknown"
