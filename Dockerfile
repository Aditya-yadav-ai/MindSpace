# MindSpace Production API Service Image
# Hardened multi-stage/non-root execution for enterprise deployment

FROM python:3.12-slim AS runner

WORKDIR /app

# Install security updates and build dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc g++ libffi-dev \
    && rm -rf /var/lib/apt/lists/*

# Install pinned dependencies in single invocation to prevent version drift
COPY apps/api/requirements.txt ./requirements.txt
COPY apps/api/mas/requirements_mas.txt ./requirements_mas.txt

RUN pip install --no-cache-dir -r requirements.txt -r requirements_mas.txt

# Create non-root system user and group
RUN groupadd -r mindspace && useradd -r -g mindspace -d /app -s /sbin/nologin mindspace

# Copy application source code
COPY apps/api/ ./

# Create necessary output directories and grant permissions
RUN mkdir -p /app/mas/outputs && chown -R mindspace:mindspace /app

USER mindspace

ENV PYTHONPATH=/app \
    PYTHONUNBUFFERED=1 \
    PORT=8010 \
    ENVIRONMENT=production

EXPOSE 8010

# Production liveness health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD python -c "import os, urllib.request; urllib.request.urlopen('http://127.0.0.1:%s/health' % os.environ.get('PORT', '8010'), timeout=4)" || exit 1

CMD ["python", "-m", "app.main"]
