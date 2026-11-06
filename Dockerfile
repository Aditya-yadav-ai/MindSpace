# MindSpace API service image.
#
# Dependencies are installed in a single pip invocation from the two pinned
# manifests. Installing them separately lets pip re-resolve shared packages
# (fastapi, opentelemetry, pydantic) and silently break the compatibility
# window documented in apps/api/requirements.txt.

FROM python:3.12-slim

WORKDIR /app

# System build dependencies for matplotlib / scientific wheels
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc g++ libffi-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy manifests first for better layer caching
COPY apps/api/requirements.txt ./requirements.txt
COPY apps/api/mas/requirements_mas.txt ./requirements_mas.txt

RUN pip install --no-cache-dir -r requirements.txt -r requirements_mas.txt

# Application code (see .dockerignore for what is excluded)
COPY apps/api/ ./

ENV PYTHONPATH=/app \
    PYTHONUNBUFFERED=1 \
    PORT=8000

EXPOSE 8000

# Probe /health on the same port the app actually binds (PORT, default 8000).
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD python -c "import os, urllib.request; urllib.request.urlopen('http://127.0.0.1:%s/health' % os.environ.get('PORT', '8000'), timeout=4)" || exit 1

CMD ["python", "-m", "app.main"]
