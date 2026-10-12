#!/usr/bin/env bash
# Operate only the independent AI Elevate Hermes Compose project.
set -euo pipefail

SERVICE_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT="ai-elevate-hermes"

compose() {
  docker compose --project-directory "$SERVICE_DIR" -f "$SERVICE_DIR/compose.yaml" -p "$PROJECT" "$@"
}

host_port() {
  compose config --format json | python3 -c '
import json,sys
ports=json.load(sys.stdin)["services"]["hermes"]["ports"]
port=next(p for p in ports if p["target"] == 8011)
if port.get("host_ip") != "127.0.0.1":
    raise SystemExit("Hermes must remain bound to 127.0.0.1")
value=int(port["published"])
if not 1024 <= value <= 65535:
    raise SystemExit("Choose an unprivileged valid Hermes host port")
print(value)
'
}

check_port() {
  local selected_port existing_id existing_port
  selected_port="$(host_port)"
  existing_id="$(compose ps --status running --quiet hermes)"
  if [ -n "$existing_id" ]; then
    existing_port="$(docker inspect "$existing_id" --format '{{json .NetworkSettings.Ports}}' | python3 -c 'import sys,json; p=json.load(sys.stdin).get("8011/tcp") or []; print(next((x["HostPort"] for x in p if x["HostIp"] == "127.0.0.1"), ""))')"
    if [ "$existing_port" = "$selected_port" ]; then
      return
    fi
  fi
  python3 - "$selected_port" <<'PY'
import socket,sys
port=int(sys.argv[1])
try:
    with socket.socket() as listener:
        listener.bind(("127.0.0.1",port))
except OSError:
    raise SystemExit(f"localhost:{port} is occupied. Leave the existing listener alone; choose an available HERMES_HOST_PORT in this project's .env.")
PY
}

readiness() {
  local selected_port
  selected_port="$(host_port)"
  python3 - "$selected_port" <<'PY'
import json,sys,urllib.request
base=f"http://127.0.0.1:{int(sys.argv[1])}"
try:
    with urllib.request.urlopen(base+"/healthz",timeout=8) as response:
        health=json.load(response)
    with urllib.request.urlopen(base+"/readyz",timeout=8) as response:
        ready=json.load(response)
except Exception as exc:
    raise SystemExit(f"Hermes is not reachable ({type(exc).__name__}); inspect only this project's logs.")
print(json.dumps({"health":health,"readiness":ready},indent=2))
if health.get("ok") is not True or ready.get("ready") is not True:
    raise SystemExit("Hermes is not ready. Check native Ollama, Weather ML and NetOps without resetting or restarting unrelated services.")
PY
}

case "${1:-help}" in
  build)
    compose build hermes
    ;;
  up)
    check_port
    compose up -d --no-deps hermes
    compose ps hermes
    printf 'Hermes API: http://127.0.0.1:%s\nRun ./scripts/dev.sh check after startup.\n' "$(host_port)"
    ;;
  check)
    readiness
    ;;
  status)
    compose ps hermes
    ;;
  logs)
    compose logs --tail 100 -f hermes
    ;;
  restart)
    compose restart hermes
    ;;
  stop)
    compose stop hermes
    ;;
  help|--help|-h)
    printf 'Usage: %s {build|up|check|status|logs|restart|stop}\n' "$0"
    printf 'Only ai-elevate-hermes is operated. stop preserves profile memories, sessions and investigation data.\n'
    ;;
  *)
    printf 'Unknown command. Use %s --help\n' "$0" >&2
    exit 2
    ;;
esac
