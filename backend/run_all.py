"""Run the whole stack with one command: netops-mcp, the Menara MCP servers and (optionally) the frontend.

Usage (from backend/):
    python run_all.py                  # netops + all Menara MCPs, Ctrl+C stops them
    python run_all.py --frontend       # ... plus the frontend (npm run dev, http://localhost:3000)
    python run_all.py tower ticket     # only these (name without "-mcp"; "netops" is allowed)
    python run_all.py list             # names and ports

Menara servers are found by scanning */src/*/server.py for DEFAULT_PORT, so a new MCP shows up without
changes. Missing seed data is created on first run. netops-mcp keeps its own environment (Python 3.12, fastmcp) and is started from its own folder.
Ports: frontend 3000, netops 8000, Menara MCPs 8101-8121.
"""

from __future__ import annotations

import re
import socket
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
FRONTEND = ROOT.parent / "frontend"
NETOPS = ROOT / "netops-mcp"
NETOPS_PORT = 8000
FRONTEND_PORT = 3000
# netops-mcp pins Python 3.12, which uv downloads as an unsigned exe that Windows policy can block.
# Build its venv on the same Python that runs this script instead.
PY = f"{sys.version_info.major}.{sys.version_info.minor}"
PORT_RE = re.compile(r"^DEFAULT_PORT\s*=\s*(\d+)", re.MULTILINE)


def discover() -> dict[str, tuple[str, int]]:
    """name -> (python module, port) for the Menara servers"""
    found: dict[str, tuple[str, int]] = {}
    for server_py in sorted(ROOT.glob("*/src/*/server.py")):
        match = PORT_RE.search(server_py.read_text(encoding="utf-8"))
        if match:
            found[server_py.parents[2].name.removesuffix("-mcp")] = (server_py.parent.name, int(match.group(1)))
    return dict(sorted(found.items(), key=lambda kv: kv[1][1]))


def port_in_use(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        return s.connect_ex(("127.0.0.1", port)) == 0


def seed_if_missing(selected: list[str]) -> None:
    """One-time data setup, only for files that do not exist yet (netops places download takes ~2 min)."""
    if any(n != "netops" for n in selected) and not (ROOT / "data" / "menara.db").exists():
        print("seeding Menara DB ...")
        subprocess.run(["uv", "run", "--no-sync", "python", "-m", "menara_core.seed.cli"], cwd=ROOT, check=True)
    if "netops" in selected:
        data = NETOPS / "data"
        steps = [
            ("netops.duckdb", "netops_mcp.seed"),
            ("boundaries_my.parquet", "netops_mcp.seed.boundaries"),
            ("places_my.parquet", "netops_mcp.seed.places"),
        ]
        for filename, module in steps:
            if not (data / filename).exists():
                print(f"seeding netops: {filename} ...")
                subprocess.run(["uv", "run", "--no-sync", "--python", PY, "python", "-m", module], cwd=NETOPS, check=True)


def stop(proc: subprocess.Popen[bytes]) -> None:
    if proc.poll() is not None:
        return
    if sys.platform == "win32":
        # uv and npm spawn the real server as a child; kill the whole tree
        subprocess.run(["taskkill", "/F", "/T", "/PID", str(proc.pid)], capture_output=True)
    else:
        proc.terminate()


def main() -> int:
    menara = discover()
    args = sys.argv[1:]
    with_frontend = "--frontend" in args
    names = [a for a in args if a != "--frontend"]

    ports = {"netops": NETOPS_PORT, **{n: p for n, (_, p) in menara.items()}}
    if names == ["list"]:
        for name, port in ports.items():
            print(f"{name:<12} http://127.0.0.1:{port}/mcp")
        print(f"{'frontend':<12} http://localhost:{FRONTEND_PORT}  (with --frontend)")
        return 0

    unknown = [a for a in names if a not in ports]
    if unknown:
        print(f"unknown: {', '.join(unknown)}. Known: {', '.join(ports)}", file=sys.stderr)
        return 2
    selected = names or list(ports)

    wanted = {n: ports[n] for n in selected}
    if with_frontend:
        wanted["frontend"] = FRONTEND_PORT
    busy = {n: p for n, p in wanted.items() if port_in_use(p)}
    if busy:
        print("ports already in use (stop the old process first): " + ", ".join(f"{n}:{p}" for n, p in busy.items()), file=sys.stderr)
        return 1

    # sync once so the parallel `uv run --no-sync` calls do not fight over the environment
    if any(n != "netops" for n in selected):
        subprocess.run(["uv", "sync"], cwd=ROOT, check=True)
    if "netops" in selected:
        subprocess.run(["uv", "sync", "--python", PY], cwd=NETOPS, check=True)

    seed_if_missing(selected)

    procs: dict[str, subprocess.Popen[bytes]] = {}
    try:
        for name in selected:
            if name == "netops":
                cmd = ["uv", "run", "--no-sync", "--python", PY, "python", "-m", "netops_mcp.server", "--http"]
                procs[name] = subprocess.Popen(cmd, cwd=NETOPS)
            else:
                module, port = menara[name]
                cmd = ["uv", "run", "--no-sync", "python", "-m", module, "--transport", "streamable-http", "--port", str(port)]
                procs[name] = subprocess.Popen(cmd, cwd=ROOT)
            print(f"started {name:<12} http://127.0.0.1:{ports[name]}/mcp")
        if with_frontend:
            procs["frontend"] = subprocess.Popen("npm run dev", cwd=FRONTEND, shell=True)
            print(f"started {'frontend':<12} http://localhost:{FRONTEND_PORT}")
        print("Ctrl+C to stop all.")
        while True:
            time.sleep(1)
            for name, proc in procs.items():
                if proc.poll() not in (None, 0):
                    print(f"{name} exited with code {proc.returncode}", file=sys.stderr)
                    return 1
    except KeyboardInterrupt:
        return 0
    finally:
        for proc in procs.values():
            stop(proc)


if __name__ == "__main__":
    sys.exit(main())
