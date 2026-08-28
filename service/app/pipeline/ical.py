from __future__ import annotations

import re
from datetime import UTC, date, datetime, timedelta

import httpx

from app.config import settings
from app.models import IcalEvent, IcalFeed

_RESERVED = re.compile(r"reserv|booked|guest", re.IGNORECASE)
_BLOCKED = re.compile(r"not available|blocked|unavailable|closed|owner", re.IGNORECASE)


def _unfold(raw: str) -> list[str]:
    out: list[str] = []
    for line in raw.replace("\r\n", "\n").split("\n"):
        if line[:1] in (" ", "\t") and out:
            out[-1] += line[1:]
        else:
            out.append(line)
    return out


def _parse_date(v: str) -> str | None:
    m = re.search(r"(\d{4})(\d{2})(\d{2})", v)
    return f"{m.group(1)}-{m.group(2)}-{m.group(3)}" if m else None


def _each_date(start: str, end_exclusive: str) -> list[str]:
    d = date.fromisoformat(start)
    end = date.fromisoformat(end_exclusive)
    out: list[str] = []
    while d < end and len(out) < 1000:
        out.append(d.isoformat())
        d += timedelta(days=1)
    return out


def parse_ical(text: str) -> dict:
    lines = _unfold(text)
    calendar_name: str | None = None
    events: list[IcalEvent] = []
    cur: dict | None = None

    for line in lines:
        if ":" not in line:
            continue
        key_part, _, value = line.partition(":")
        value = value.strip()
        key = key_part.split(";")[0].upper()

        if key == "X-WR-CALNAME":
            calendar_name = value
        elif line.upper().startswith("BEGIN:VEVENT"):
            cur = {}
        elif line.upper().startswith("END:VEVENT"):
            if cur is not None:
                blob = f"{cur.get('summary')} {cur.get('status')}"
                kind = (
                    "reserved" if _RESERVED.search(blob)
                    else "blocked" if _BLOCKED.search(blob)
                    else "other"
                )
                events.append(IcalEvent(
                    uid=cur.get("uid"), summary=cur.get("summary"),
                    start=cur.get("start"), end=cur.get("end"),
                    status=cur.get("status"), kind=kind,
                ))
            cur = None
        elif cur is not None:
            if key == "UID":
                cur["uid"] = value
            elif key == "SUMMARY":
                cur["summary"] = value
            elif key == "STATUS":
                cur["status"] = value
            elif key == "DTSTART":
                cur["start"] = _parse_date(value)
            elif key == "DTEND":
                cur["end"] = _parse_date(value)

    blocked: set[str] = set()
    for e in events:
        if not e.start:
            continue
        for d in _each_date(e.start, e.end or e.start):
            blocked.add(d)

    return {
        "calendar_name": calendar_name,
        "event_count": len(events),
        "events": events,
        "blocked_dates": sorted(blocked),
    }


async def fetch_ical(url: str) -> IcalFeed:
    base = IcalFeed(url=url, fetched_at=datetime.now(UTC).isoformat())
    if not re.match(r"^https?://", url):
        base.error = "URL must be http(s)"
        return base
    try:
        async with httpx.AsyncClient(timeout=settings.import_fetch_timeout_s) as c:
            r = await c.get(url, headers={
                "user-agent": "HostiggoImporter/1.0", "accept": "text/calendar,*/*"
            })
        if r.status_code != 200:
            base.error = f"HTTP {r.status_code}"
            return base
        if "BEGIN:VCALENDAR" not in r.text:
            base.error = "response is not an iCalendar feed"
            return base
        parsed = parse_ical(r.text)
        return base.model_copy(update=parsed)
    except httpx.HTTPError as e:
        base.error = str(e)
        return base
