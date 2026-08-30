"""Focused unit tests for the components fixed during integration:
URL sanitiser, coverage calculator, safety/pricing payload, LLM-mock path."""

import pytest

from app.pipeline.coverage import compute_coverage
from app.pipeline.photos import sanitize_photo_url
from app.pipeline.recommendations import build_recommendations
from app.pipeline.tier1 import parse_html
from app.pipeline.validate import validate_draft
from tests.test_pipeline import FIXTURE_AIRBNB


# --------------------------------------------------------------------------- #
# 1. URL sanitiser
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize(
    "raw,expected",
    [
        ("https://a0.muscache.com/im/x.jpg", "https://a0.muscache.com/im/x.jpg"),
        ("//a0.muscache.com/im/x.jpg", "https://a0.muscache.com/im/x.jpg"),
        ("a0.muscache.com/im/x.jpg", "https://a0.muscache.com/im/x.jpg"),
        ("  https://a0.muscache.com/im/x.jpg\n", "https://a0.muscache.com/im/x.jpg"),
        ('"[https://a0.muscache.com/q.jpg](https://a0.muscache.com/q.jpg)"',
         "https://a0.muscache.com/q.jpg"),
        (r"https:\/\/a0.muscache.com\/im\/x.jpg", "https://a0.muscache.com/im/x.jpg"),
        ({"url": "https://a0.muscache.com/y.jpg"}, "https://a0.muscache.com/y.jpg"),
        (["https://a0.muscache.com/z.jpg"], "https://a0.muscache.com/z.jpg"),
        ("http://x.example.com/a.png", "https://x.example.com/a.png"),
    ],
)
def test_sanitize_photo_url_ok(raw, expected):
    assert sanitize_photo_url(raw) == expected


@pytest.mark.parametrize(
    "raw",
    [
        "data:image/png;base64,iVBORw0KGgo",
        "not a url at all",
        "{'url': broken",
        "",
        "https:// spaced host .com/x.jpg",
    ],
)
def test_sanitize_photo_url_rejects_garbage(raw):
    with pytest.raises(ValueError):
        sanitize_photo_url(raw)


# --------------------------------------------------------------------------- #
# 2. Coverage calculator
# --------------------------------------------------------------------------- #
def _draft_from_fixture(**overrides):
    from app.pipeline.extract import _heuristic

    page = parse_html(FIXTURE_AIRBNB, "https://airbnb.co.in/rooms/1", 200)
    raw, _ = _heuristic(page)
    if "safety" in overrides:
        raw["safety"] = overrides.pop("safety")  # replace, not merge
    raw["pricing"].update(overrides.pop("pricing", {}))
    for k, v in overrides.items():
        raw[k] = v
    draft, _ = validate_draft(raw)
    return draft


def test_consent_counts_as_required_unresolved():
    draft = _draft_from_fixture()
    cov = compute_coverage(draft, None, consent=True)
    # consent is required + manual -> always unresolved until publish
    assert cov.summary.required_unresolved >= 1
    assert "eligibility.host_confirmed_at" in cov.unresolved_required_fields


def test_percent_prefilled_formula():
    draft = _draft_from_fixture(safety={"smoke_alarm": True})
    cov = compute_coverage(draft, None, consent=True)
    s = cov.summary
    expected = int((s.auto + s.partial * 0.5) / len(cov.rows) * 100)
    assert s.percent_prefilled == expected
    assert 0 <= s.percent_prefilled <= 100


def test_pricing_partial_when_resolved():
    draft = _draft_from_fixture(pricing={"nightly_amount": 1800, "currency": "INR"})
    cov = compute_coverage(draft, None, consent=True)
    pricing_row = next(r for r in cov.rows if r.id == "pricing")
    assert pricing_row.status == "partial"
    assert draft.pricing.nightly_amount == 1800
    # nightly is resolved -> only the weekend price should still need host input
    assert "pricing.nightly_amount" not in cov.host_input_needed
    assert "pricing.weekend_amount" in cov.host_input_needed


# --------------------------------------------------------------------------- #
# 3. Safety payload / recommendations do not contradict
# --------------------------------------------------------------------------- #
def test_safety_block_suppresses_safety_recommendation():
    with_devices = _draft_from_fixture(safety={"smoke_alarm": True, "first_aid_kit": True})
    # a draft with no safety device anywhere (amenities or safety block)
    without = _draft_from_fixture(safety={}, amenities=["wifi", "kitchen"])
    assert "amen_safety" not in {r.id for r in build_recommendations(with_devices)}
    assert "amen_safety" in {r.id for r in build_recommendations(without)}


# --------------------------------------------------------------------------- #
# 4. LLM extraction path is mocked (no network / key needed)
# --------------------------------------------------------------------------- #
async def test_extract_falls_back_to_heuristic_without_key(monkeypatch):
    from app.pipeline import extract as ex

    monkeypatch.setattr(ex.settings, "anthropic_api_key", "", raising=False)
    page = parse_html(FIXTURE_AIRBNB, "https://airbnb.co.in/rooms/1", 200)
    result = await ex.extract_listing(page, "airbnb")
    assert result.engine in ("heuristic", "heuristic-fallback")
    assert result.raw["title"]


async def test_extract_uses_mocked_anthropic(monkeypatch):
    from types import SimpleNamespace

    from app.pipeline import extract as ex

    block = SimpleNamespace(
        type="tool_use",
        input={
            "title": "Mocked Villa",
            "description": "A mocked description long enough to pass validation checks here.",
            "property_type": "villa",
            "stay_type": "entire_property",
            "capacity": {"max_guests": 4},
            "pricing": {"nightly_amount": 5000, "currency": "INR"},
        },
    )

    class _Messages:
        async def create(self, **_):
            return SimpleNamespace(content=[block])

    class _FakeClient:
        def __init__(self, *a, **k):
            self.messages = _Messages()

    monkeypatch.setattr(ex.settings, "anthropic_api_key", "sk-test", raising=False)
    import anthropic

    monkeypatch.setattr(anthropic, "AsyncAnthropic", _FakeClient)

    page = parse_html(FIXTURE_AIRBNB, "https://airbnb.co.in/rooms/1", 200)
    result = await ex.extract_listing(page, "airbnb")
    assert result.engine == "anthropic"
    assert result.raw["title"] == "Mocked Villa"
    draft, _notes = validate_draft(result.raw)
    assert draft.pricing.nightly_amount == 5000
