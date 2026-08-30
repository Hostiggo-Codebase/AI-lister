# Playwright's own image already has Chromium + all system libs.
FROM mcr.microsoft.com/playwright/python:v1.48.0-jammy

ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 PORT=8000
WORKDIR /srv

COPY pyproject.toml ./
COPY app ./app
RUN pip install --upgrade pip && pip install .

COPY sql ./sql
COPY migrate.py ./

EXPOSE 8000
# shell form so $PORT (set by Render/Railway/Cloud Run) is honoured
CMD uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}
