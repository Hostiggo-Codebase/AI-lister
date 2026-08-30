# Deploying the import service

It's a stateless FastAPI app + in-process async workers. It needs:

- **Postgres** — your Supabase DB (already set up; the pooler URL works from anywhere)
- **Chromium** — for the Tier 2 scraper (the Docker image bundles it)
- **Outbound HTTPS** — to the OTA sites, `api.anthropic.com`, and Supabase Storage
- ~**1 GB RAM** minimum (Chromium is the heavy part; 2 GB comfortable)

The queue is a `SELECT … FOR UPDATE SKIP LOCKED` on `listing_imports`, so you can
run **multiple instances** safely — they won't double-process a job.

## Environment variables (set in the host's dashboard, never commit)

```
DATABASE_URL=postgresql://postgres.<ref>:<pw>@<region>.pooler.supabase.com:6543/postgres
DB_SCHEMA=hostiggo_testing_schema
IMPORT_SCHEMA=hostiggo_testing_schema
SUPABASE_URL=https://<ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service_role key>
SUPABASE_PHOTO_BUCKET=homestay-photos
ANTHROPIC_API_KEY=<key>
IMPORT_LLM_MODEL=claude-sonnet-5
API_KEY=<a long random string>          # REQUIRED in prod — protects every /v1 route
IMPORT_WORKER_CONCURRENCY=2
LOG_LEVEL=INFO
```

## One-time: apply migrations to the DB

Already done against your current Supabase project. For a fresh DB:

```bash
DATABASE_URL=... python migrate.py     # runs sql/001..004
```

## Option A — Render (simplest)

1. New → **Web Service** → connect the `AI-lister` repo.
2. **Root Directory:** `service` · **Runtime:** Docker (it finds the `Dockerfile`).
3. Instance type: **Standard** (2 GB) — Chromium won't fit the free 512 MB tier.
4. Add the env vars above. Deploy.
5. Health check path: `/healthz`.

## Option B — Railway

1. New Project → Deploy from GitHub repo → pick `AI-lister`.
2. Settings → **Root Directory** = `service`. It builds the Dockerfile.
3. Variables → paste the env vars. Railway injects `PORT` automatically.
4. Generate a domain. Check `https://<domain>/healthz`.

## Option C — Fly.io

```bash
cd service
fly launch --no-deploy            # creates fly.toml; set internal_port = 8000
fly secrets set DATABASE_URL=... SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... ANTHROPIC_API_KEY=... API_KEY=...
fly deploy
```
Give the VM 2 GB: `fly scale memory 2048`.

## Option D — Any VM (DigitalOcean / Hetzner / EC2)

```bash
git clone <repo> && cd AI-lister/service
cp .env.example .env && $EDITOR .env      # fill it in
docker compose up -d --build
curl localhost:8000/healthz
```
Put nginx / Caddy in front for TLS. To split API and worker load:
`IMPORT_WORKER_CONCURRENCY=0` on `api`, then `docker compose --profile worker up -d`.

## Google Cloud Run

Works, but: set **min instances = 1** (otherwise the in-process workers stop when
it scales to zero and queued imports stall), **memory = 2 GiB**, **CPU always
allocated**, request timeout **300s**. Or deploy the worker separately as a Cloud
Run *job* / a small GCE VM and keep Cloud Run for the API only.

## After deploy

```bash
curl -s https://<your-domain>/healthz
# {"ok":true,"db":true,"llm":"anthropic","storage":true,"tier2":true}
```

Every `/v1` call now needs `-H "Authorization: Bearer $API_KEY"`.

The API also runs the workers, so nothing else to start. For higher throughput,
scale to 2–3 instances or run dedicated worker containers.
