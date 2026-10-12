"""Small durable investigation ledger; private Hermes memories remain in each native profile."""
from datetime import datetime, timezone
from contextlib import contextmanager
import json
import math
from pathlib import Path
import sqlite3
import threading
import uuid


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


class Store:
    def __init__(self, path: Path):
        self.path = path
        path.parent.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
        with self.connection() as db:
            db.execute("CREATE TABLE IF NOT EXISTS investigations (id TEXT PRIMARY KEY, payload TEXT NOT NULL)")

    @contextmanager
    def connection(self):
        db = sqlite3.connect(self.path, timeout=10)
        # Match Hermes's conservative mode on the pinned image's older SQLite.
        # Investigation volume is tiny; one writer lock is sufficient for this MVP.
        db.execute("PRAGMA journal_mode=DELETE")
        try:
            with db:
                yield db
        finally:
            db.close()

    def get(self, investigation_id: str) -> dict | None:
        with self.connection() as db:
            row = db.execute("SELECT payload FROM investigations WHERE id=?", (investigation_id,)).fetchone()
        return json.loads(row[0]) if row else None

    def save(self, job: dict):
        job["updated_at"] = now()
        with self.connection() as db:
            db.execute("INSERT OR REPLACE INTO investigations VALUES (?,?)", (job["investigation_id"], json.dumps(job)))

    def update(self, investigation_id: str, mutate):
        with self.lock:
            job = self.get(investigation_id)
            if job is None:
                raise KeyError("Unknown investigation")
            mutate(job)
            self.save(job)
            return job

    def create(self, agent_id: str, prompt: str, session_id: str | None = None) -> dict:
        investigation_id = uuid.uuid4().hex
        job = {"investigation_id": investigation_id, "agent_id": agent_id, "prompt": prompt,
               "session_id": session_id or uuid.uuid4().hex, "status": "queued", "created_at": now(), "updated_at": now(),
               "summary": None, "tasks": [], "sources": [], "warnings": [
                   "Experimental agent recommendations; telecom data is synthetic and Weather ML uses historical replay.",
                   "Network KPIs and weather valid times must be compared explicitly; geographic exposure does not establish outage causation."],
               "error": None, "geojson": None}
        self.save(job)
        return job

    def recover_interrupted(self):
        with self.connection() as db:
            jobs = [json.loads(row[0]) for row in db.execute("SELECT payload FROM investigations")]
        for job in jobs:
            if job["status"] in ("queued", "running"):
                job.update(status="failed", error="Service restarted during this investigation; submit again. No completion is implied.")
                for task in job["tasks"]:
                    if task["status"] in ("queued", "running"):
                        task.update(status="failed", error="Interrupted by service restart")
                self.save(job)


def source_geojson(evidence: list[dict]) -> dict | None:
    """Only factual tool coordinates can enter the map; LLM prose is never parsed for numbers."""
    features = {}
    for call in evidence:
        if not call.get("ok"):
            continue
        data = call.get("data", {})
        if not isinstance(data, dict):
            continue
        geo = data.get("geojson", {})
        for feature in geo.get("features", []) if isinstance(geo, dict) else []:
            geometry = feature.get("geometry", {})
            coordinates = geometry.get("coordinates", [])
            if geometry.get("type") != "Point" or len(coordinates) != 2:
                continue
            lon, lat = coordinates
            if isinstance(lon, bool) or isinstance(lat, bool) or not isinstance(lon, (int, float)) or not isinstance(lat, (int, float)) or not math.isfinite(lon) or not math.isfinite(lat) or not -180 <= lon <= 180 or not -90 <= lat <= 90:
                continue
            properties = dict(feature.get("properties", {}))
            properties["evidence_tool"] = call["tool"]
            properties["agent_id"] = call["agent_id"]
            key = (lon, lat, properties.get("site_id"), properties.get("kind"))
            features[key] = {"type": "Feature", "geometry": geometry, "properties": properties}
        # NetOps result structure is inspected rather than supplemented with invented geography.
        rows = next((data[k] for k in ("sites", "items", "results") if isinstance(data.get(k), list)), [])
        for row in rows:
            lon, lat = row.get("longitude", row.get("lng")), row.get("latitude", row.get("lat"))
            if isinstance(lon, bool) or isinstance(lat, bool) or not isinstance(lon, (int, float)) or not isinstance(lat, (int, float)) or not math.isfinite(lon) or not math.isfinite(lat) or not -180 <= lon <= 180 or not -90 <= lat <= 90:
                continue
            synthetic = bool(call.get("source", {}).get("synthetic", True))
            kind = "telecom_site" if synthetic else "geographic_location"
            props = {**row, "synthetic_network_data": synthetic, "kind": kind, "agent_id": call["agent_id"], "evidence_tool": call["tool"]}
            key = (lon, lat, props.get("site_id", props.get("id")), kind)
            features.setdefault(key, {"type": "Feature", "geometry": {"type": "Point", "coordinates": [lon, lat]}, "properties": props})
    return {"type": "FeatureCollection", "features": list(features.values())} if features else None
