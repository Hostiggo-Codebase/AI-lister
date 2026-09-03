from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, Field

from app.taxonomy import (
    AMENITIES,
    BOOKING_MODES,
    CANCELLATION_POLICIES,
    PROPERTY_TYPES,
    STAY_TYPES,
)

Provider = Literal["airbnb", "booking", "agoda", "makemytrip", "goibibo", "unknown"]


class JobStatus(str, Enum):
    pending = "pending"
    fetching = "fetching"
    parsed = "parsed"
    needs_review = "needs_review"
    published = "published"
    failed = "failed"


class Stage(str, Enum):
    queued = "queued"
    tier1_fetch = "tier1_fetch"
    truncation_check = "truncation_check"
    tier2_scrape = "tier2_scrape"
    llm_extract = "llm_extract"
    validate = "validate"
    fx_convert = "fx_convert"
    coverage = "coverage"
    photo_mirror = "photo_mirror"
    done = "done"


# --------------------------------------------------------------------------- #
# Draft shapes
# --------------------------------------------------------------------------- #
class Address(BaseModel):
    line: str | None = None
    landmark: str | None = None
    city: str | None = None
    state: str | None = None
    country: str | None = None
    postal_code: str | None = None


class GeoPoint(BaseModel):
    lat: float | None = None
    lng: float | None = None


class Capacity(BaseModel):
    max_guests: int | None = None
    bedrooms: int | None = None
    beds: int | None = None
    bathrooms: float | None = None
    bedroom_breakdown: list[dict[str, Any]] = Field(default_factory=list)


class Pricing(BaseModel):
    nightly_amount: float | None = None
    weekend_amount: float | None = None
    currency: str = "INR"
    cleaning_fee: float | None = None
    new_listing_discount_pct: float | None = None
    weekly_discount_pct: float | None = None
    monthly_discount_pct: float | None = None


class Availability(BaseModel):
    min_nights: int | None = None
    max_nights: int | None = None
    check_in_time: str | None = None
    check_out_time: str | None = None


class HouseRules(BaseModel):
    smoking_allowed: bool | None = None
    pets_allowed: bool | None = None
    parties_allowed: bool | None = None
    quiet_hours: str | None = None
    additional_rules: list[str] = Field(default_factory=list)


class Safety(BaseModel):
    security_camera: bool | None = None
    noise_monitoring: bool | None = None
    weapons_on_property: bool | None = None
    smoke_alarm: bool | None = None
    carbon_monoxide_alarm: bool | None = None
    first_aid_kit: bool | None = None
    fire_extinguisher: bool | None = None


class Photo(BaseModel):
    url: str
    caption: str | None = None


class ListingDraft(BaseModel):
    """The normalized, review-ready Hostiggo draft."""

    title: str = "Untitled listing"
    summary: str | None = None
    description: str = ""
    property_type: str = "homestay"
    stay_type: str = "entire_property"
    booking_mode: str | None = None
    address: Address = Field(default_factory=Address)
    location: GeoPoint = Field(default_factory=GeoPoint)
    capacity: Capacity = Field(default_factory=Capacity)
    pricing: Pricing = Field(default_factory=Pricing)
    availability: Availability = Field(default_factory=Availability)
    amenities: list[str] = Field(default_factory=list)
    amenities_unmapped: list[str] = Field(default_factory=list)
    house_rules: HouseRules = Field(default_factory=HouseRules)
    safety: Safety = Field(default_factory=Safety)
    cancellation_policy: str = "unknown"
    photos: list[Photo] = Field(default_factory=list)
    host_name: str | None = None
    ratings_overall: float | None = None
    ratings_count: int | None = None


# --------------------------------------------------------------------------- #
# Reports
# --------------------------------------------------------------------------- #
FieldStatus = Literal["ok", "coerced", "clamped", "dropped", "missing"]


class FieldNote(BaseModel):
    path: str
    status: FieldStatus
    note: str


CoverageStatus = Literal["auto", "partial", "manual", "missing"]


class CoverageRow(BaseModel):
    id: str
    label: str
    required: bool
    status: CoverageStatus
    value: str
    note: str


class CoverageSummary(BaseModel):
    auto: int
    partial: int
    manual: int
    missing: int
    required_unresolved: int
    percent_prefilled: int


class Coverage(BaseModel):
    rows: list[CoverageRow]
    summary: CoverageSummary
    unresolved_required_fields: list[str] = Field(default_factory=list)
    host_input_needed: list[str] = Field(default_factory=list)


class Recommendation(BaseModel):
    id: str
    severity: Literal["high", "medium", "low"]
    field: str
    title: str
    detail: str


class FxConversion(BaseModel):
    source_amount: float | None = None
    source_currency: str = "INR"
    inr_amount: float | None = None
    fx_rate: float = 1.0
    rate_source: Literal["static-table", "identity", "api", "unknown"] = "identity"
    note: str | None = None


# --------------------------------------------------------------------------- #
# iCal
# --------------------------------------------------------------------------- #
class IcalEvent(BaseModel):
    uid: str | None = None
    summary: str | None = None
    start: str | None = None
    end: str | None = None
    status: str | None = None
    kind: Literal["reserved", "blocked", "other"] = "other"


class IcalFeed(BaseModel):
    url: str
    fetched_at: str
    calendar_name: str | None = None
    event_count: int = 0
    events: list[IcalEvent] = Field(default_factory=list)
    blocked_dates: list[str] = Field(default_factory=list)
    error: str | None = None


# --------------------------------------------------------------------------- #
# API payloads
# --------------------------------------------------------------------------- #
class CreateImport(BaseModel):
    url: str
    host_uuid: str | None = None
    host_confirmed_ownership: bool
    force_tier2: bool = False
    skip_photo_mirror: bool = False


class ScanProfile(BaseModel):
    url: str


class CreateBatch(BaseModel):
    urls: list[str] = Field(min_length=1, max_length=40)
    host_uuid: str | None = None
    host_confirmed_ownership: bool
    source_url: str | None = None
    host_name: str | None = None
    force_tier2: bool = False
    skip_photo_mirror: bool = False


class AttachIcal(BaseModel):
    url: str


class PatchImport(BaseModel):
    normalized_payload: dict[str, Any] = Field(default_factory=dict)


class CommitImport(BaseModel):
    draft: ListingDraft | None = None
    confirm: bool = True


class ImportRecord(BaseModel):
    import_id: int
    listing_id: int | None = None
    batch_id: int | None = None
    host_uuid: str | None = None
    source: str
    source_url: str
    external_listing_id: str | None = None
    provider: Provider
    status: JobStatus
    stage: Stage
    tier_used: int | None = None
    host_confirmed_ownership: bool
    raw_payload: dict | None = None
    normalized_payload: ListingDraft | None = None
    field_coverage: Coverage | None = None
    recommendations: list[Recommendation] = Field(default_factory=list)
    fx: FxConversion | None = None
    ical: IcalFeed | None = None
    source_currency: str | None = None
    fx_rate: float | None = None
    source_photo_urls: list[str] = Field(default_factory=list)
    mirrored_photos: list[dict] = Field(default_factory=list)
    logs: list[dict] = Field(default_factory=list)
    error_message: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


LLM_TOOL_SCHEMA: dict = {
    "type": "object",
    "additionalProperties": False,
    "required": ["title", "description", "property_type", "stay_type", "capacity", "pricing"],
    "properties": {
        "title": {"type": "string", "maxLength": 120},
        "summary": {"type": ["string", "null"], "maxLength": 400},
        "description": {"type": "string"},
        "property_type": {"type": "string", "enum": PROPERTY_TYPES},
        "stay_type": {"type": "string", "enum": STAY_TYPES},
        "booking_mode": {"type": ["string", "null"], "enum": [*BOOKING_MODES, None]},
        "address": {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "line": {"type": ["string", "null"]},
                "landmark": {"type": ["string", "null"]},
                "city": {"type": ["string", "null"]},
                "state": {"type": ["string", "null"]},
                "country": {"type": ["string", "null"]},
                "postal_code": {"type": ["string", "null"]},
            },
        },
        "location": {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "lat": {"type": ["number", "null"]},
                "lng": {"type": ["number", "null"]},
            },
        },
        "capacity": {
            "type": "object",
            "additionalProperties": False,
            "required": ["max_guests"],
            "properties": {
                "max_guests": {"type": "integer", "minimum": 1, "maximum": 50},
                "bedrooms": {"type": ["integer", "null"], "minimum": 0, "maximum": 30},
                "beds": {"type": ["integer", "null"], "minimum": 0, "maximum": 60},
                "bathrooms": {"type": ["number", "null"], "minimum": 0, "maximum": 30},
                "bedroom_breakdown": {
                    "type": "array",
                    "items": {"type": "object"},
                    "description": "Per-bedroom sleeping arrangement if stated.",
                },
            },
        },
        "pricing": {
            "type": "object",
            "additionalProperties": False,
            "required": ["nightly_amount", "currency"],
            "properties": {
                "nightly_amount": {"type": ["number", "null"], "minimum": 0},
                "currency": {"type": "string"},
                "cleaning_fee": {"type": ["number", "null"], "minimum": 0},
                "weekly_discount_pct": {"type": ["number", "null"], "minimum": 0, "maximum": 100},
                "monthly_discount_pct": {"type": ["number", "null"], "minimum": 0, "maximum": 100},
            },
        },
        "availability": {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "min_nights": {"type": ["integer", "null"], "minimum": 1},
                "max_nights": {"type": ["integer", "null"], "minimum": 1},
                "check_in_time": {"type": ["string", "null"]},
                "check_out_time": {"type": ["string", "null"]},
            },
        },
        "amenities": {"type": "array", "items": {"type": "string"}},
        "house_rules": {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "smoking_allowed": {"type": ["boolean", "null"]},
                "pets_allowed": {"type": ["boolean", "null"]},
                "parties_allowed": {"type": ["boolean", "null"]},
                "quiet_hours": {"type": ["string", "null"]},
                "additional_rules": {"type": "array", "items": {"type": "string"}},
            },
        },
        "safety": {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "security_camera": {"type": ["boolean", "null"]},
                "noise_monitoring": {"type": ["boolean", "null"]},
                "weapons_on_property": {"type": ["boolean", "null"]},
                "smoke_alarm": {"type": ["boolean", "null"]},
                "carbon_monoxide_alarm": {"type": ["boolean", "null"]},
                "first_aid_kit": {"type": ["boolean", "null"]},
                "fire_extinguisher": {"type": ["boolean", "null"]},
            },
        },
        "cancellation_policy": {"type": "string", "enum": CANCELLATION_POLICIES},
        "photos": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["url"],
                "properties": {
                    "url": {"type": "string"},
                    "caption": {"type": ["string", "null"]},
                },
            },
        },
        "host": {
            "type": "object",
            "additionalProperties": False,
            "properties": {"name": {"type": ["string", "null"]}},
        },
        "ratings": {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "overall": {"type": ["number", "null"], "minimum": 0, "maximum": 5},
                "count": {"type": ["integer", "null"], "minimum": 0},
            },
        },
    },
}

_ = (AMENITIES,)  # referenced by validate.py
