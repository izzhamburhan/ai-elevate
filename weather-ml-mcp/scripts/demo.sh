#!/usr/bin/env bash
# Cached pitch operations only. Does not download, seed or reset data.
set -euo pipefail
service_dir="$(cd "$(dirname "$0")/.." && pwd)"
frontend_dir="$(cd "$service_dir/../frontend" && pwd)"
export NEXT_PUBLIC_WEATHER_DEMO_MODE=1
export LOCAL_LLM_MODEL="${LOCAL_LLM_MODEL:-qwen3.5:9b}"
export NEXT_PUBLIC_LOCAL_LLM_LABEL="${NEXT_PUBLIC_LOCAL_LLM_LABEL:-$LOCAL_LLM_MODEL (local)}"
export LOCAL_LLM_REASONING_EFFORT="${LOCAL_LLM_REASONING_EFFORT:-none}"
export LOCAL_LLM_BASE_URL="${LOCAL_LLM_BASE_URL:-http://127.0.0.1:11434/v1}"
export WEATHER_ML_HTTP_URL="${WEATHER_ML_HTTP_URL:-http://127.0.0.1:8002}"
export NEXT_PUBLIC_WEATHER_MCP_URL="$WEATHER_ML_HTTP_URL/mcp"
export WEATHER_MODE=replay
export WEATHER_REPLAY_CUTOFF=2026-09-25T23:00:00Z
demo_port="${WEATHER_DEMO_FRONTEND_PORT:-3001}"

case "${1:-help}" in
  build)
    # Prepare before the pitch: Next self-hosts fonts acquired at build time.
    cd "$frontend_dir"
    npm run build
    ;;
  start)
    test -f "$frontend_dir/.next/BUILD_ID" || { echo "Run bash scripts/demo.sh build before the pitch." >&2; exit 1; }
    # Dependencies must already be running. Never install or pull a local model here.
    curl --fail --silent --show-error http://127.0.0.1:8000/api/tools >/dev/null
    python3 - "$LOCAL_LLM_MODEL" <<'PY'
import json, sys, urllib.request
with urllib.request.urlopen('http://127.0.0.1:11434/api/tags', timeout=10) as response:
    models = json.load(response)['models']
if not any(model['name'] == sys.argv[1] for model in models):
    raise SystemExit('Required local Ollama model is not cached; prepare it before the pitch.')
PY
    cd "$service_dir"
    docker compose -p ai-elevate-weather up -d --no-build --pull never --wait --wait-timeout 120 weather
    curl --fail --silent --show-error "$WEATHER_ML_HTTP_URL/readyz" >/dev/null
    cd "$frontend_dir"
    exec npm run start -- --hostname 127.0.0.1 --port "$demo_port"
    ;;
  check)
    # Open the app and generate its Weather overlay first; this checks the live map bridge.
    cd "$service_dir"
    docker compose -p ai-elevate-weather run --rm --no-deps --pull never --entrypoint python tests \
      scripts/verify_deployment.py --url http://weather:8001 \
      --frontend-url "http://host.docker.internal:$demo_port" \
      --frontend-mcp-url "$NEXT_PUBLIC_WEATHER_MCP_URL" --expected-basemap no_map
    ;;
  *)
    echo "Usage: bash scripts/demo.sh {build|start|check}"
    echo "build before the pitch; start uses existing NetOps/Ollama and caches; check after generating the overlay."
    ;;
esac
