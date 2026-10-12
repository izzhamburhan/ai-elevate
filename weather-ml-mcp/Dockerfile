# Multi-architecture Python/uv manifests are pinned; builds use the native CPU architecture.
FROM ghcr.io/astral-sh/uv:0.12.18@sha256:3adc3706091ce7c2fe595e669628caedd6d951551b92b258b7e7dbe06d9440bc AS uv
FROM python:3.12-slim-bookworm@sha256:34386ef0cb081344d7ec1c103ba398e6e9f64e9ab3a1509accc92a4e24a07258 AS dependencies
COPY --from=uv /uv /uvx /usr/local/bin/
ENV UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv uv sync --frozen --no-install-project

FROM dependencies AS runtime
RUN groupadd --gid 10001 weather && useradd --uid 10001 --gid weather --no-create-home weather \
    && mkdir -p /data /models/chronos-2-small /reports && chown -R weather:weather /data /models /reports
COPY src ./src
COPY tests ./tests
COPY scripts ./scripts
RUN --mount=type=cache,target=/root/.cache/uv uv sync --frozen
ENV PATH="/app/.venv/bin:$PATH" \
    WEATHER_DATA_DIR=/data WEATHER_MODEL_DIR=/models/chronos-2-small WEATHER_REPORTS_DIR=/reports \
    HF_HOME=/models/huggingface HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 \
    HF_HUB_DISABLE_TELEMETRY=1 HF_HUB_DISABLE_XET=1 \
    OMP_NUM_THREADS=2 MKL_NUM_THREADS=2 OPENBLAS_NUM_THREADS=1
USER 10001:10001
EXPOSE 8001
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
    CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8001/readyz', timeout=4)"]
CMD ["python", "-m", "weather_ml_mcp.server", "--host", "0.0.0.0", "--port", "8001"]
