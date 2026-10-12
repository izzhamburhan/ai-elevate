from dataclasses import dataclass
import os
from pathlib import Path

AGENTS = ("orchestrator", "forecast", "business", "engineer", "hypothesis")
NAMES = {"orchestrator": "Orchestrator", "forecast": "Forecast", "business": "Business", "engineer": "Engineer", "hypothesis": "Business Hypothesis"}
# Which specialists each coordinating profile may start; nobody else can delegate.
DELEGATION = {"orchestrator": ("forecast", "engineer", "business"), "hypothesis": ("engineer",)}


@dataclass(frozen=True)
class Settings:
    state_dir: Path = Path(os.environ.get("HERMES_STATE_DIR", "/state"))
    ollama_url: str = os.environ.get("HERMES_OLLAMA_BASE_URL", "http://host.docker.internal:11434/v1").removesuffix("/v1")
    model: str = os.environ.get("HERMES_MODEL", "qwen3.5:9b")
    weather_url: str = os.environ.get("WEATHER_MCP_URL", "http://host.docker.internal:8002/mcp").removesuffix("/mcp")
    netops_url: str = os.environ.get("NETOPS_MCP_URL", "http://host.docker.internal:8000/mcp").removesuffix("/mcp")
    opportunity_url: str = os.environ.get("OPPORTUNITY_MCP_URL", "http://host.docker.internal:8127/mcp").removesuffix("/mcp")
    internal_url: str = os.environ.get("HERMES_INTERNAL_URL", "http://127.0.0.1:8011")
    task_timeout: int = int(os.environ.get("HERMES_TASK_TIMEOUT_SECONDS", "360"))
    investigation_timeout: int = int(os.environ.get("HERMES_INVESTIGATION_TIMEOUT_SECONDS", "1080"))
    max_iterations: int = int(os.environ.get("HERMES_MAX_ITERATIONS", "8"))

    def profile_dir(self, agent_id: str) -> Path:
        if agent_id not in AGENTS:
            raise ValueError("Unknown agent profile")
        return self.state_dir / "profiles" / agent_id

