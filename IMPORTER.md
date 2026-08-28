# Hostiggo OTA Listing Importer

Hosts paste an existing Airbnb / Booking.com / Agoda / MakeMyTrip / Goibibo listing
URL, tick a consent box, and get a pre-filled Hostiggo draft — no re-typing 40
fields, no re-uploading photos.

## Quick start

```bash
npm install
npm run setup:tier2   # one-time: installs the Chromium binary for the Tier 2 scraper
npm run dev
# open http://localhost:3000/import-tester
```

`npm run setup:tier2` is optional — without it the pipeline still runs, it just
can't fall back to a headless render (needed for Airbnb/Booking price + amenities).

With **no environment variables set**, the playground runs fully offline:

- storage → in-process (`globalThis`) job store
- photos → mirrored to `public/import-mirror/<jobId>/`
- LLM → deterministic heuristic extractor (`src/lib/llm.ts` → `mockExtract`)
- 5 bundled OTA fixtures (`src/lib/fixtures.ts`) so nothing hits the live sites

Add credentials in `.env.local` (see `.env.example`) to switch each subsystem to
the real implementation independently.

## Architecture — asynchronous job / polling

No HTTP connection is held open during extraction.

```
POST /api/import/jobs        create job (validate URL + consent) → { job } 201, status=queued
POST /api/import/worker      claim oldest queued job (or {jobId} to re-run) → runs pipeline
GET  /api/import/jobs/:id    poll: status, stage, logs, draft, report, photos
POST /api/import/jobs/:id/commit   re-validate edited draft → insert listings + listing_photos
GET  /api/import/fixtures    list bundled sample pages
```

In production `POST /api/import/worker` is driven by a cron / queue consumer.
In the playground the "Start import" button calls it once for the new job and
then polls `GET /api/import/jobs/:id` every 1.5 s.

### Pipeline stages (`src/lib/pipeline.ts`)

| Stage | Module | What it does |
|---|---|---|
| `tier1_fetch` | `tier1.ts` | plain `fetch` w/ browser UA → parse JSON-LD, OpenGraph, meta, `__NEXT_DATA__`, `<img>` src/srcset, visible-text excerpt |
| `truncation_check` | `truncation.ts` | scores bot-walls, tiny docs, missing structured data / images / price → decides if Tier 2 is needed |
| `tier2_scrape` | `tier2.ts` | Playwright Chromium: `domcontentloaded` + scroll + wait for a price to render + open the amenities disclosure. Recovers price / full amenities / room counts that JS-heavy sites (Airbnb, Booking) never put in the initial HTML. Degrades to Tier 1 content if Playwright isn't installed |
| `llm_extract` | `llm.ts` | Anthropic `claude-sonnet-5` with `emit_listing_draft` tool = strict JSON Schema (`LISTING_DRAFT_JSON_SCHEMA`). Falls back to heuristic extractor without a key |
| `validate` | `schema.ts` | `validateDraft()` — coerce price/currency, clamp lat/lng & counts, map amenities to the Hostiggo enum, dedupe + de-track photo URLs, cap at `IMPORT_MAX_PHOTOS`. Emits a per-field report (`ok` / `coerced` / `clamped` / `dropped` / `missing`) |
| `fx_convert` | `fx.ts` | convert the nightly rate to INR (static rate table); records `source_currency` + `fx_rate` on the job. Unknown currency → price left null for the host |
| `coverage` | `fieldCoverage.ts` + `recommendations.ts` | score the draft against the 15-row Hostiggo onboarding flow (`auto` / `partial` / `manual` / `missing`, which are required to publish, `% pre-filled`); build the rule-based listing-improvement tips |
| `photo_mirror` | `photos.ts` | download each photo (type/size/count caps, bounded concurrency) → Supabase Storage bucket `listing-imports` (or local dir) |

`commit` re-runs `validateDraft` on whatever the host edited so nothing
unvalidated reaches the database, then writes `listings` + `listing_photos`.

### Multi-listing (host profile) import

| Endpoint | Purpose |
|---|---|
| `POST /api/import/profile` `{url}` | crawl a host-profile / search / wishlist URL (Tier 1 → Tier 2), return every discovered listing URL + id (+ title/thumbnail where present) |
| `POST /api/import/batch` `{urls[], consent, options}` | dedupe by external listing id, create one job per listing under an `import_batch` |
| `GET /api/import/batch/:id` | batch + per-listing status / tier / ₹ / photos / coverage % / tip count |
| `POST /api/import/worker` `{all:true, max}` | drain the queue (batch runner) |

### iCal availability feeds

| Endpoint | Purpose |
|---|---|
| `POST /api/import/jobs/:id/ical` `{url}` | fetch + parse an iCal export (`ical.ts`, no dependency), classify events reserved / blocked, flatten to `blocked_dates[]`, store on the job |
| `DELETE /api/import/jobs/:id/ical` | detach |

On commit these become `listing_ical_feeds` rows; a scheduled job re-pulls them.

## Database

- `0001_import_pipeline.sql` — `import_jobs`, `import_photos`, `listings`,
  `listing_photos`, the `listing-imports` storage bucket, RLS.
- `0002_batches_coverage_ical.sql` — `import_batches`, `listing_ical_feeds`,
  the `fx` / `coverage` / `recommendations` / `ical` / `batch_id` columns on
  `import_jobs`, and the provenance columns from the brainstorm doc
  (`listings.source`, `import_id`, `external_url`, `external_listing_id`,
  `import_confirmed_by_host`).

```bash
supabase db push
```

## Legal note

Scraping Airbnb/Booking/Agoda/MMT/Goibibo is against their ToS. This pipeline is
gated on explicit host consent, is intended only for a host importing **their own**
listing, strips tracking params, and rate-limits photo downloads. Prefer official
partner APIs where available.
