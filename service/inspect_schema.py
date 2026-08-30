"""Dump the real hostiggo_testing_schema so schema_map.py can be reconciled.

    python inspect_schema.py
"""

import asyncio

import asyncpg

from app.config import settings

TABLES = [
    "listings", "listing_media", "listing_bedrooms", "listing_amenities",
    "listing_discounts", "listing_house_rules", "listing_safety",
    "property_types", "stay_types", "amenities",
]


async def main() -> None:
    c = await asyncpg.connect(settings.database_url, statement_cache_size=0)
    try:
        for t in TABLES:
            rows = await c.fetch(
                "select column_name, data_type, is_nullable, column_default "
                "from information_schema.columns "
                "where table_schema = $1 and table_name = $2 "
                "order by ordinal_position",
                settings.db_schema, t,
            )
            if not rows:
                print(f"\n### {t}: MISSING")
                continue
            print(f"\n### {t}")
            for r in rows:
                d = f"  default={r['column_default']}" if r["column_default"] else ""
                null = "NULL" if r["is_nullable"] == "YES" else "NOT NULL"
                print(f"  {r['column_name']:28} {r['data_type']:18} {null}{d}")

        for t in ("property_types", "stay_types", "amenities"):
            try:
                s = await c.fetch(f'select * from "{settings.db_schema}"."{t}" limit 5')
                print(f"\n--- {t} sample ---")
                for row in s:
                    print("  ", dict(row))
            except (asyncpg.PostgresError, Exception) as e:  # noqa: BLE001
                print(f"\n--- {t} sample error: {e}")
    finally:
        await c.close()


if __name__ == "__main__":
    asyncio.run(main())
