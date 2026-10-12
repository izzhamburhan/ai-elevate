"""Reproducibly initialize four real Hermes profiles without erasing their state.

Profile creation uses the pinned Hermes implementation. Private memories and
sessions are preserved on subsequent starts. SOUL, dedicated skills and
configuration are deployment-managed and refreshed from repository templates.
"""

from __future__ import annotations

import json
import os
import shutil
from pathlib import Path
from typing import Any


HERMES_REVISION = "71d34bad1045610252eda02ee79549436896e784"
HERMES_VERSION = "0.21.7"
AGENT_IDS = ("orchestrator", "forecast", "business", "engineer")


def _copy_missing(source: Path, destination: Path) -> None:
    if source.is_dir():
        destination.mkdir(parents=True, exist_ok=True)
        for child in source.iterdir():
            _copy_missing(child, destination / child.name)
    elif not destination.exists():
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, destination)


def initialize_profiles(
    state_dir: str | Path | None = None,
    templates_dir: str | Path | None = None,
) -> list[dict[str, Any]]:
    """Create native profiles once, seed absent files, and return identity evidence.

    Run once in the API process before spawning workers. Each worker must set
    its own HERMES_HOME before importing Hermes and serialize its profile turns.
    """
    state = Path(state_dir or os.environ.get("HERMES_STATE_DIR", "/state")).resolve()
    templates = Path(
        templates_dir or os.environ.get("HERMES_PROFILE_TEMPLATES", "/app/profiles")
    ).resolve()
    state.mkdir(parents=True, exist_ok=True)
    os.environ["HERMES_HOME"] = str(state)

    from hermes_cli.profiles import create_profile
    from hermes_yaml import safe_dump, safe_load

    context_length = int(os.environ.get("HERMES_CONTEXT_LENGTH", "65536"))
    if context_length < 64000 or context_length > 262144:
        raise ValueError("HERMES_CONTEXT_LENGTH must be between 64000 and 262144")
    model = os.environ.get("HERMES_MODEL", "qwen3.5:9b")
    base_url = os.environ.get(
        "HERMES_OLLAMA_BASE_URL", "http://host.docker.internal:11434/v1"
    ).rstrip("/")
    result: list[dict[str, Any]] = []
    for role in AGENT_IDS:
        template = templates / role
        if not (template / "SOUL.md").is_file():
            raise FileNotFoundError(f"Missing committed SOUL template for {role}")
        profile = state / "profiles" / role
        if not profile.exists():
            profile = create_profile(
                role, no_alias=True, no_skills=True,
                description=f"AI Elevate {role} agent; isolated local investigation profile",
            )
        # SOUL and dedicated skills are the committed role identity, so every
        # start deploys them. Private memories and sessions are only seeded.
        shutil.copyfile(template / "SOUL.md", profile / "SOUL.md")
        for skill in (template / "skills").iterdir():
            shutil.copytree(skill, profile / "skills" / skill.name, dirs_exist_ok=True)
        _copy_missing(template / "memories", profile / "memories")
        config = safe_load((template / "config.yaml").read_text(encoding="utf-8")) or {}
        config["model"] = {
            "default": model, "provider": "custom", "base_url": base_url,
            "context_length": context_length, "ollama_num_ctx": context_length,
        }
        role_tools = (
            "ai_elevate_coordination" if role == "orchestrator" else "ai_elevate_mcp"
        )
        config["agent"] = {
            "max_iterations": int(os.environ.get("HERMES_MAX_ITERATIONS", "8")),
            "reasoning_effort": "none",
            "disabled_toolsets": ["terminal", "file", "browser", "web", "cronjob", "delegation"],
        }
        # Current Hermes uses platform_toolsets; the old top-level toolsets
        # setting is deprecated. The worker also passes this exact selection
        # to AIAgent so startup cannot silently enable the default bundle.
        config["platform_toolsets"] = {
            "cli": ["memory", "ai_elevate_skills", role_tools],
            "api_server": ["memory", "ai_elevate_skills", role_tools],
        }
        config["mcp_servers"] = {}  # The validated gateway registers approved tools.
        # Hermes otherwise replaces sufficiently large custom tool catalogs
        # with tool_search/tool_describe/tool_call. Keep the explicit schemas
        # so the worker can enforce its exact role allowlist before inference.
        config.setdefault("tools", {}).setdefault("tool_search", {})["enabled"] = "off"
        config["skills"] = {"write_approval": True, "external_dirs": []}
        config["memory"]["write_approval"] = False
        (profile / "config.yaml").write_text(safe_dump(config), encoding="utf-8")
        (profile / "deployment.json").write_text(
            json.dumps({"agent_id": role, "hermes_version": HERMES_VERSION,
                        "hermes_revision": HERMES_REVISION}, indent=2) + "\n",
            encoding="utf-8",
        )
        result.append({
            "agent_id": role,
            "home": str(profile),
            "soul_loaded": bool((profile / "SOUL.md").read_text(encoding="utf-8").strip()),
            "skills": sorted(p.parent.name for p in (profile / "skills").rglob("SKILL.md")),
            "memory_file": str(profile / "memories" / "MEMORY.md"),
            "session_database": str(profile / "state.db"),
        })
    return result


if __name__ == "__main__":
    print(json.dumps(initialize_profiles(), indent=2))
