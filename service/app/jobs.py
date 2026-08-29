"""Persistence for `listing_imports` + `import_batches` (the queue)."""

from __future__ import annotations

from typing import Any

import asyncpg

from app.config import settings
from app.db import dict_row, execute, fetch, fetchrow, pool

IS = settings.import_schema
IMP = f'"{IS}"."listing_imports"'
BATCH = f'"{IS}"."import_batches"'

# jsonb columns are encoded once by the asyncpg codec in app.db — pass raw
# Python objects straight through, never pre-serialise them here.
_JSON_FIELDS = {
    "raw_payload", "normalized_payload", "field_coverage", "recommendations",
    "fx", "ical", "source_photo_urls", "mirrored_photos", "logs",
}


def _encode(patch: dict[str, Any]) -> dict[str, Any]:
    return dict(patch)


class DuplicateImport(Exception):
    def __init__(self, existing: dict):
        self.existing = existing
        super().__init__("this listing was already imported")


async def get_import_by_external(provider: str, ext: str) -> dict | None:
    return dict_row(
        await fetchrow(
            f"select * from {IMP} where provider = $1 and external_listing_id = $2 "
            "and status <> 'failed' order by import_id desc limit 1",
            provider,
            ext,
        )
    )


async def create_import(data: dict[str, Any]) -> dict:
    enc = _encode(data)
    cols = ", ".join(f'"{k}"' for k in enc)
    ph = ", ".join(f"${i + 1}" for i in range(len(enc)))
    try:
        row = await fetchrow(
            f"insert into {IMP} ({cols}) values ({ph}) returning *", *enc.values()
        )
    except asyncpg.UniqueViolationError as e:
        ext = data.get("external_listing_id")
        if ext:
            existing = await get_import_by_external(data["provider"], ext)
            if existing:
                raise DuplicateImport(existing) from e
        raise
    return dict_row(row)


async def get_import(import_id: int) -> dict | None:
    return dict_row(await fetchrow(f"select * from {IMP} where import_id = $1", import_id))


async def list_imports(limit: int = 30, batch_id: int | None = None) -> list[dict]:
    if batch_id is not None:
        rows = await fetch(
            f"select * from {IMP} where batch_id = $1 order by import_id", batch_id
        )
    else:
        rows = await fetch(
            f"select * from {IMP} order by created_at desc limit $1", limit
        )
    return [dict(r) for r in rows]


async def update_import(import_id: int, **patch: Any) -> dict:
    patch = _encode(patch)
    sets = ", ".join(f'"{k}" = ${i + 2}' for i, k in enumerate(patch))
    row = await fetchrow(
        f"update {IMP} set {sets}, updated_at = now() where import_id = $1 returning *",
        import_id, *patch.values(),
    )
    return dict_row(row)


async def claim_next_pending() -> dict | None:
    """Atomically grab the oldest queued import and flip it to 'fetching'."""
    async with pool().acquire() as conn, conn.transaction():
        row = await conn.fetchrow(
            f"""select * from {IMP}
                    where status = 'pending'
                    order by created_at
                    for update skip locked
                    limit 1"""
        )
        if not row:
            return None
        await conn.execute(
            f"update {IMP} set status = 'fetching', updated_at = now() where import_id = $1",
            row["import_id"],
        )
        d = dict(row)
        d["status"] = "fetching"
        return d


async def delete_import(import_id: int) -> None:
    await execute(f"delete from {IMP} where import_id = $1", import_id)


async def reset_import(import_id: int) -> dict:
    return await update_import(
        import_id,
        status="fetching",
        stage="queued",
        error_message=None,
        logs=[],
        mirrored_photos=[],
        fx=None,
        field_coverage=None,
        recommendations=[],
    )


# --------------------------------------------------------------------------- #
# batches
# --------------------------------------------------------------------------- #
async def create_batch(source_url: str, provider: str, host_name: str | None,
                       host_uuid: str | None) -> dict:
    row = await fetchrow(
        f"""insert into {BATCH} (source_url, provider, host_name, host_uuid)
            values ($1, $2, $3, $4) returning *""",
        source_url, provider, host_name, host_uuid,
    )
    return dict_row(row)


async def get_batch(batch_id: int) -> dict | None:
    return dict_row(await fetchrow(f"select * from {BATCH} where batch_id = $1", batch_id))


async def list_batches(limit: int = 20) -> list[dict]:
    rows = await fetch(f"select * from {BATCH} order by created_at desc limit $1", limit)
    return [dict(r) for r in rows]
