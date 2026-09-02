"""Dump the full hostiggo schema as CREATE TABLE statements.

    source .venv/bin/activate
    python dump_schema.py                 # -> stdout
    python dump_schema.py > schema.sql    # -> file
"""

from __future__ import annotations

import asyncio

import asyncpg

from app.config import settings

SCHEMA = settings.db_schema


async def main() -> None:
    c = await asyncpg.connect(settings.database_url, statement_cache_size=0)
    try:
        tables = [
            r["table_name"]
            for r in await c.fetch(
                "select table_name from information_schema.tables "
                "where table_schema = $1 and table_type = 'BASE TABLE' order by table_name",
                SCHEMA,
            )
        ]
        print(f"-- hostiggo schema dump: {SCHEMA}  ({len(tables)} tables)\n")

        for tbl in tables:
            cols = await c.fetch(
                """select column_name, data_type, udt_name, character_maximum_length,
                          numeric_precision, numeric_scale, is_nullable, column_default
                   from information_schema.columns
                   where table_schema = $1 and table_name = $2
                   order by ordinal_position""",
                SCHEMA, tbl,
            )
            # constraints
            cons = await c.fetch(
                """select con.conname, con.contype,
                          pg_get_constraintdef(con.oid) as def
                   from pg_constraint con
                   join pg_class rel on rel.oid = con.conrelid
                   join pg_namespace nsp on nsp.oid = rel.relnamespace
                   where nsp.nspname = $1 and rel.relname = $2
                   order by con.contype desc, con.conname""",
                SCHEMA, tbl,
            )

            print(f'CREATE TABLE "{SCHEMA}"."{tbl}" (')
            lines = []
            for col in cols:
                t = col["data_type"]
                if t == "character varying" and col["character_maximum_length"]:
                    t = f"varchar({col['character_maximum_length']})"
                elif t == "numeric" and col["numeric_precision"]:
                    t = f"numeric({col['numeric_precision']},{col['numeric_scale'] or 0})"
                elif t == "USER-DEFINED":
                    t = col["udt_name"]
                null = "" if col["is_nullable"] == "YES" else " NOT NULL"
                dflt = f" DEFAULT {col['column_default']}" if col["column_default"] else ""
                lines.append(f'  "{col["column_name"]}" {t}{null}{dflt}')
            for con in cons:
                lines.append(f'  CONSTRAINT "{con["conname"]}" {con["def"]}')
            print(",\n".join(lines))
            print(");\n")
    finally:
        await c.close()


if __name__ == "__main__":
    asyncio.run(main())
