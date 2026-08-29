"""Apply sql/*.sql to DATABASE_URL via asyncpg (no psql needed).

Usage:  python migrate.py            # runs 001, 002, 003 in order
        python migrate.py sql/001_import_tables.sql   # a specific file
"""

from __future__ import annotations

import asyncio
import pathlib
import sys

import asyncpg

from app.config import settings

HERE = pathlib.Path(__file__).parent
DEFAULT = [
    "sql/001_import_tables.sql",
    "sql/002_taxonomy_seed.sql",
    "sql/003_taxonomy_link.sql",
    "sql/004_provenance.sql",
]


async def main(files: list[str]) -> None:
    if not settings.database_url:
        sys.exit("DATABASE_URL is empty — fill it in service/.env")
    conn = await asyncpg.connect(settings.database_url, statement_cache_size=0)
    try:
        for rel in files:
            path = HERE / rel
            sql = path.read_text(encoding="utf-8")
            print(f"==> {rel}")
            try:
                await conn.execute(sql)
            except asyncpg.PostgresError as e:
                print(f"    ! {type(e).__name__}: {e}")
                if "--strict" in sys.argv:
                    raise
        print("migrations applied.")
    finally:
        await conn.close()


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    asyncio.run(main(args or DEFAULT))
