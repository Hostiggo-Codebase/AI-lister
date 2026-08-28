from __future__ import annotations

from app.models import Coverage, CoverageRow, CoverageSummary, FxConversion, ListingDraft

_SAFETY_DEVICES = ("smoke_alarm", "carbon_monoxide_alarm", "first_aid_kit", "fire_extinguisher")


def _join(*xs) -> str:
    return ", ".join(str(x) for x in xs if x not in (None, "", []))


def compute_coverage(draft: ListingDraft, fx: FxConversion | None, consent: bool) -> Coverage:
    rows: list[CoverageRow] = []

    def row(id_, label, required, status, value, note):
        rows.append(CoverageRow(id=id_, label=label, required=required, status=status,
                                value=value, note=note))

    cap = draft.capacity
    photos = len(draft.photos)
    amen = len(draft.amenities)
    has_times = bool(draft.availability.check_in_time or draft.availability.check_out_time)
    rules = draft.house_rules
    rule_count = (
        sum(x is not None for x in (rules.smoking_allowed, rules.pets_allowed, rules.parties_allowed))
        + len(rules.additional_rules)
    )
    sf = draft.safety
    safety_devices = [d for d in _SAFETY_DEVICES if getattr(sf, d, None)]

    row("property_type", "Property type", True, "auto" if draft.property_type else "missing",
        draft.property_type, "Mapped onto the 19 Hostiggo types — confirm the closest match.")
    row("stay_type", "Stay type", True, "auto" if draft.stay_type else "missing",
        draft.stay_type, "Maps 1:1 from the source room type.")
    row("location", "Location", True, "partial" if draft.address.city else "missing",
        _join(draft.address.line, draft.address.city, draft.address.state,
              draft.address.postal_code)
        or (f"~{draft.location.lat}, {draft.location.lng}" if draft.location.lat is not None else ""),
        "OTAs hide the exact street address & pincode until booking — host confirms the precise "
        "address and map pin.")
    cap_totals = sum(x is not None for x in (cap.max_guests, cap.bedrooms, cap.beds, cap.bathrooms))
    row("capacity", "Capacity", True,
        "missing" if cap.max_guests is None else ("auto" if cap_totals >= 3 else "partial"),
        _join(f"{cap.max_guests} guests" if cap.max_guests else None,
              f"{cap.bedrooms} BR" if cap.bedrooms is not None else None,
              f"{cap.beds} beds" if cap.beds is not None else None,
              f"{cap.bathrooms} bath" if cap.bathrooms is not None else None),
        "Totals import cleanly; the per-bedroom sleeping split usually needs a host review.")
    row("amenities", "Amenities / facilities", False, "missing" if amen == 0 else "auto",
        f"{amen} mapped" + (f": {', '.join(draft.amenities[:6])}" if amen else ""),
        "Source amenities mapped to the 22 Hostiggo facilities; unmatched are dropped.")
    row("photos", "Photos", True,
        "auto" if photos >= 3 else ("partial" if photos else "missing"),
        f"{photos} photo(s), re-hosted",
        "First photo becomes the cover." if photos >= 3 else "Need at least 3 photos to publish.")
    row("title", "Listing title", True,
        "auto" if draft.title and draft.title != "Untitled listing" else "missing",
        draft.title, "Comes straight from the source title.")
    row("description", "Description", True, "auto" if draft.description else "missing",
        f"{len(draft.description)} chars" if draft.description else "",
        "Full write-up imported from the source.")
    row("booking_mode", "Booking mode", False,
        "auto" if draft.booking_mode else "manual", draft.booking_mode or "",
        "Instant-book vs request-to-book — host confirms.")
    price_status = "partial" if (fx and fx.inr_amount is not None) or draft.pricing.nightly_amount is not None else "missing"
    row("pricing", "Pricing", True, price_status,
        (f"₹{fx.inr_amount}/night (from {fx.source_amount} {fx.source_currency})"
         if fx and fx.inr_amount is not None and fx.source_currency != "INR"
         else (f"₹{draft.pricing.nightly_amount}/night" if draft.pricing.nightly_amount is not None else "")),
        "Base nightly rate imports (converted to INR); the weekend differential isn't exposed — "
        "host sets it.")
    disc = draft.pricing.weekly_discount_pct
    row("discounts", "Discounts", False, "partial" if disc is not None else "manual",
        f"{disc}% weekly" if disc is not None else "",
        "Weekly/monthly discounts sometimes import; the new-listing promo is Hostiggo-specific.")
    row("addons", "Add-ons", False, "manual", "",
        "Breakfast, chef, treks, transport, photography — no OTA equivalent, always host-entered.")
    row("house_rules", "House rules", False,
        "auto" if rule_count or has_times else "missing",
        _join(f"in {draft.availability.check_in_time} / out {draft.availability.check_out_time}"
              if has_times else None, f"{rule_count} rule(s)" if rule_count else None),
        "Check-in/out and house rules map directly when present.")
    row("safety", "Safety details", False, "partial" if safety_devices else "missing",
        ", ".join(safety_devices),
        "Devices come from the source safety section; 'weapons on property' defaults to host "
        "confirmation.")
    row("eligibility_consent", "Eligibility & consent", True,
        "manual" if consent else "missing",
        "ownership attested at import" if consent else "",
        "Hostiggo consent — always confirmed by the host, never imported.")

    def c(s):
        return sum(r.status == s for r in rows)

    prefilled = sum(r.status in ("auto", "partial") for r in rows)
    return Coverage(
        rows=rows,
        summary=CoverageSummary(
            auto=c("auto"), partial=c("partial"), manual=c("manual"), missing=c("missing"),
            required_unresolved=sum(r.required and r.status == "missing" for r in rows),
            percent_prefilled=round(prefilled / len(rows) * 100),
        ),
    )
