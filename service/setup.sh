#!/usr/bin/env bash
# One-shot setup: venv + deps + (optional) Chromium + DB migrations.
# Run from the service/ directory:  bash setup.sh
set -euo pipefail

cd "$(dirname "$0")"

echo "==> Python venv"
python3 -m venv .venv
# shellcheck disable=SC1091
source .venv/bin/activate
pip install --upgrade pip >/dev/null

echo "==> dependencies"
pip install \
  fastapi "uvicorn[standard]" pydantic pydantic-settings httpx selectolax \
  asyncpg anthropic tenacity python-dateutil \
  pytest pytest-asyncio ruff

if [ "${SKIP_PLAYWRIGHT:-0}" != "1" ]; then
  echo "==> Playwright Chromium (Tier 2). Set SKIP_PLAYWRIGHT=1 to skip."
  pip install playwright
  python -m playwright install --with-deps chromium || \
    echo "   (chromium install failed — Tier 2 will degrade to Tier 1; not fatal)"
fi

if [ ! -f .env ]; then
  if [ -f .env.example ]; then
    cp .env.example .env
  else
    cat > .env <<'EOF'
DATABASE_URL=
DB_SCHEMA=hostiggo_testing_schema
IMPORT_SCHEMA=hostiggo_testing_schema
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_PHOTO_BUCKET=homestay-photos
ANTHROPIC_API_KEY=
IMPORT_LLM_MODEL=claude-sonnet-5
IMPORT_MAX_PHOTOS=40
IMPORT_TIER2_ENABLED=true
IMPORT_WORKER_CONCURRENCY=2
API_KEY=
LOG_LEVEL=INFO
EOF
  fi
  echo "==> created service/.env — FILL IN DATABASE_URL, SUPABASE_*, ANTHROPIC_API_KEY, then re-run: bash setup.sh"
  exit 0
fi

# shellcheck disable=SC1091
set -a; source .env; set +a

if [ -z "${DATABASE_URL:-}" ]; then
  echo "==> DATABASE_URL is empty in .env — fill it in, then run:  bash migrate.sh"
  exit 0
fi

echo "==> applying SQL migrations"
bash migrate.sh

echo
echo "Done. Start the service with:"
echo "  source .venv/bin/activate && uvicorn app.main:app --host 0.0.0.0 --port 8000"
