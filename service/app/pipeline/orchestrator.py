from __future__ import annotations

import asyncio
import logging
from datetime import UTC, datetime

from app import jobs
from app.models import JobStatus, Stage
from app.pipeline.coverage import compute_coverage
from app.pipeline.extract import extract_listing
from app.pipeline.fx import to_inr
from app.pipeline.photos import mirror_photos
from app.pipeline.recommendations import build_recommendations
from app.pipeline.tier1 import parse_html, tier1_fetch
from app.pipeline.tier2 import tier2_scrape
from app.pipeline.truncation import detect_truncation
from app.pipeline.validate import validate_draft

log = logging.getLogger("import.pipeline")


async def run_pipeline(record: dict) -> dict:
    import_id: int = record["import_id"]
    provider = record["provider"]
    opts = record.get("options") or {}
    force_tier2 = bool(opts.get("force_tier2"))
    skip_photos = bool(opts.get("skip_photo_mirror"))
    raw_html_override = opts.get("raw_html_override")
    logs: list[dict] = list(record.get("logs") or [])

    def logline(stage: str, level: str, msg: str) -> None:
        logs.append({
            "ts": datetime.now(UTC).isoformat(),
            "stage": stage, "level": level, "msg": msg,
        })

    async def checkpoint(stage: Stage, **patch) -> None:
        await jobs.update_import(import_id, stage=stage.value, logs=logs, **patch)

    try:
        # ---- Tier 1 ----------------------------------------------------
        logline("tier1_fetch", "info", "→ tier1_fetch")
        await checkpoint(Stage.tier1_fetch)
        if raw_html_override:
            page = parse_html(raw_html_override, record["source_url"], 200)
            logline("tier1_fetch", "info", "using supplied raw HTML (fetch skipped)")
        else:
            page = await tier1_fetch(record["source_url"])
            logline("tier1_fetch", "info",
                    f"fetched {page.bytes} bytes, HTTP {page.status}, {len(page.image_urls)} images")
        tier_used = 1

        # ---- Truncation ---------------------------------------------
        verdict = detect_truncation(page)
        logline("truncation_check", "warn" if verdict.truncated else "info",
                f"score {verdict.score} — {'; '.join(verdict.reasons) or 'looks complete'}")
        await checkpoint(Stage.truncation_check)

        # ---- Tier 2 ------------------------------------------------
        if verdict.truncated or force_tier2:
            logline("tier2_scrape", "info", "→ tier2_scrape")
            await checkpoint(Stage.tier2_scrape)
            t2 = await tier2_scrape(record["source_url"])
            if t2.ok and t2.page:
                page = t2.page
                tier_used = 2
                logline("tier2_scrape", "info",
                        f"headless render ok: {page.bytes} bytes, {len(page.image_urls)} images")
            else:
                logline("tier2_scrape", "warn", f"tier 2 unavailable, keeping tier 1: {t2.reason}")

        # ---- LLM extract -----------------------------------------
        logline("llm_extract", "info", "→ llm_extract")
        await checkpoint(Stage.llm_extract, tier_used=tier_used)
        extraction = await asyncio.wait_for(
            extract_listing(page, provider, opts.get("llm_model")), timeout=180
        )
        for w in extraction.warnings:
            logline("llm_extract", "warn", w)
        logline("llm_extract", "info", f"engine={extraction.engine} model={extraction.model}")
        await checkpoint(Stage.llm_extract, raw_payload=extraction.raw)

        # ---- Validate --------------------------------------------
        draft, notes = validate_draft(extraction.raw)
        changed = sum(1 for n in notes if n.status != "ok")
        logline("validate", "info",
                f"{len(notes)} fields checked, {changed} coerced/clamped/dropped/missing")
        await checkpoint(
            Stage.validate,
            normalized_payload=draft.model_dump(),
            source_photo_urls=[p.url for p in draft.photos],
        )

        # ---- FX -> INR ------------------------------------------
        fx = await to_inr(draft.pricing.nightly_amount, draft.pricing.currency)
        if fx.inr_amount is not None and fx.source_currency != "INR":
            draft.pricing.nightly_amount = fx.inr_amount
            draft.pricing.currency = "INR"
            logline("fx_convert", "info", fx.note or "")
        elif fx.rate_source == "unknown":
            logline("fx_convert", "warn", fx.note or "no FX rate")
        else:
            logline("fx_convert", "info", "price already INR / nothing to convert")
        await checkpoint(
            Stage.fx_convert,
            fx=fx.model_dump(),
            source_currency=fx.source_currency,
            fx_rate=fx.fx_rate,
            normalized_payload=draft.model_dump(),
        )

        # ---- Coverage + recommendations ------------------------
        cov = compute_coverage(draft, fx, bool(record["host_confirmed_ownership"]))
        recs = build_recommendations(draft)
        logline("coverage", "info",
                f"{cov.summary.percent_prefilled}% pre-filled · "
                f"{cov.summary.required_unresolved} required unresolved · {len(recs)} tips")
        await checkpoint(
            Stage.coverage,
            field_coverage=cov.model_dump(),
            recommendations=[r.model_dump() for r in recs],
        )

        # ---- Photo mirroring ---------------------------------
        if not skip_photos:
            logline("photo_mirror", "info", "→ photo_mirror")
            await checkpoint(Stage.photo_mirror)
            mirrored = await mirror_photos(
                import_id, draft, lambda lvl, m: logline("photo_mirror", lvl, m)
            )
            await jobs.update_import(import_id, mirrored_photos=mirrored, logs=logs)
        else:
            logline("photo_mirror", "info", "skipped by option")

        return await jobs.update_import(
            import_id, status=JobStatus.needs_review.value, stage=Stage.done.value, logs=logs
        )
    except Exception as e:
        detail = f"{type(e).__name__}: {e}"
        log.exception("pipeline failed for import %s", import_id)
        logline(record.get("stage") or "pipeline", "error", detail)
        # bulletproof: try the full update, then a minimal one, then give up loudly
        for patch in (
            {"status": JobStatus.failed.value, "error_message": detail, "logs": logs},
            {"status": JobStatus.failed.value, "error_message": detail[:2000]},
        ):
            try:
                return await jobs.update_import(import_id, **patch)
            except Exception:
                log.exception("could not persist failure for import %s", import_id)
        return record
