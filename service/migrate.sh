#!/usr/bin/env bash
# Apply the import-service SQL migrations. Needs DATABASE_URL (env or .env).
set -euo pipefail
cd "$(dirname "$0")"

if [ -z "${DATABASE_URL:-}" ] && [ -f .env ]; then
  set -a; source .env; set +a
fi
: "${DATABASE_URL:?set DATABASE_URL (or put it in service/.env)}"

for f in sql/001_import_tables.sql sql/002_taxonomy_seed.sql sql/003_taxonomy_link.sql; do
  echo "==> $f"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f"
done
echo "migrations applied."
