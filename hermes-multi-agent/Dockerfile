# Native ARM64 and AMD64 manifests; this build does not install another container runtime.
FROM ghcr.io/astral-sh/uv:0.12.18@sha256:3adc3706091ce7c2fe595e669628caedd6d951551b92b258b7e7dbe06d9440bc AS uv
FROM python:3.14-slim-bookworm@sha256:48b13b003dda20b16f9442b8475aa05fe21bf6579a8c881db92ffb4d8fd20f83 AS dependencies
COPY --from=uv /uv /uvx /usr/local/bin/
ENV UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv uv sync --frozen --no-install-project

# The official source distribution is used directly: Hermes deliberately blocks
# ordinary wheels. Its original MIT notice stays at /opt/hermes/LICENSE.
ADD --checksum=sha256:a88ae3f634a3fd45050d3418d80b30ee5af51c89b9de40ec1ea3039d3024d77a https://github.com/NousResearch/hermes-agent/archive/71d34bad1045610252eda02ee79549436896e784.tar.gz /tmp/hermes.tar.gz
RUN mkdir /opt/hermes && tar -xzf /tmp/hermes.tar.gz --strip-components=1 -C /opt/hermes \
    && rm /tmp/hermes.tar.gz \
    && test -f /opt/hermes/LICENSE

FROM dependencies AS runtime
RUN groupadd --gid 10001 hermes && useradd --uid 10001 --gid hermes --no-create-home hermes \
    && mkdir /state && chown hermes:hermes /state
COPY src ./src
COPY profiles ./profiles
COPY tests ./tests
COPY scripts ./scripts
ENV PATH="/app/.venv/bin:$PATH" PYTHONPATH=/app/src:/opt/hermes \
    HERMES_HOME=/state HERMES_STATE_DIR=/state HERMES_PROFILE_TEMPLATES=/app/profiles \
    HERMES_SOURCE_DIR=/opt/hermes HERMES_DISABLE_LAZY_INSTALLS=1 \
    HERMES_API_TIMEOUT=240 HERMES_API_STALE_TIMEOUT=240 \
    OMP_NUM_THREADS=2 OPENBLAS_NUM_THREADS=1
USER 10001:10001
EXPOSE 8011
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
    CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8011/healthz', timeout=4)"]
CMD ["python", "-m", "elevate_hermes.server"]
