from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api import router
from app.config import settings
from app.db import connect, disconnect
from app.worker import start_workers, stop_workers

logging.basicConfig(level=settings.log_level)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await connect()
    if settings.has_db:
        start_workers()
    yield
    await stop_workers()
    await disconnect()


app = FastAPI(
    title="Hostiggo OTA Listing Import Service",
    version="0.1.0",
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(router)


@app.exception_handler(RuntimeError)
async def _runtime_error(_: Request, exc: RuntimeError):
    return JSONResponse(status_code=503, content={"error": str(exc)})


@app.get("/healthz")
async def healthz():
    return {
        "ok": True,
        "db": settings.has_db,
        "llm": "anthropic" if settings.has_llm else "heuristic",
        "storage": settings.has_storage,
        "tier2": settings.import_tier2_enabled,
    }
