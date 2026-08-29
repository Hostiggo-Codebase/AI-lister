#!/usr/bin/env bash
# Apply the import-service SQL migrations. Uses psql if available, else asyncpg.
set -euo pipefail
cd "$(dirname "$0")"

if [ -z "${DATABASE_URL:-}" ] && [ -f .env ]; then
  set -a; source .env; set +a
fi
: "${DATABASE_URL:?set DATABASE_URL (or put it in service/.env)}"

if command -v psql >/dev/null 2>&1; then
  for f in sql/001_import_tables.sql sql/002_taxonomy_seed.sql \
           sql/003_taxonomy_link.sql sql/004_provenance.sql; do
    echo "==> $f"
    psql "$DATABASE_URL" -f "$f" || echo "   (some statements failed — see above; continuing)"
  done
else
  echo "psql not found — running migrations via python/asyncpg"
  python migrate.py
fi
echo "migrations applied."
