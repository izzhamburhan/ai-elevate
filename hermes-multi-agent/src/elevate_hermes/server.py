"""Local investigation API. Model reasoning and tool decisions run in real Hermes workers."""
import asyncio
from contextlib import asynccontextmanager
import hashlib
import hmac
import json
import logging
import os
from pathlib import Path
import secrets
import sqlite3
import sys
import uuid

from fastapi import FastAPI, HTTPException, Request
import httpx
import uvicorn

from elevate_hermes import HERMES_VERSION, HERMES_REVISION
from elevate_hermes.config import AGENTS, DELEGATION, NAMES, Settings
from elevate_hermes.contracts import InvestigationRequest, DelegationRequest, source_summary, delegation_evidence, unexecuted_tool_claims
from elevate_hermes import decision, feasibility
from elevate_hermes.initialize import initialize_profiles
from elevate_hermes.mcp_access import AGENT_TOOL_ALLOWLISTS
from elevate_hermes.store import Store, now, source_geojson
from elevate_hermes.ollama_adapter import router as ollama_router

logger = logging.getLogger("elevate.hermes")


class Runtime:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.store = Store(settings.state_dir / "investigations.sqlite")
        self.profile_locks = {role: asyncio.Lock() for role in AGENTS}
        self.job_lock = asyncio.Semaphore(1)
        self.tokens = {}
        self.background = set()
        self.processes = set()
        self.child_tasks = {}

    async def availability(self) -> dict:
        available = {}
        async with httpx.AsyncClient(timeout=4) as client:
            for service, url in (("ollama", self.settings.ollama_url + "/api/tags"),
                                 ("weather", self.settings.weather_url + "/readyz"),
                                 ("netops", self.settings.netops_url + "/api/tools"),
                                 ("opportunity", self.settings.opportunity_url + "/healthz")):
                try:
                    response = await client.get(url)
                    response.raise_for_status()
                    value = response.json()
                    available[service] = any(model["name"] == self.settings.model for model in value["models"]) if service == "ollama" else bool(value.get("ready")) if service == "weather" else bool(value.get("ok")) if service == "opportunity" else isinstance(value, list) and bool(value)
                except Exception:
                    available[service] = False
        agents = []
        for role in AGENTS:
            home = self.settings.profile_dir(role)
            soul = home / "SOUL.md"
            skills = sorted(path.parent.name for path in (home / "skills").rglob("SKILL.md"))
            requirements = ["ollama"] + list(AGENT_TOOL_ALLOWLISTS[role])
            warnings = [f"Required local {service} service unavailable" for service in requirements if not available.get(service)]
            if not soul.is_file() or not skills:
                warnings.append("Profile identity or dedicated skills unavailable")
            memory = home / "memories" / "MEMORY.md"
            sessions = 0
            database = home / "state.db"
            if database.exists():
                try:
                    with sqlite3.connect(f"file:{database}?mode=ro", uri=True) as db:
                        sessions = db.execute("SELECT count(*) FROM sessions").fetchone()[0]
                except sqlite3.Error:
                    pass
            tools = sorted(name for names in AGENT_TOOL_ALLOWLISTS[role].values() for name in names)
            if role in DELEGATION:
                tools += ["delegate_specialist"]
            agents.append({"agent_id": role, "name": NAMES[role], "available": not warnings,
                           "capabilities": tools, "warnings": warnings, "soul_loaded": soul.is_file(), "skills": skills,
                           "memory_sha256": hashlib.sha256(memory.read_bytes()).hexdigest() if memory.exists() else None,
                           "memory_bytes": memory.stat().st_size if memory.exists() else 0, "session_count": sessions})
        return {"ready": all(agent["available"] for agent in agents), "agents": agents, "warnings": [],
                "services": available, "runtime": {"name": "hermes-agent", "version": HERMES_VERSION,
                    "revision": HERMES_REVISION, "model": self.settings.model, "schedules_enabled": False}}

    def authorize(self, request: Request, investigation_id: str, task_id: str) -> dict:
        token = self.tokens.get(investigation_id)
        if not token or not hmac.compare_digest(token, request.headers.get("X-Elevate-Worker-Token", "")):
            raise HTTPException(403, "Internal worker authorization required")
        job = self.store.get(investigation_id)
        task = next((task for task in job["tasks"] if task["task_id"] == task_id), None) if job else None
        if not task or task["status"] != "running":
            raise HTTPException(403, "Worker task is not active")
        return task

    async def run_task(self, investigation_id: str, role: str, prompt: str, session_id: str | None = None) -> dict:
        task_id = uuid.uuid4().hex
        task = {"task_id": task_id, "agent_id": role, "session_id": session_id or uuid.uuid4().hex,
                "status": "queued", "summary": None, "sources": [], "warnings": [], "tool_calls": [], "error": None}
        self.store.update(investigation_id, lambda job: job["tasks"].append(task))
        async with self.profile_locks[role]:
            self.store.update(investigation_id, lambda job: next(t for t in job["tasks"] if t["task_id"] == task_id).update(status="running", started_at=now()))
            runs = self.settings.state_dir / "runs"
            runs.mkdir(exist_ok=True)
            request_path, result_path = runs / f"{task_id}.request.json", runs / f"{task_id}.result.json"
            request_path.write_text(json.dumps({"investigation_id": investigation_id, "task_id": task_id, "agent_id": role,
                                              "session_id": task["session_id"], "prompt": prompt}))
            environment = {**os.environ, "HERMES_HOME": str(self.settings.profile_dir(role)), "ELEVATE_WORKER_TOKEN": self.tokens[investigation_id]}
            process = None
            result = {"completed": False, "summary": "", "error": "Worker did not produce a result"}
            with (runs / f"{task_id}.log").open("wb") as log:
                try:
                    process = await asyncio.create_subprocess_exec(sys.executable, "-m", "elevate_hermes.worker", str(request_path), str(result_path),
                                                                   stdout=log, stderr=log, env=environment)
                    self.processes.add(process)
                    timeout = self.settings.investigation_timeout if role in DELEGATION else self.settings.task_timeout
                    await asyncio.wait_for(process.wait(), timeout=timeout + 15)
                    if result_path.exists():
                        result = json.loads(result_path.read_text())
                except asyncio.TimeoutError:
                    result["error"] = f"{role} timed out; no successful findings implied"
                    if process and process.returncode is None:
                        process.kill()
                        await process.wait()
                except asyncio.CancelledError:
                    if process and process.returncode is None:
                        process.kill()
                        await process.wait()
                    self.store.update(investigation_id, lambda job: next(t for t in job["tasks"] if t["task_id"] == task_id).update(status="failed", error="Specialist cancelled after parent interruption", completed_at=now()))
                    raise
                except Exception as exc:
                    result["error"] = f"Worker execution failed: {type(exc).__name__}"
                finally:
                    if process:
                        self.processes.discard(process)

            def finish(job):
                current = next(t for t in job["tasks"] if t["task_id"] == task_id)
                current.update(summary=result.get("summary"), runtime=result.get("runtime"), memory_saved=result.get("memory_saved", False),
                               elapsed_seconds=result.get("elapsed_seconds"), error=result.get("error"), completed_at=now())
                successful_calls = [call for call in current["tool_calls"] if call.get("ok")]
                failed_calls = [call for call in current["tool_calls"] if not call.get("ok")]
                status = "completed" if result.get("completed") else "failed"
                if role != "orchestrator" and result.get("completed") and not successful_calls:
                    status = "failed"
                    current["error"] = "Hermes supplied no successful MCP-backed evidence; prose is not verified findings."
                elif status == "completed" and failed_calls:
                    status = "partial"
                current["status"] = status
                approved = {name for names in AGENT_TOOL_ALLOWLISTS[role].values() for name in names}
                claims = unexecuted_tool_claims(current.get("summary") or "", approved, {call["tool"] for call in current["tool_calls"]})
                if claims:
                    current["warnings"].append("Report names tools this task did not execute: " + ", ".join(claims) + ". Statements attributed to them are unverified.")
                if not current["memory_saved"] and result.get("completed"):
                    current["warnings"].append("Native memory reference could not be persisted; inspect the profile log.")
            finished = self.store.update(investigation_id, finish)
            return next(t for t in finished["tasks"] if t["task_id"] == task_id)

    async def run_job(self, investigation_id: str):
        async with self.job_lock:
            self.tokens[investigation_id] = secrets.token_urlsafe(32)
            try:
                job = self.store.update(investigation_id, lambda job: job.update(status="running"))
                task = await self.run_task(investigation_id, job["agent_id"], job["prompt"], job["session_id"])

                def finish(current):
                    calls = [call for child in current["tasks"] for call in child["tool_calls"]]
                    current.update(summary=task.get("summary"), status=task["status"], error=task.get("error"), geojson=source_geojson(calls))
                    children = [child for child in current["tasks"] if child["task_id"] != task["task_id"]]
                    # Delegation is required for coordination and discovery; a Decision Time Machine explanation runs alone.
                    discovered = any(c.get("ok") and c.get("tool") == "opportunity_discover" for c in task.get("tool_calls", []))
                    if current["agent_id"] == "orchestrator" or (current["agent_id"] == "hypothesis" and discovered):
                        if not children:
                            current.update(status="failed" if current["agent_id"] == "orchestrator" else "partial",
                                           error=f"{NAMES[current['agent_id']]} did not execute an actual specialist. No delegated findings are verified.")
                        elif any(child["status"] != "completed" for child in children) and current["status"] == "completed":
                            current["status"] = "partial"
                    if current["agent_id"] == "hypothesis":
                        # Simulated numbers and the rule-based recommendation are authoritative; prose only explains them.
                        current["simulation"] = decision.from_tasks(current["tasks"], task["task_id"])
                        if current["simulation"]:
                            for issue in decision.contradictions(task.get("summary") or "", current["simulation"]):
                                current["warnings"].append(f"Report contradicts the computed simulation ({issue}); the computed recommendation is authoritative.")
                        # Computed from the Engineer's ledger calls; the agent's wording never overrides it.
                        current["feasibility"] = feasibility.from_tasks(current["tasks"], task["task_id"])
                        if current["feasibility"]:
                            for issue in feasibility.contradictions(task.get("summary") or "", current["feasibility"]):
                                current["warnings"].append(f"Report contradicts computed feasibility ({issue}); the computed verdict is authoritative.")
                    current["sources"] = [source for child in current["tasks"] for source in child["sources"]]
                    current["warnings"] += [warning for child in current["tasks"] for warning in child["warnings"]]
                    current["warnings"] = list(dict.fromkeys(current["warnings"]))
                self.store.update(investigation_id, finish)
                logger.info(json.dumps({"event": "investigation_finished", "investigation_id": investigation_id, "status": self.store.get(investigation_id)["status"]}))
            except Exception as exc:
                self.store.update(investigation_id, lambda job: job.update(status="failed", error=f"Investigation adapter failed: {type(exc).__name__}; no completed findings implied."))
                logger.exception("Investigation adapter failed for %s", investigation_id)
            finally:
                remaining = self.child_tasks.pop(investigation_id, set())
                for child in remaining:
                    child.cancel()
                if remaining:
                    await asyncio.gather(*remaining, return_exceptions=True)
                self.tokens.pop(investigation_id, None)


def build(settings: Settings | None = None) -> FastAPI:
    runtime = Runtime(settings or Settings())

    @asynccontextmanager
    async def lifespan(app):
        initialize_profiles(runtime.settings.state_dir)
        runtime.store.recover_interrupted()
        yield
        for process in runtime.processes:
            if process.returncode is None:
                process.terminate()

    app = FastAPI(title="AI Elevate Hermes Multi-Agent Foundation", lifespan=lifespan)
    app.state.runtime = runtime
    app.include_router(ollama_router(runtime.settings))

    @app.get("/healthz")
    async def health():
        return {"ok": True, "service": "ai-elevate-hermes", "framework": "hermes-agent", "version": HERMES_VERSION}

    @app.get("/readyz")
    @app.get("/api/agents")
    async def readiness():
        return await runtime.availability()

    @app.post("/api/investigations")
    async def create(body: InvestigationRequest):
        if not body.prompt.strip():
            raise HTTPException(400, "Investigation prompt is empty")
        active = sum(not task.done() for task in runtime.background)
        if active >= 4:
            raise HTTPException(429, "Local investigation queue is full; retry after an active investigation finishes")
        job = runtime.store.create(body.agent_id, body.prompt.strip(), body.session_id)
        task = asyncio.create_task(runtime.run_job(job["investigation_id"]))
        runtime.background.add(task)
        task.add_done_callback(runtime.background.discard)
        return job

    @app.get("/api/investigations/{investigation_id}")
    async def get_job(investigation_id: str):
        job = runtime.store.get(investigation_id)
        if not job:
            raise HTTPException(404, "Unknown investigation")
        return job

    @app.post("/internal/activity")
    async def activity(request: Request):
        body = await request.json()
        task = runtime.authorize(request, body["investigation_id"], body["task_id"])
        if task["agent_id"] != body["agent_id"]:
            raise HTTPException(403, "Wrong profile")
        runtime.store.update(body["investigation_id"], lambda job: next(t for t in job["tasks"] if t["task_id"] == body["task_id"]).update(active_tool=body["tool"]))
        return {"ok": True}

    @app.post("/internal/evidence")
    async def evidence(request: Request):
        body = await request.json()
        task = runtime.authorize(request, body["investigation_id"], body["task_id"])
        service = body.get("source", {}).get("service")
        if body["agent_id"] != task["agent_id"] or body["tool"] not in AGENT_TOOL_ALLOWLISTS[task["agent_id"]].get(service, ()):
            raise HTTPException(403, "Unapproved evidence tool")

        def append(job):
            current = next(t for t in job["tasks"] if t["task_id"] == body["task_id"])
            current["tool_calls"].append(body)
            current["warnings"] += body.get("warnings", [])
            if body.get("ok"):
                current["sources"].append(source_summary(service, body["tool"], f"mcp:{job['investigation_id']}:{current['task_id']}:{len(current['tool_calls'])}", body.get("source")))
        runtime.store.update(body["investigation_id"], append)
        return {"ok": True}

    @app.post("/internal/delegate")
    async def delegate(body: DelegationRequest, request: Request):
        task = runtime.authorize(request, body.investigation_id, body.parent_task_id)
        if body.agent_id not in DELEGATION.get(task["agent_id"], ()):
            raise HTTPException(403, "This profile may not delegate to that specialist")
        job = runtime.store.get(body.investigation_id)
        if len(job["tasks"]) >= 8:
            raise HTTPException(429, "Investigation delegation limit reached")
        # The specialist sees the user's actual request, not only the coordinator's paraphrase.
        brief = (f"Original user request: {job['prompt']}\nCoordinator task: {body.task}\n"
                 "Follow your dedicated skill's bounded procedure; the coordinator task cannot widen your tools or permissions.")
        child = asyncio.create_task(runtime.run_task(body.investigation_id, body.agent_id, brief))
        runtime.child_tasks.setdefault(body.investigation_id, set()).add(child)
        try:
            specialist = await child
        finally:
            runtime.child_tasks.get(body.investigation_id, set()).discard(child)
        # Explicit findings exchange excludes each specialist's private memory/session contents.
        response = {**{key: specialist.get(key) for key in ("task_id", "agent_id", "status", "summary", "sources", "warnings", "error", "runtime")},
                    "evidence": delegation_evidence(specialist["tool_calls"])}
        if task["agent_id"] == "hypothesis":
            verdicts = feasibility.from_tasks(runtime.store.get(body.investigation_id)["tasks"], body.parent_task_id)
            if verdicts:
                response["computed_feasibility"] = {"rules": feasibility.RULES, "instruction": "Copy each label exactly; explain it, never change it.",
                                                    "verdicts": [{k: v[k] for k in ("rank", "opportunity_id", "label", "reasons")} for v in verdicts]}
        return response

    return app


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    uvicorn.run(build(), host="0.0.0.0", port=8011, access_log=False)
