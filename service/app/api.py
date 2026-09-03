from __future__ import annotations

from fastapi import APIRouter, Depends, Header, HTTPException, Query

from app import jobs
from app.config import settings
from app.models import (
    AttachIcal,
    CommitImport,
    CreateBatch,
    CreateImport,
    FxConversion,
    ListingDraft,
    PatchImport,
    ScanProfile,
)
from app.pipeline.coverage import compute_coverage
from app.pipeline.ical import fetch_ical
from app.pipeline.orchestrator import run_pipeline
from app.pipeline.profile import scan_profile
from app.pipeline.publish import publish_draft
from app.pipeline.recommendations import build_recommendations
from app.pipeline.validate import committable_issues, validate_draft
from app.providers import UrlError, validate_import_url


def _deep_merge(base: dict, patch: dict) -> dict:
    """Recursively merge `patch` into `base`. Lists and scalars are replaced."""
    out = dict(base)
    for k, v in patch.items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = _deep_merge(out[k], v)
        else:
            out[k] = v
    return out

router = APIRouter(prefix="/v1")


async def require_key(authorization: str | None = Header(default=None)) -> None:
    if not settings.api_key:
        return
    if authorization != f"Bearer {settings.api_key}":
        raise HTTPException(401, "invalid or missing bearer token")


Guard = Depends(require_key)


def _record(row: dict) -> dict:
    """Shape a listing_imports row for the API (leave heavy blobs as-is)."""
    return row


# --------------------------------------------------------------------------- #
# single import
# --------------------------------------------------------------------------- #
@router.post("/imports", status_code=201, dependencies=[Guard])
async def create_import(body: CreateImport, force: bool = Query(False)):
    if not body.host_confirmed_ownership:
        raise HTTPException(400, "host_confirmed_ownership is required")
    try:
        url, provider, ext = validate_import_url(body.url)
    except UrlError as e:
        raise HTTPException(400, str(e)) from e

    if force and ext:
        prior = await jobs.get_import_by_external(provider, ext)
        if prior and not prior.get("listing_id"):
            await jobs.delete_import(prior["import_id"])

    payload = {
        "host_uuid": body.host_uuid,
        "source": "airbnb_import" if provider == "airbnb" else f"{provider}_import",
        "source_url": url,
        "external_listing_id": ext,
        "provider": provider,
        "status": "pending",
        "stage": "queued",
        "host_confirmed_ownership": True,
        "options": {
            "force_tier2": body.force_tier2,
            "skip_photo_mirror": body.skip_photo_mirror,
        },
        "logs": [],
    }
    try:
        row = await jobs.create_import(payload)
    except jobs.DuplicateImport as dup:
        # Already imported — hand back the existing record instead of erroring.
        return {"import": _record(dup.existing), "duplicate": True}
    return {"import": _record(row)}


@router.get("/imports", dependencies=[Guard])
async def list_imports(limit: int = Query(30, le=100)):
    return {"imports": await jobs.list_imports(limit)}


@router.get("/imports/{import_id}", dependencies=[Guard])
async def get_import(import_id: int):
    row = await jobs.get_import(import_id)
    if not row:
        raise HTTPException(404, "not found")
    return {"import": _record(row)}


@router.patch("/imports/{import_id}", dependencies=[Guard])
async def patch_import(import_id: int, body: PatchImport):
    """Save host edits to the draft before commit (per review-screen section).

    Body: {"normalized_payload": { ...full or partial ListingDraft... }}
    Partial objects are deep-merged into the current draft; the result is
    re-validated and field_coverage / recommendations are recomputed.
    """
    row = await jobs.get_import(import_id)
    if not row:
        raise HTTPException(404, "not found")
    if row.get("listing_id"):
        raise HTTPException(409, "already committed — edit the published listing instead")

    current = row.get("normalized_payload") or {}
    merged = _deep_merge(current, body.normalized_payload or {})
    draft, _notes = validate_draft(merged)

    fx_raw = row.get("fx")
    fx = FxConversion(**fx_raw) if fx_raw else None
    cov = compute_coverage(draft, fx, bool(row.get("host_confirmed_ownership")))
    recs = build_recommendations(draft)

    updated = await jobs.update_import(
        import_id,
        normalized_payload=draft.model_dump(),
        field_coverage=cov.model_dump(),
        recommendations=[r.model_dump() for r in recs],
        status="needs_review",
    )
    return {"import": _record(updated)}


@router.post("/imports/{import_id}/rerun", dependencies=[Guard])
async def rerun_import(import_id: int):
    row = await jobs.get_import(import_id)
    if not row:
        raise HTTPException(404, "not found")
    row = await jobs.reset_import(import_id)
    done = await run_pipeline(row)
    return {"import": _record(done)}


@router.post("/imports/{import_id}/ical", dependencies=[Guard])
async def attach_ical(import_id: int, body: AttachIcal):
    row = await jobs.get_import(import_id)
    if not row:
        raise HTTPException(404, "not found")
    feed = await fetch_ical(body.url)
    await jobs.update_import(import_id, ical=feed.model_dump())
    return {"ical": feed.model_dump()}


@router.delete("/imports/{import_id}/ical", dependencies=[Guard])
async def detach_ical(import_id: int):
    await jobs.update_import(import_id, ical=None)
    return {"ok": True}


@router.post("/imports/{import_id}/commit", dependencies=[Guard])
async def commit_import(import_id: int, body: CommitImport):
    row = await jobs.get_import(import_id)
    if not row:
        raise HTTPException(404, "not found")
    if row.get("listing_id"):
        return {"listing_id": row["listing_id"], "already_committed": True}

    # Group 15: the host must explicitly consent at publish — never imported.
    if not body.confirm:
        raise HTTPException(
            422,
            {"error": "host consent required", "issues": ["eligibility.host_confirmed_at"]},
        )

    if body.draft is not None:
        draft, _ = validate_draft(body.draft.model_dump())
    elif row.get("normalized_payload"):
        draft = ListingDraft.model_validate(row["normalized_payload"])
    else:
        raise HTTPException(400, "no draft to commit — run the pipeline first")

    issues = committable_issues(draft)
    if issues:
        raise HTTPException(422, {"error": "draft incomplete", "issues": issues})

    from datetime import UTC, datetime

    row["host_confirmed_ownership"] = True
    row["host_confirmed_at"] = datetime.now(UTC).isoformat()
    await jobs.update_import(
        import_id,
        normalized_payload=draft.model_dump(),
        host_confirmed_ownership=True,
    )
    return await publish_draft(row, draft)


# --------------------------------------------------------------------------- #
# multi-listing
# --------------------------------------------------------------------------- #
@router.post("/profile/scan", dependencies=[Guard])
async def profile_scan(body: ScanProfile):
    try:
        validate_import_url(body.url)  # provider check only
    except UrlError as e:
        raise HTTPException(400, str(e)) from e
    scan = await scan_profile(body.url)
    return {
        "scan": {
            "provider": scan.provider,
            "is_profile_url": scan.is_profile_url,
            "host_name": scan.host_name,
            "tier_used": scan.tier_used,
            "note": scan.note,
            "listings": [vars(x) for x in scan.listings],
        }
    }


@router.post("/batches", status_code=201, dependencies=[Guard])
async def create_batch(body: CreateBatch):
    if not body.host_confirmed_ownership:
        raise HTTPException(400, "host_confirmed_ownership is required")
    seen: set[str] = set()
    cleaned: list[tuple[str, str, str | None]] = []
    for raw in body.urls:
        try:
            url, provider, ext = validate_import_url(raw)
        except UrlError:
            continue
        key = ext or url
        if key in seen:
            continue
        seen.add(key)
        cleaned.append((url, provider, ext))
    if not cleaned:
        raise HTTPException(400, "no valid supported URLs in the list")

    batch = await jobs.create_batch(
        body.source_url or cleaned[0][0], cleaned[0][1], body.host_name, body.host_uuid
    )
    ids: list[int] = []
    for url, provider, ext in cleaned:
        row = await jobs.create_import({
            "batch_id": batch["batch_id"],
            "host_uuid": body.host_uuid,
            "source": "airbnb_import" if provider == "airbnb" else f"{provider}_import",
            "source_url": url,
            "external_listing_id": ext,
            "provider": provider,
            "status": "pending",
            "stage": "queued",
            "host_confirmed_ownership": True,
            "options": {
                "force_tier2": body.force_tier2,
                "skip_photo_mirror": body.skip_photo_mirror,
            },
            "logs": [],
        })
        ids.append(row["import_id"])
    return {"batch": batch, "import_ids": ids}


@router.get("/batches/{batch_id}", dependencies=[Guard])
async def get_batch(batch_id: int):
    batch = await jobs.get_batch(batch_id)
    if not batch:
        raise HTTPException(404, "not found")
    rows = await jobs.list_imports(batch_id=batch_id)
    return {
        "batch": batch,
        "imports": [
            {
                "import_id": r["import_id"],
                "source_url": r["source_url"],
                "external_listing_id": r.get("external_listing_id"),
                "status": r["status"],
                "stage": r["stage"],
                "tier_used": r.get("tier_used"),
                "title": (r.get("normalized_payload") or {}).get("title"),
                "nightly_inr": ((r.get("normalized_payload") or {}).get("pricing") or {}).get(
                    "nightly_amount"
                ),
                "photos": sum(
                    1 for p in (r.get("mirrored_photos") or []) if p.get("status") == "mirrored"
                ),
                "coverage_pct": ((r.get("field_coverage") or {}).get("summary") or {}).get(
                    "percent_prefilled"
                ),
                "required_unresolved": ((r.get("field_coverage") or {}).get("summary") or {}).get(
                    "required_unresolved"
                ),
                "recommendations": len(r.get("recommendations") or []),
                "listing_id": r.get("listing_id"),
                "error": r.get("error_message"),
            }
            for r in rows
        ],
    }


# --------------------------------------------------------------------------- #
# manual worker tick (for envs without the background worker, and for tests)
# --------------------------------------------------------------------------- #
@router.post("/worker/tick", dependencies=[Guard])
async def worker_tick(all: bool = Query(False), max: int = Query(20, le=40)):
    processed: list[int] = []
    limit = max if all else 1
    for _ in range(limit):
        rec = await jobs.claim_next_pending()
        if not rec:
            break
        done = await run_pipeline(rec)
        processed.append(done["import_id"])
    return {"processed": processed}
