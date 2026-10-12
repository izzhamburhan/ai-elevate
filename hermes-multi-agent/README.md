# Hermes Multi-Agent Foundation

Four actual Nous Research Hermes profiles coordinate local investigations through the existing Weather ML and NetOps services. This is Order 2's hackathon MVP; the existing Next.js agent, maps, Weather panel, Menara and HEAL remain separate working features.

The pinned runtime is [Hermes v0.21.7](https://github.com/NousResearch/hermes-agent/tree/71d34bad1045610252eda02ee79549436896e784), revision `71d34bad1045610252eda02ee79549436896e784` (MIT). It runs in a Python 3.14 Linux ARM64 container and uses the existing native Ollama `qwen3.5:9b`. No reasoning model is duplicated inside Docker.

A narrow container-local adapter translates Hermes's chat-completions format to [Ollama's native chat API](https://docs.ollama.com/api/chat), applying a verified per-request 65536-token context and disabling thinking. It does not restart or reconfigure native Ollama. The larger context currently allocates about 7.60 GiB for the native model outside the container's 1.5 GiB limit. Investigation output appears when the native reply completes; specialist activity is reported separately.

## Start locally

Docker Desktop, native Ollama with `qwen3.5:9b`, NetOps on port 8000, and the existing cached Weather ML on port 8002 must already be available. Do not alter existing SSH tunnels or unrelated containers.

```bash
cd /Users/saf/Desktop/Hackathon/ai-elevate/hermes-multi-agent
cp .env.example .env  # optional, only when this project's .env does not exist
./scripts/dev.sh build
./scripts/dev.sh up
./scripts/dev.sh check
```

The independent Compose project is `ai-elevate-hermes`, normally bound to `127.0.0.1:8011`. The startup script refuses an occupied port rather than stopping its listener. A configured alternate port also requires `HERMES_API_URL` to match in the Next.js server environment.

The equivalent service commands are:

```bash
docker compose -p ai-elevate-hermes build
docker compose -p ai-elevate-hermes up -d --no-deps hermes
docker compose -p ai-elevate-hermes ps
docker compose -p ai-elevate-hermes logs -f hermes
```

Readiness reports service connectivity and four profile identities. An actual investigation is still required to qualify inference and delegation. Schedules are disabled. Approved tools contain no shell, network writes or ticket mutation operations.

## Open AI Elevate

Use the existing frontend configuration and dependency installation. When preparing a fresh frontend build, ensure build-time fonts can be downloaded before an offline pitch.

```bash
cd /Users/saf/Desktop/Hackathon/ai-elevate/frontend
npm run build
HERMES_API_URL=http://127.0.0.1:8011 npm run start -- --hostname 127.0.0.1 --port 3001
```

If port 3001 already serves AI Elevate, do not terminate it automatically. Start the updated frontend at an available operator-selected port or intentionally replace that same application's process after saving its state. `HERMES_API_URL` is server-only; it is never sent to the browser. Existing cached Weather pitch configuration (`NEXT_PUBLIC_WEATHER_DEMO_MODE=1`) can be retained when building.

Open `/workspace`, choose the **Agents** (robot icon) map panel, select **Orchestrator**, and submit:

> Investigate telecom sites in Selangor that may be exposed to heavy rainfall.

Watch actual specialist task status and successful MCP calls. Use **Show findings on map** when source-backed points are returned. Historical replay can correctly show low rainfall exposure; the agents must not invent a storm or outage.

## Repeat, inspect and stop

Each request gets a new investigation ID. Repeating it uses the same source records and cached Chronos replay; LLM wording, tool order and elapsed time can vary. Selecting each role maintains its own frontend session reference, while profile memories persist in Docker's `ai-elevate-hermes_state` volume.

```bash
./scripts/dev.sh status
./scripts/dev.sh check
./scripts/dev.sh logs
./scripts/dev.sh restart
./scripts/dev.sh stop
```

`stop` affects only Hermes and preserves memories, sessions and the investigation ledger. Do not use `down -v`, delete its volume, or reset any NetOps/PostgreSQL database. A restart interrupts in-flight investigations explicitly; submit them again after readiness returns.

For actual end-to-end qualification, with an updated frontend running:

```bash
python3 scripts/verify_runtime.py \
  --url http://127.0.0.1:8011 \
  --frontend-url http://127.0.0.1:3001 \
  --runs 3 --timeout 1200 \
  --agents-smoke business,engineer \
  --report /tmp/ai-elevate-hermes-qualification.json

docker compose -p ai-elevate-hermes exec -T hermes \
  python -m pytest -q /app/tests
```

The verification script performs real model/tool calls and writes investigation references into the selected agents' memories. Unit-test fixtures are explicitly synthetic and do not prove native runtime execution.

The full architecture, qualification checklist, observed performance and limitations are in [the implementation report](../docs/HERMES_MULTI_AGENT_IMPLEMENTATION.md).
