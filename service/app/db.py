from __future__ import annotations

import json
from contextlib import asynccontextmanager
from typing import Any

import asyncpg

from app.config import settings

_pool: asyncpg.Pool | None = None


async def _init(conn: asyncpg.Connection) -> None:
    # store/return jsonb as python objects
    await conn.set_type_codec(
        "jsonb", encoder=json.dumps, decoder=json.loads, schema="pg_catalog"
    )
    await conn.set_type_codec(
        "json", encoder=json.dumps, decoder=json.loads, schema="pg_catalog"
    )


async def connect() -> None:
    global _pool
    if _pool or not settings.has_db:
        return
    _pool = await asyncpg.create_pool(
        settings.database_url, min_size=1, max_size=10, init=_init, command_timeout=60
    )


async def disconnect() -> None:
    global _pool
    if _pool:
        await _pool.close()
        _pool = None


def pool() -> asyncpg.Pool:
    if not _pool:
        raise RuntimeError("DB pool not initialised — set DATABASE_URL")
    return _pool


@asynccontextmanager
async def tx():
    async with pool().acquire() as conn, conn.transaction():
        yield conn


async def fetch(query: str, *args) -> list[asyncpg.Record]:
    async with pool().acquire() as conn:
        return await conn.fetch(query, *args)


async def fetchrow(query: str, *args) -> asyncpg.Record | None:
    async with pool().acquire() as conn:
        return await conn.fetchrow(query, *args)


async def execute(query: str, *args) -> str:
    async with pool().acquire() as conn:
        return await conn.execute(query, *args)


def dict_row(row: asyncpg.Record | None) -> dict[str, Any] | None:
    return dict(row) if row is not None else None
