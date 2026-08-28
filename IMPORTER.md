# Hostiggo OTA Listing Importer

Hosts paste an existing Airbnb / Booking.com / Agoda / MakeMyTrip / Goibibo listing
URL, tick a consent box, and get a pre-filled Hostiggo draft — no re-typing 40
fields, no re-uploading photos.

## Quick start

```bash
npm install
npm run dev
# open http://localhost:3000/import-tester
```

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
| `tier2_scrape` | `tier2.ts` | Playwright Chromium, `networkidle` + scroll for lazy images. **Optional dep** — degrades to Tier 1 content if not installed |
| `llm_extract` | `llm.ts` | Anthropic `claude-sonnet-5` with `emit_listing_draft` tool = strict JSON Schema (`LISTING_DRAFT_JSON_SCHEMA`). Falls back to heuristic extractor without a key |
| `validate` | `schema.ts` | `validateDraft()` — coerce price/currency, clamp lat/lng & counts, map amenities to the Hostiggo enum, dedupe + de-track photo URLs, cap at `IMPORT_MAX_PHOTOS`. Emits a per-field report (`ok` / `coerced` / `clamped` / `dropped` / `missing`) |
| `photo_mirror` | `photos.ts` | download each photo (type/size/count caps, bounded concurrency) → Supabase Storage bucket `listing-imports` (or local dir) |

`commit` re-runs `validateDraft` on whatever the host edited so nothing
unvalidated reaches the database, then writes `listings` + `listing_photos`.

## Database

`supabase/migrations/0001_import_pipeline.sql` — `import_jobs`, `import_photos`,
`listings`, `listing_photos`, the `listing-imports` storage bucket, and RLS
(service-role for the API routes; hosts see only their own rows).

```bash
supabase db push
```

## Legal note

Scraping Airbnb/Booking/Agoda/MMT/Goibibo is against their ToS. This pipeline is
gated on explicit host consent, is intended only for a host importing **their own**
listing, strips tracking params, and rate-limits photo downloads. Prefer official
partner APIs where available.
