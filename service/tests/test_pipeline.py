from app.pipeline.coverage import compute_coverage
from app.pipeline.fx import to_inr
from app.pipeline.ical import parse_ical
from app.pipeline.recommendations import build_recommendations
from app.pipeline.tier1 import parse_html
from app.pipeline.truncation import detect_truncation
from app.pipeline.validate import committable_issues, validate_draft

FIXTURE_AIRBNB = """<!doctype html><html><head>
<title>Sunlit Coorg Estate Cottage - Airbnb</title>
<meta property="og:title" content="Sunlit Coorg Estate Cottage">
<meta property="og:image" content="https://a0.muscache.com/im/pictures/estate/front.jpg">
<meta name="description" content="Entire cottage in Madikeri, 4 guests, 2 bedrooms, from 6500 per night.">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"LodgingBusiness",
"name":"Sunlit Coorg Estate Cottage",
"description":"Wake up to birdsong on our coffee estate near Madikeri. This 2-bedroom cottage has a wraparound verandah, a fully equipped kitchen and a caretaker on site. Home-cooked Kodava breakfast included. Great for families wanting a quiet hill retreat close to Raja's Seat.",
"image":["https://a0.muscache.com/im/pictures/estate/front.jpg","https://a0.muscache.com/im/pictures/estate/verandah.jpg","https://a0.muscache.com/im/pictures/estate/kitchen.jpg"],
"address":{"@type":"PostalAddress","addressLocality":"Madikeri","addressRegion":"Karnataka","postalCode":"571201","addressCountry":"IN"},
"geo":{"@type":"GeoCoordinates","latitude":12.4212,"longitude":75.7285},
"aggregateRating":{"@type":"AggregateRating","ratingValue":4.92,"reviewCount":128},
"priceRange":"6500"}</script>
</head><body>
<h1>Sunlit Coorg Estate Cottage</h1>
<p>Entire cottage - 4 guests - 2 bedrooms - 3 beds - 2 bathrooms</p>
<p>6,500 per night - Free cancellation for 48 hours - Check-in after 1:00 PM, checkout 11:00 AM</p>
<p>Minimum stay 2 nights. No smoking. Pets allowed on request.</p>
<div>Wifi, Free parking on premises, Kitchen, Breakfast, Air conditioning, Power backup, Hot water, Mountain view, Garden, Washer, TV, Smoke alarm</div>
<img src="https://a0.muscache.com/im/pictures/estate/front.jpg">
<img src="https://a0.muscache.com/im/pictures/estate/verandah.jpg">
<img src="https://a0.muscache.com/im/pictures/estate/kitchen.jpg">
</body></html>"""


def test_ical_parses_blocked_dates():
    ics = "\r\n".join([
        "BEGIN:VCALENDAR", "VERSION:2.0", "X-WR-CALNAME:Coorg Cottage",
        "BEGIN:VEVENT", "DTSTART;VALUE=DATE:20260901", "DTEND;VALUE=DATE:20260904",
        "SUMMARY:Reserved", "UID:a1", "END:VEVENT",
        "BEGIN:VEVENT", "DTSTART;VALUE=DATE:20260915", "DTEND;VALUE=DATE:20260917",
        "SUMMARY:Airbnb (Not available)", "UID:a2", "END:VEVENT",
        "END:VCALENDAR",
    ])
    r = parse_ical(ics)
    assert r["calendar_name"] == "Coorg Cottage"
    assert r["event_count"] == 2
    assert r["blocked_dates"] == [
        "2026-09-01", "2026-09-02", "2026-09-03", "2026-09-15", "2026-09-16"
    ]
    assert r["events"][0].kind == "reserved"
    assert r["events"][1].kind == "blocked"


async def test_fx_converts_usd():
    c = await to_inr(100, "USD")
    assert c.inr_amount and c.inr_amount > 5000
    assert c.source_currency == "USD"
    identity = await to_inr(4000, "INR")
    assert identity.inr_amount == 4000 and identity.rate_source == "identity"


def test_tier1_extracts_hints():
    page = parse_html(FIXTURE_AIRBNB, "https://airbnb.co.in/rooms/1", 200)
    assert page.hints.city == "Madikeri"
    assert page.hints.lat == 12.4212
    assert any(pc["amount"] == 6500 for pc in page.hints.price_candidates)
    assert not detect_truncation(page).truncated  # rich JSON-LD


def test_validate_and_coverage():
    page = parse_html(FIXTURE_AIRBNB, "https://airbnb.co.in/rooms/1", 200)
    from app.pipeline.extract import _heuristic

    raw, _ = _heuristic(page)
    draft, notes = validate_draft(raw)
    assert draft.address.city == "Madikeri"
    assert draft.pricing.nightly_amount == 6500
    assert draft.capacity.max_guests == 4
    assert "wifi" in draft.amenities and "kitchen" in draft.amenities
    assert draft.property_type in ("homestay", "cottage", "house")

    cov = compute_coverage(draft, None, consent=True)
    assert cov.summary.percent_prefilled > 50
    ids = {r.id: r.status for r in cov.rows}
    assert ids["title"] == "auto"
    assert ids["location"] in ("auto", "partial")  # city+country -> auto
    assert ids["addons"] == "manual"
    # street address is hidden by the OTA -> always host-supplied; consent too
    assert "address.line" in cov.unresolved_required_fields
    assert "eligibility.host_confirmed_at" in cov.unresolved_required_fields
    assert cov.summary.required_unresolved >= 1

    recs = build_recommendations(draft)
    assert all(r.severity in ("high", "medium", "low") for r in recs)

    # committable check (city + price + 3 photos + title + desc present)
    assert committable_issues(draft) == []
