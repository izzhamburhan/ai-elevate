"""Read-only, profile-scoped access to the existing FastMCP services.

The gateway discovers the real registered schemas rather than maintaining an
invented copy. Allowlisting precedes both discovery and invocation. The NetOps
server also exposes write tools, so a tool name starting with ``get_`` is never
treated as permission by itself.
"""

from __future__ import annotations

import asyncio
import json
from datetime import UTC, datetime
from typing import Any
from urllib.parse import urlsplit, urlunsplit

from fastmcp import Client
from jsonschema import Draft202012Validator


WEATHER_READ_ONLY_TOOLS = frozenset(
    {
        "predict_rainfall",
        "predict_temperature",
        "predict_weather_for_sites",
        "get_weather_model_metrics",
        "get_weather_model_status",
        "get_weather_forecast_geojson",
    }
)

# These functions were reviewed in backend/netops-mcp/src/netops_mcp/tools.
# Ticket writes, subscriber-identifying tools, shell and arbitrary URLs are absent.
ENGINEER_NETOPS_TOOLS = frozenset(
    {
        "get_sites",
        "search_sites",
        "get_site_info",
        "get_site_cells",
        "get_ran_site_info",
        "get_ran_kpi",
        "get_ran_kpi_summary",
        "get_worst_cells",
        "get_congested_cells",
        "get_ntt_tickets",
        "get_ntt_summary",
        "get_coverage_layer",
        "get_plan_maintenance",
    }
)

BUSINESS_GEOGRAPHIC_TOOLS = frozenset(
    {
        "get_sites",
        "get_site_info",
        "search_locations",
        "list_location_categories",
        "lookup_admin_area",
        "list_admin_areas",
        "get_admin_boundary",
    }
)

# Order 4 Telco Opportunity Graph (backend/opportunity-mcp): read-only synthetic opportunity ranking.
OPPORTUNITY_TOOLS = frozenset({"opportunity_discover", "opportunity_explain", "opportunity_graph_summary", "opportunity_simulate",
                               "opportunity_revenue_leaks", "opportunity_absence_gaps", "opportunity_event_packages"})

AGENT_TOOL_ALLOWLISTS: dict[str, dict[str, frozenset[str]]] = {
    "orchestrator": {},  # Its delegation tools are registered by the coordinator.
    "forecast": {"weather": WEATHER_READ_ONLY_TOOLS},
    "business": {"netops": BUSINESS_GEOGRAPHIC_TOOLS},
    # Weather evidence comes only from Forecast, so the two roles cannot duplicate it.
    "engineer": {"netops": ENGINEER_NETOPS_TOOLS},
    # Network feasibility is validated by delegating to Engineer, not by direct NetOps access.
    "hypothesis": {"opportunity": OPPORTUNITY_TOOLS},
}

GEOGRAPHIC_NETOPS_TOOLS = frozenset(
    {
        "search_locations",
        "list_location_categories",
        "lookup_admin_area",
        "list_admin_areas",
        "get_admin_boundary",
    }
)


class MCPDiscoveryError(RuntimeError):
    """A configured MCP service could not provide its real tool catalog."""


def _mcp_url(url: str) -> str:
    """Accept a server-configured HTTP origin or MCP endpoint, never user credentials."""
    parts = urlsplit(url)
    if parts.scheme not in {"http", "https"} or not parts.hostname:
        raise ValueError("MCP configuration requires an HTTP(S) server URL")
    if parts.username or parts.password or parts.query or parts.fragment:
        raise ValueError("MCP configuration must not include credentials, query or fragment")
    path = parts.path.rstrip("/") or "/mcp"
    return urlunsplit((parts.scheme, parts.netloc, path, "", ""))


def _field(value: Any, snake: str, camel: str | None = None, default: Any = None) -> Any:
    if isinstance(value, dict):
        if snake in value:
            return value[snake]
        return value.get(camel, default) if camel else default
    if hasattr(value, snake):
        return getattr(value, snake)
    return getattr(value, camel, default) if camel else default


def _data(result: Any) -> Any:
    value = _field(result, "data")
    if value is not None:
        return value
    value = _field(result, "structured_content", "structuredContent")
    if value is not None:
        return value
    texts = [_field(block, "text") for block in _field(result, "content", default=[]) or []]
    texts = [item for item in texts if isinstance(item, str)]
    if len(texts) == 1:
        try:
            return json.loads(texts[0])
        except json.JSONDecodeError:
            return {"text": texts[0]}
    return {"content": texts}


def _provenance(service: str, tool_name: str, data: Any = None) -> dict[str, Any]:
    source: dict[str, Any] = {
        "service": service,
        "tool": tool_name,
        "retrieved_at": datetime.now(UTC).isoformat(),
        "transport": "MCP streamable HTTP",
        "read_only": True,
        "untrusted_tool_response": True,
    }
    if service == "netops":
        source["data_kind"] = "real_geographic_dataset" if tool_name in GEOGRAPHIC_NETOPS_TOOLS else "synthetic_telecom"
        source["synthetic"] = tool_name not in GEOGRAPHIC_NETOPS_TOOLS
    elif service == "opportunity":
        source["data_kind"] = "synthetic_opportunity_graph"
        source["synthetic"] = True
    elif service == "weather":
        source["data_kind"] = "local_ml_weather"
        source["synthetic"] = False
        if isinstance(data, dict):
            # Keep the model/data timing metadata from the existing weather service.
            for key in ("mode", "model", "source", "context_end", "forecast_start", "forecast_end", "generated_at"):
                if key in data:
                    source[key] = data[key]
    return source


class RestrictedMcpGateway:
    """Expose only reviewed tools, validating requests against the upstream schemas.

    ``base_urls`` is trusted deployment configuration with service keys
    ``weather`` and ``netops``. Agent-controlled requests cannot choose a URL.
    Clients are short-lived, avoiding shared MCP session state across profiles.
    """

    def __init__(self, base_urls: dict[str, str], timeout_seconds: float = 60):
        if set(base_urls) - {"weather", "netops", "opportunity"}:
            raise ValueError("Only the configured weather, netops and opportunity services are supported")
        if timeout_seconds <= 0:
            raise ValueError("timeout_seconds must be positive")
        self.base_urls = {service: _mcp_url(url) for service, url in base_urls.items()}
        self.timeout_seconds = timeout_seconds
        self._catalogs: dict[str, dict[str, dict[str, Any]]] = {}
        self._locks = {service: asyncio.Lock() for service in self.base_urls}

    async def _catalog(self, service: str) -> dict[str, dict[str, Any]]:
        if service not in self.base_urls:
            raise MCPDiscoveryError(f"MCP service '{service}' is not configured")
        async with self._locks[service]:
            if service in self._catalogs:
                return self._catalogs[service]
            try:
                async with asyncio.timeout(self.timeout_seconds):
                    async with Client(self.base_urls[service], timeout=self.timeout_seconds) as client:
                        tools = await client.list_tools()
                catalog = {}
                for tool in tools:
                    annotations = _field(tool, "annotations")
                    # An explicit destructive annotation can never override our policy.
                    if _field(annotations, "destructive_hint", "destructiveHint", False):
                        continue
                    name = _field(tool, "name")
                    schema = _field(tool, "input_schema", "inputSchema", {})
                    if not isinstance(name, str) or not isinstance(schema, dict):
                        continue
                    Draft202012Validator.check_schema(schema)
                    catalog[name] = {
                        "name": name,
                        "description": _field(tool, "description", default="") or "",
                        "input_schema": schema,
                        "service": service,
                        "read_only": True,
                    }
                self._catalogs[service] = catalog
                return catalog
            except Exception as exc:
                # Do not put server URLs, transport internals or credentials in agent messages.
                raise MCPDiscoveryError(f"MCP service '{service}' is unavailable ({type(exc).__name__})") from exc

    async def discover(self, agent_id: str) -> list[dict[str, Any]]:
        """Return actual schemas for this profile; raise explicit discovery failures."""
        if agent_id not in AGENT_TOOL_ALLOWLISTS:
            raise ValueError("Unknown Hermes agent profile")
        schemas = []
        for service, allowed in AGENT_TOOL_ALLOWLISTS[agent_id].items():
            catalog = await self._catalog(service)
            schemas.extend(catalog[name] for name in sorted(allowed) if name in catalog)
        return schemas

    async def call(self, agent_id: str, tool_name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        """Invoke one permitted tool and retain raw evidence and provenance.

        Denied tools never create a network connection. Failure responses carry
        no fabricated weather values, telemetry, specialist findings or geometry.
        """
        policy = AGENT_TOOL_ALLOWLISTS.get(agent_id)
        service = next((name for name, names in (policy or {}).items() if tool_name in names), None)
        if policy is None or service is None:
            return self._failure("PERMISSION_DENIED", "This agent cannot invoke this tool", tool_name=tool_name)
        source = _provenance(service, tool_name)
        if not isinstance(arguments, dict):
            return self._failure("INVALID_ARGUMENTS", "Tool arguments must be a JSON object", source)
        try:
            catalog = await self._catalog(service)
        except MCPDiscoveryError as exc:
            return self._failure("MCP_UNAVAILABLE", str(exc), source)
        spec = catalog.get(tool_name)
        if spec is None:
            return self._failure("TOOL_UNAVAILABLE", "The permitted tool is not registered by the MCP service", source)
        errors = sorted(Draft202012Validator(spec["input_schema"]).iter_errors(arguments), key=lambda error: str(error.path))
        if errors:
            return self._failure("INVALID_ARGUMENTS", errors[0].message, source)
        try:
            async with asyncio.timeout(self.timeout_seconds):
                async with Client(self.base_urls[service], timeout=self.timeout_seconds) as client:
                    result = await client.call_tool(tool_name, arguments)
            data = _data(result)
            source = _provenance(service, tool_name, data)
            if _field(result, "is_error", "isError", False) or (isinstance(data, dict) and data.get("ok") is False):
                error = data.get("error") if isinstance(data, dict) else None
                error = error if isinstance(error, dict) else {"code": "MCP_TOOL_ERROR", "message": "The MCP tool returned an error"}
                return {"ok": False, "data": data, "error": error, "warnings": [], "source": source}
            warnings = list(data.get("warnings", [])) if isinstance(data, dict) and isinstance(data.get("warnings"), list) else []
            if source.get("synthetic"):
                warnings.insert(0, "Telecom inventory, KPIs and incidents are synthetic hackathon records, not measured live telemetry.")
            return {"ok": True, "data": data, "error": None, "warnings": warnings, "source": source}
        except TimeoutError:
            return self._failure("MCP_TIMEOUT", "The MCP service exceeded the configured timeout", source)
        except Exception as exc:
            return self._failure("MCP_UNAVAILABLE", f"The MCP invocation failed ({type(exc).__name__})", source)

    @staticmethod
    def _failure(code: str, message: str, source: dict[str, Any] | None = None, *, tool_name: str | None = None) -> dict[str, Any]:
        return {
            "ok": False,
            "data": None,
            "error": {"code": code, "message": message},
            "warnings": [],
            "source": source or {"tool": tool_name, "read_only": True},
        }
