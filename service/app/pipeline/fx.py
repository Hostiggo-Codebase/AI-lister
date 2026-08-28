from __future__ import annotations

import httpx

from app.config import settings
from app.models import FxConversion

STATIC_RATES_TO_INR: dict[str, float] = {
    "INR": 1.0, "USD": 83.3, "EUR": 90.1, "GBP": 105.6, "AUD": 55.2, "CAD": 61.0,
    "AED": 22.7, "SGD": 61.8, "THB": 2.35, "LKR": 0.28, "NPR": 0.625,
}


async def _api_rate(currency: str) -> float | None:
    if not settings.fx_api_url:
        return None
    try:
        async with httpx.AsyncClient(timeout=10) as c:
            r = await c.get(settings.fx_api_url, params={"from": currency, "to": "INR"})
            r.raise_for_status()
            data = r.json()
            for key in ("rate", "result", "INR", "value"):
                if isinstance(data.get(key), (int, float)):
                    return float(data[key])
    except (httpx.HTTPError, ValueError, KeyError):
        return None
    return None


async def to_inr(amount: float | None, currency: str) -> FxConversion:
    cur = (currency or "INR").upper()
    if cur == "INR":
        return FxConversion(
            source_amount=amount, source_currency="INR", inr_amount=amount,
            fx_rate=1.0, rate_source="identity",
        )
    rate = await _api_rate(cur)
    source: str = "api" if rate else "static-table"
    if rate is None:
        rate = STATIC_RATES_TO_INR.get(cur)
    if rate is None:
        return FxConversion(
            source_amount=amount, source_currency=cur, inr_amount=None, fx_rate=1.0,
            rate_source="unknown",
            note=f"No FX rate for {cur} — host must set the INR price manually.",
        )
    if amount is None:
        return FxConversion(source_amount=None, source_currency=cur, inr_amount=None,
                            fx_rate=rate, rate_source=source)
    inr = round(amount * rate)
    return FxConversion(
        source_amount=amount, source_currency=cur, inr_amount=inr, fx_rate=rate,
        rate_source=source,
        note=f"Converted {amount} {cur} -> ₹{inr} at {rate} — host should confirm.",
    )
