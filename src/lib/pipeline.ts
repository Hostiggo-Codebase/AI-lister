import { getStore } from "./store";
import { tier1Fetch, parseHtml, type ParsedPage } from "./tier1";
import { detectTruncation } from "./truncation";
import { tier2Scrape } from "./tier2";
import { extractListing } from "./llm";
import { validateDraft } from "./schema";
import { mirrorPhotos } from "./photos";
import type { ImportJob, LogEntry, Stage } from "./types";

async function runStage<T>(
  job: ImportJob,
  stage: Stage,
  logs: LogEntry[],
  fn: (log: (lvl: LogEntry["level"], msg: string) => void) => Promise<T>,
): Promise<T> {
  const store = getStore();
  const log = (level: LogEntry["level"], msg: string) => {
    logs.push({ ts: new Date().toISOString(), stage, level, msg });
  };
  log("info", `→ ${stage}`);
  await store.updateJob(job.id, { stage, logs: [...logs] });
  const res = await fn(log);
  await store.updateJob(job.id, { logs: [...logs] });
  return res;
}

/** Execute the full tiered extraction pipeline for one claimed job. */
export async function runPipeline(job: ImportJob): Promise<ImportJob> {
  const store = getStore();
  const logs: LogEntry[] = [...job.logs];
  const opts = job.options ?? {};

  try {
    // ---- Tier 1 -------------------------------------------------------
    let page: ParsedPage = await runStage(job, "tier1_fetch", logs, async (log) => {
      if (opts.rawHtmlOverride) {
        log("info", "using supplied raw HTML (fetch skipped)");
        return parseHtml(opts.rawHtmlOverride, job.source_url, 200);
      }
      const p = await tier1Fetch(job.source_url);
      log("info", `fetched ${p.bytes} bytes, HTTP ${p.status}, ${p.imageUrls.length} images`);
      return p;
    });
    let tierUsed: 1 | 2 = 1;

    // ---- Truncation check -------------------------------------------
    const verdict = await runStage(job, "truncation_check", logs, async (log) => {
      const v = detectTruncation(page);
      log(v.truncated ? "warn" : "info", `score ${v.score} — ${v.reasons.join("; ") || "looks complete"}`);
      return v;
    });
    await store.updateJob(job.id, {
      raw_html_bytes: page.bytes,
      truncated: verdict.truncated,
      truncation_reasons: verdict.reasons,
    });

    // ---- Tier 2 fallback ------------------------------------------
    if (verdict.truncated || opts.forceTier2) {
      page = await runStage(job, "tier2_scrape", logs, async (log) => {
        const r = await tier2Scrape(job.source_url);
        if (r.ok) {
          tierUsed = 2;
          log("info", `headless render ok: ${r.page.bytes} bytes, ${r.page.imageUrls.length} images`);
          return r.page;
        }
        log("warn", `tier 2 unavailable, keeping tier 1 content: ${r.reason}`);
        return page;
      });
    }
    await store.updateJob(job.id, { tier_used: tierUsed });

    // ---- LLM extraction -------------------------------------------
    const extraction = await runStage(job, "llm_extract", logs, async (log) => {
      const e = await extractListing(page, job.provider, opts.llmModel);
      e.warnings.forEach((w) => log("warn", w));
      log("info", `engine=${e.engine} model=${e.model}`);
      return e;
    });
    await store.updateJob(job.id, {
      raw_extraction: extraction.raw,
      llm_model: extraction.model,
    });

    // ---- Server validation ---------------------------------------
    const { draft, report } = await runStage(job, "validate", logs, async (log) => {
      const v = validateDraft(extraction.raw);
      const changed = v.report.filter((r) => r.status !== "ok").length;
      log("info", `${v.report.length} fields checked, ${changed} coerced/clamped/dropped/missing`);
      return v;
    });
    await store.updateJob(job.id, {
      validated_draft: draft,
      validation_report: report,
    });

    // ---- Photo mirroring ----------------------------------------
    if (!opts.skipPhotoMirror) {
      const photos = await runStage(job, "photo_mirror", logs, (log) =>
        mirrorPhotos(job.id, draft, log),
      );
      await store.updateJob(job.id, { photos });
    } else {
      logs.push({
        ts: new Date().toISOString(),
        stage: "photo_mirror",
        level: "info",
        msg: "skipped by option",
      });
    }

    return store.updateJob(job.id, {
      status: "succeeded",
      stage: "done",
      logs: [...logs],
    });
  } catch (e) {
    const msg = (e as Error).message || String(e);
    logs.push({ ts: new Date().toISOString(), stage: job.stage, level: "error", msg });
    return store.updateJob(job.id, { status: "failed", error: msg, logs: [...logs] });
  }
}
