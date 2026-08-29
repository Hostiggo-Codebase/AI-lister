from __future__ import annotations

import asyncio
import logging
import mimetypes
import re
from urllib.parse import urlparse

import httpx

from app.config import settings
from app.models import ListingDraft

log = logging.getLogger("import.photos")
_OK_TYPES = ("image/jpeg", "image/jpg", "image/png", "image/webp", "image/avif")

_SB = (settings.supabase_url or "").strip().rstrip("/")
_BUCKET = settings.supabase_photo_bucket
_bucket_checked = False

_DL_HEADERS = {
    "user-agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    ),
    "accept": "image/avif,image/webp,image/png,image/jpeg,*/*;q=0.8",
    "referer": "https://www.airbnb.com/",
}


def _storage_ok() -> bool:
    if not (settings.has_storage and _SB):
        return False
    p = urlparse(_SB)
    return p.scheme in ("http", "https") and bool(p.netloc)


_URL_RE = re.compile(r"https?://[^\s'\"<>\[\]\\]+", re.IGNORECASE)
_PROTO_LESS_RE = re.compile(r"//[a-z0-9.-]+\.[a-z]{2,}/[^\s'\"<>\[\]\\]*", re.IGNORECASE)


def sanitize_photo_url(raw: object) -> str:
    """Pull a clean absolute https URL out of whatever the scraper/LLM produced
    — a bare string, a {"url": ...} dict, an escaped or bracket-wrapped string."""
    if isinstance(raw, dict):
        raw = raw.get("url") or raw.get("src") or raw.get("baseUrl") or ""
    if isinstance(raw, (list, tuple)) and raw:
        raw = raw[0]
    s = str(raw).strip().strip("[]\"' \t\n\r").replace("\\/", "/").replace("\\u002F", "/")
    if s.startswith("data:"):
        raise ValueError("base64 image data — skipped")

    m = _URL_RE.search(s)
    if m:
        u = m.group(0)
    else:
        m = _PROTO_LESS_RE.search(s)
        if m:
            u = "https:" + m.group(0)
        elif re.match(r"^[a-z0-9.-]+\.[a-z]{2,}/", s, re.IGNORECASE):
            u = "https://" + s
        else:
            raise ValueError(f"no URL found in {s[:120]!r}")

    parsed = urlparse(u)
    if (
        parsed.scheme not in ("http", "https")
        or not parsed.netloc
        or "." not in parsed.netloc
        or any(ch in parsed.netloc for ch in " {}\"'")
    ):
        raise ValueError(f"invalid host {parsed.netloc!r} from {s[:120]!r}")
    if parsed.scheme == "http":
        u = "https://" + u[len("http://") :]
    return u


async def _ensure_bucket(c: httpx.AsyncClient) -> None:
    global _bucket_checked
    if _bucket_checked:
        return
    _bucket_checked = True
    hdr = {"authorization": f"Bearer {settings.supabase_service_role_key}"}
    try:
        r = await c.get(f"{_SB}/storage/v1/bucket/{_BUCKET}", headers=hdr)
        if r.status_code == 200:
            return
        r = await c.post(
            f"{_SB}/storage/v1/bucket",
            headers={**hdr, "content-type": "application/json"},
            json={"id": _BUCKET, "name": _BUCKET, "public": True},
        )
        if r.status_code not in (200, 201, 409):
            log.warning("ensure bucket %s -> HTTP %s %s", _BUCKET, r.status_code, r.text[:200])
        else:
            log.info("storage bucket ready: %s", _BUCKET)
    except httpx.HTTPError as e:
        log.warning("ensure bucket %s failed: %s", _BUCKET, e)


async def _upload_supabase(key: str, data: bytes, content_type: str) -> tuple[str, str]:
    url = f"{_SB}/storage/v1/object/{_BUCKET}/{key}"
    log.info("uploading -> %s (%d bytes)", url, len(data))
    async with httpx.AsyncClient(timeout=30) as c:
        await _ensure_bucket(c)
        r = await c.post(
            url,
            content=data,
            headers={
                "authorization": f"Bearer {settings.supabase_service_role_key}",
                "content-type": content_type,
                "x-upsert": "true",
            },
        )
        if r.status_code >= 400:
            raise RuntimeError(f"storage upload HTTP {r.status_code}: {r.text[:200]}")
    return key, f"{_SB}/storage/v1/object/public/{_BUCKET}/{key}"


async def mirror_photos(import_id: int, draft: ListingDraft, logline) -> list[dict]:
    """Download each photo and re-host it (never hot-link the OTA CDN)."""
    targets = draft.photos[: settings.import_max_photos]
    use_storage = _storage_ok()
    if settings.has_storage and not use_storage:
        logline("warn", f"SUPABASE_URL invalid ({_SB!r}) — keeping original photo URLs")
    sem = asyncio.Semaphore(4)

    async def one(idx: int, raw_url: str, caption: str | None) -> dict:
        rec = {
            "idx": idx, "original_url": raw_url, "storage_path": None, "public_url": None,
            "content_type": None, "bytes": None, "status": "pending", "error": None,
            "caption": caption,
        }
        async with sem:
            try:
                url = sanitize_photo_url(raw_url)
                rec["original_url"] = url
                host = urlparse(url).netloc
                log.info("photo %d: raw=%r -> clean=%r (host=%r)", idx, raw_url, url, host)
                async with httpx.AsyncClient(
                    timeout=settings.import_fetch_timeout_s, follow_redirects=True
                ) as c:
                    try:
                        r = await c.get(url, headers=_DL_HEADERS)
                    except httpx.ConnectError as e:
                        raise RuntimeError(f"cannot connect to {host}: {e}") from e
                    r.raise_for_status()
                ct = (r.headers.get("content-type") or "").split(";")[0].strip().lower()
                if ct not in _OK_TYPES:
                    raise ValueError(f"unsupported type {ct or '?'}")
                blob = r.content
                if len(blob) > settings.import_photo_max_bytes:
                    raise ValueError(f"too large ({len(blob)} bytes)")
                if len(blob) < 1024:
                    raise ValueError("suspiciously small")
                ext = mimetypes.guess_extension(ct) or ".jpg"
                key = f"imports/{import_id}/{idx}{ext}"
                if use_storage:
                    path, public = await _upload_supabase(key, blob, ct)
                    rec.update(storage_path=path, public_url=public)
                else:
                    rec.update(storage_path=None, public_url=url)
                rec.update(content_type=ct, bytes=len(blob), status="mirrored")
            except Exception as e:  # noqa: BLE001
                rec.update(status="failed", error=f"{type(e).__name__}: {e}")
                logline("warn", f"photo {idx} failed: {rec['error']}")
        return rec

    results = list(await asyncio.gather(*(one(i, p.url, p.caption) for i, p in enumerate(targets))))
    results.sort(key=lambda x: x["idx"])
    ok = sum(r["status"] == "mirrored" for r in results)
    logline("info", f"mirrored {ok}/{len(targets)} photos" + ("" if use_storage else " (storage off — kept original URLs)"))
    return results
