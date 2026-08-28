from __future__ import annotations

import asyncio
import contextlib
import logging

from app import jobs
from app.config import settings
from app.db import connect, disconnect
from app.pipeline.orchestrator import run_pipeline

log = logging.getLogger("import.worker")

_tasks: list[asyncio.Task] = []
_stop = asyncio.Event()


async def _loop(worker_id: int) -> None:
    while not _stop.is_set():
        try:
            record = await jobs.claim_next_pending()
        except Exception:
            log.exception("worker %s: claim failed", worker_id)
            await asyncio.sleep(3)
            continue
        if not record:
            try:
                await asyncio.wait_for(_stop.wait(), timeout=2.0)
            except TimeoutError:
                pass
            continue
        log.info("worker %s: import %s (%s)", worker_id, record["import_id"], record["source_url"])
        try:
            await run_pipeline(record)
        except Exception:
            log.exception("worker %s: pipeline crashed for %s", worker_id, record["import_id"])


def start_workers() -> None:
    if _tasks:
        return
    _stop.clear()
    for i in range(max(1, settings.import_worker_concurrency)):
        _tasks.append(asyncio.create_task(_loop(i)))
    log.info("started %d import worker(s)", len(_tasks))


async def stop_workers() -> None:
    _stop.set()
    for task in _tasks:
        task.cancel()
    for task in _tasks:
        with contextlib.suppress(asyncio.CancelledError):
            await task
    _tasks.clear()


async def _standalone() -> None:
    logging.basicConfig(level=settings.log_level)
    await connect()
    start_workers()
    try:
        await _stop.wait()
    finally:
        await stop_workers()
        await disconnect()


if __name__ == "__main__":
    asyncio.run(_standalone())
