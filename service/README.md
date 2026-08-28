# Hostiggo OTA Listing Import Service

A standalone Python microservice that turns an existing OTA listing (Airbnb,
Booking.com, Agoda, MakeMyTrip, Goibibo) — or a whole host profile — into a
pre-filled Hostiggo draft, following the *"Import a Listing from an Airbnb link"*
brainstorm.

FastAPI + asyncpg + Playwright. No Redis / Celery — the queue is a
`SELECT … FOR UPDATE SKIP LOCKED` on `listing_imports` and the workers run
in-process (or as a separate `python -m app.worker`).

## Features

| | |
|---|---|
| **Tiered extraction** | Tier 1 `httpx` fetch → truncation detector → Tier 2 Playwright headless fallback (JS-rendered price / amenities / full description) |
| **LLM mapping** | Anthropic `claude-sonnet-5` with a strict JSON-Schema tool; deterministic heuristic fallback when no key |
| **Normalisation** | property/stay/amenity → Hostiggo taxonomies via `external_taxonomy_map`, price → INR, per-field validation report |
| **Field coverage** | every listing scored against the 15-row onboarding flow — `auto / partial / manual / missing`, required-to-publish, `% pre-filled` |
| **Recommendations** | rule-based listing-quality tips returned on every import |
| **Multi-listing** | `POST /v1/profile/scan` discovers every listing on a host profile / search page; `POST /v1/batches` fans out one import per listing |
| **iCal** | `POST /v1/imports/{id}/ical` fetches + parses the availability feed, classifies reserved/blocked, flattens to `blocked_dates[]`; persisted to `listing_ical_feeds` on publish |
| **Photo mirroring** | every photo downloaded and re-hosted to Supabase Storage (never hot-linked) |
| **Provenance** | writes `source`, `import_id`, `external_url`, `external_listing_id`, `import_confirmed_by_host` on `listings` / `listing_media` |

## Setup

```bash
cd service
python -m venv .venv && source .venv/bin/activate    # Windows: .venv\Scripts\activate
pip install -e ".[dev]"
playwright install chromium                            # optional (Tier 2)
cp .env.example .env                                   # fill DATABASE_URL etc.
```

Apply the SQL to your Supabase project (schema `hostiggo_testing_schema`):

```bash
psql "$DATABASE_URL" -f sql/001_import_tables.sql
psql "$DATABASE_URL" -f sql/002_taxonomy_seed.sql
psql "$DATABASE_URL" -f sql/003_taxonomy_link.sql     # links seed -> your catalog ids
```

Run:

```bash
uvicorn app.main:app --reload --port 8000
# docs at http://localhost:8000/docs
```

## Reconciling with your real schema

`app/schema_map.py` is the **only** place the existing Hostiggo tables are
referenced. The column names there are best-effort from the brainstorm doc —
edit them to match `hostiggo_testing_schema` and nothing else changes. A column
mapped to `None` is skipped on publish and reported in the response's
`skipped[]`, so a mismatch degrades instead of crashing.

## API

| Method & path | Purpose |
|---|---|
| `POST /v1/imports` | `{url, host_confirmed_ownership, force_tier2?, skip_photo_mirror?}` → queued import |
| `GET  /v1/imports/{id}` | poll status / stage / logs / draft / coverage / recommendations |
| `POST /v1/imports/{id}/rerun` | re-run the pipeline |
| `POST /v1/imports/{id}/ical` | `{url}` → fetch + parse the iCal feed |
| `POST /v1/imports/{id}/commit` | `{draft?}` → validate → `publish_draft` → `{listing_id, skipped}` |
| `POST /v1/profile/scan` | `{url}` → discover all listings on a host profile / search page |
| `POST /v1/batches` | `{urls[], host_confirmed_ownership}` → one import per listing under a batch |
| `GET  /v1/batches/{id}` | batch + per-import summary |
| `POST /v1/worker/tick?all=true` | drain the queue manually (envs without the bg worker) |
| `GET  /healthz` | db / llm / storage / tier2 status |

Set `API_KEY` to require `Authorization: Bearer <key>` on every `/v1` route.

## Tests

```bash
pytest                # pipeline unit tests (no DB / network needed)
```
