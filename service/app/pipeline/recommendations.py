from __future__ import annotations

import re

from app.models import ListingDraft, Recommendation

_HIGH_VALUE = (
    "wifi", "air_conditioning", "kitchen", "free_parking", "washer",
    "power_backup", "hot_water", "workspace",
)
_ORDER = {"high": 0, "medium": 1, "low": 2}


def build_recommendations(draft: ListingDraft) -> list[Recommendation]:
    recs: list[Recommendation] = []

    def r(id_, sev, field, title, detail):
        recs.append(Recommendation(id=id_, severity=sev, field=field, title=title, detail=detail))

    n = len(draft.photos)
    if n < 3:
        r("photos_min", "high", "photos", f"Only {n} photo(s) imported",
          "Listings need at least 3 photos to publish; 15-25 is ideal.")
    elif n < 8:
        r("photos_few", "medium", "photos", f"{n} photos is on the low side",
          "15+ photos convert noticeably better — add room-by-room shots, the exterior and views.")

    t = draft.title
    if t and t != "Untitled listing":
        if len(t) < 20:
            r("title_short", "medium", "title", "Title is very short",
              "Aim for 35-50 characters; lead with the standout feature.")
        if len(t) > 65:
            r("title_long", "low", "title", "Title may be truncated in search",
              "Keep it under ~50 characters.")
        if re.search(r"\b(best|amazing|awesome|perfect|luxur(y|ious))\b", t, re.IGNORECASE):
            r("title_hype", "low", "title", "Title uses generic hype words",
              "Swap superlatives for concrete detail.")

    dl = len(draft.description.strip())
    if 0 < dl < 300:
        r("desc_thin", "high", "description", "Description is thin",
          f"{dl} characters. Add the layout, neighbourhood, who it suits, how to get there. "
          "Target 600-1500.")
    elif 300 <= dl < 600:
        r("desc_short", "medium", "description", "Description could be fuller",
          "Add a paragraph on the neighbourhood and transport links.")
    if dl and not re.search(
        r"\b(metro|station|airport|km|min(ute)?s?|walk|drive|nearby|close to)\b",
        draft.description, re.IGNORECASE,
    ):
        r("desc_no_location_cues", "medium", "description",
          "No distance / transport cues in the description",
          "Mention walking time to landmarks and distance to the station/airport.")

    have = set(draft.amenities)
    missing_hv = [a for a in _HIGH_VALUE if a not in have]
    if len(draft.amenities) < 5:
        r("amen_few", "high", "amenities", f"Only {len(draft.amenities)} amenities mapped",
          "Review and tick everything the property actually has.")
    if missing_hv:
        r("amen_high_value", "medium", "amenities", "High-value amenities not set",
          f"Guests filter hard on: {', '.join(missing_hv)}. Confirm whether the property has these.")
    sfy = draft.safety
    has_safety = any((
        sfy.smoke_alarm, sfy.carbon_monoxide_alarm, sfy.fire_extinguisher, sfy.first_aid_kit,
    )) or any(a in have for a in ("smoke_alarm", "carbon_monoxide_alarm", "fire_extinguisher",
                                  "first_aid_kit"))
    if not has_safety:
        r("amen_safety", "medium", "safety", "No safety equipment listed",
          "Add smoke alarm / fire extinguisher / first-aid kit.")

    c = draft.capacity
    if c.beds is not None and c.max_guests is not None and c.beds * 2 < c.max_guests:
        r("cap_beds_guests", "low", "capacity", "Guest count looks high for the bed count",
          f"{c.max_guests} guests but {c.beds} bed(s) — check the sleeping arrangement.")
    if c.bathrooms == 0:
        r("cap_no_bath", "medium", "capacity", "No bathrooms recorded",
          "Set the bathroom count — it's a hard filter for most guests.")

    if draft.pricing.nightly_amount is None:
        r("price_missing", "high", "pricing", "No nightly price imported",
          "The source hid the rate. Set the INR weekday and weekend price before publishing.")
    if draft.pricing.currency != "INR":
        r("price_currency", "medium", "pricing", f"Price is in {draft.pricing.currency}",
          "Converted to INR at a static rate — confirm the final number.")

    if not draft.availability.check_in_time or not draft.availability.check_out_time:
        r("rules_check_times", "medium", "house_rules", "Check-in / check-out times missing",
          "Set both — guests plan travel around them.")
    if not any((draft.house_rules.smoking_allowed is not None,
                draft.house_rules.pets_allowed is not None,
                draft.house_rules.additional_rules)):
        r("rules_none", "low", "house_rules", "No house rules imported",
          "Add rules on smoking, pets, parties and quiet hours.")

    if draft.cancellation_policy == "unknown":
        r("cancellation", "low", "cancellation_policy", "Cancellation policy not detected",
          "Pick a policy (flexible / moderate / firm / strict).")
    if draft.location.lat is None:
        r("geo_missing", "medium", "location", "No map coordinates",
          "Drop the map pin manually so distance-based search works.")

    return sorted(recs, key=lambda x: _ORDER[x.severity])
