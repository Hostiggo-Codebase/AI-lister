from __future__ import annotations

import asyncio
import mimetypes

import httpx

from app.config import settings
from app.models import ListingDraft

_OK_TYPES = ("image/jpeg", "image/jpg", "image/png", "image/webp", "image/avif")


async def _upload_supabase(key: str, data: bytes, content_type: str) -> tuple[str, str]:
    url = f"{settings.supabase_url}/storage/v1/object/{settings.supabase_photo_bucket}/{key}"
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.post(
            url,
            content=data,
            headers={
                "authorization": f"Bearer {settings.supabase_service_role_key}",
                "content-type": content_type,
                "x-upsert": "true",
            },
        )
        r.raise_for_status()
    public = (
        f"{settings.supabase_url}/storage/v1/object/public/"
        f"{settings.supabase_photo_bucket}/{key}"
    )
    return key, public


async def mirror_photos(import_id: int, draft: ListingDraft, log) -> list[dict]:
    """Download each photo and re-host it (never hot-link the OTA CDN)."""
    targets = draft.photos[: settings.import_max_photos]
    results: list[dict] = []
    sem = asyncio.Semaphore(4)

    async def one(idx: int, url: str, caption: str | None) -> dict:
        rec = {
            "idx": idx, "original_url": url, "storage_path": None, "public_url": None,
            "content_type": None, "bytes": None, "status": "pending", "error": None,
            "caption": caption,
        }
        async with sem:
            try:
                async with httpx.AsyncClient(timeout=settings.import_fetch_timeout_s) as c:
                    r = await c.get(url, headers={"user-agent": "HostiggoImporter/1.0"})
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
                if settings.has_storage:
                    path, public = await _upload_supabase(key, blob, ct)
                    rec.update(storage_path=path, public_url=public)
                else:
                    rec.update(storage_path=key, public_url=url)  # no bucket configured
                    log("warn", f"photo {idx}: storage not configured, kept original URL")
                rec.update(content_type=ct, bytes=len(blob), status="mirrored")
            except Exception as e:  # noqa: BLE001
                rec.update(status="failed", error=str(e))
                log("warn", f"photo {idx} failed: {e}")
        return rec

    results = await asyncio.gather(
        *(one(i, p.url, p.caption) for i, p in enumerate(targets))
    )
    results.sort(key=lambda x: x["idx"])
    ok = sum(r["status"] == "mirrored" for r in results)
    log("info", f"mirrored {ok}/{len(targets)} photos")
    return list(results)
