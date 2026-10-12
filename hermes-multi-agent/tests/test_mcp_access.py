"""Deterministic mock MCP protocol fixtures; these do not prove runtime inference."""

import asyncio
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from elevate_hermes.mcp_access import (
    AGENT_TOOL_ALLOWLISTS,
    MCPDiscoveryError,
    RestrictedMcpGateway,
    WEATHER_READ_ONLY_TOOLS,
)


SITES_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "technology": {"type": "string", "enum": ["4g", "5g"]},
        "page_size": {"type": "integer", "minimum": 1, "maximum": 1000},
    },
    "required": ["technology"],
}

MOCK_TOOLS = {
    "netops": [
        SimpleNamespace(name="get_sites", description="Mock synthetic site inventory", input_schema=SITES_SCHEMA, annotations=None),
        SimpleNamespace(name="search_locations", description="Mock optional real geography", input_schema={"type": "object"}, annotations=None),
        SimpleNamespace(name="delete_vip_ticket", description="Must never reach an agent", input_schema={"type": "object"}, annotations=None),
        SimpleNamespace(name="get_site_info", description="Explicitly destructive test tool", input_schema={"type": "object"}, annotations=SimpleNamespace(destructive_hint=True)),
    ],
    "weather": [
        SimpleNamespace(name="get_weather_model_status", description="Mock model status", input_schema={"type": "object", "additionalProperties": False, "properties": {}}, annotations=SimpleNamespace(destructive_hint=False)),
        SimpleNamespace(name="get_weather_forecast_geojson", description="Mock geometry", input_schema={"type": "object"}, annotations=SimpleNamespace(destructive_hint=False)),
    ],
}


class FakeMcpClient:
    opened = []
    called = []
    result = {"items": [{"site_id": "TEST_ONLY", "latitude": 3.1, "longitude": 101.6}]}
    fail = False
    delay = 0

    def __init__(self, url, timeout=None):
        self.url = url
        self.service = "weather" if "weather" in url else "netops"

    async def __aenter__(self):
        type(self).opened.append(self.url)
        if self.fail:
            raise ConnectionError("Mock service unavailable")
        return self

    async def __aexit__(self, *args):
        return False

    async def list_tools(self):
        return MOCK_TOOLS[self.service]

    async def call_tool(self, name, arguments):
        type(self).called.append((self.service, name, arguments))
        if self.delay:
            await asyncio.sleep(self.delay)
        return SimpleNamespace(data=type(self).result, is_error=False)


class McpAccessTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        FakeMcpClient.opened = []
        FakeMcpClient.called = []
        FakeMcpClient.fail = False
        FakeMcpClient.delay = 0
        FakeMcpClient.result = {"items": [{"site_id": "TEST_ONLY", "latitude": 3.1, "longitude": 101.6}]}
        self.patch = patch("elevate_hermes.mcp_access.Client", FakeMcpClient)
        self.patch.start()
        self.addCleanup(self.patch.stop)
        self.gateway = RestrictedMcpGateway({"netops": "http://netops.test:8000", "weather": "http://weather.test:8001/mcp"})

    async def test_discovery_preserves_real_schema_and_profile_scope(self):
        engineer = await self.gateway.discover("engineer")
        self.assertEqual({tool["name"] for tool in engineer}, {"get_sites"})
        self.assertEqual({tool["service"] for tool in engineer}, {"netops"})
        self.assertEqual(next(tool for tool in engineer if tool["name"] == "get_sites")["input_schema"], SITES_SCHEMA)
        forecast = await self.gateway.discover("forecast")
        self.assertEqual({tool["service"] for tool in forecast}, {"weather"})
        self.assertEqual(await self.gateway.discover("orchestrator"), [])

    async def test_write_and_cross_profile_tools_denied_before_connection(self):
        for profile, tool in [("engineer", "delete_vip_ticket"), ("engineer", "predict_weather_for_sites"), ("hypothesis", "get_ran_kpi"), ("hypothesis", "predict_rainfall"), ("engineer", "opportunity_discover"), ("forecast", "get_sites"), ("business", "predict_rainfall"), ("orchestrator", "get_sites"), ("unknown", "get_sites")]:
            response = await self.gateway.call(profile, tool, {})
            self.assertFalse(response["ok"])
            self.assertEqual(response["error"]["code"], "PERMISSION_DENIED")
            self.assertIsNone(response["data"])
        self.assertEqual(FakeMcpClient.opened, [])
        self.assertEqual(FakeMcpClient.called, [])

    async def test_arguments_validated_against_registered_schema(self):
        for arguments in [{}, {"technology": "2g"}, {"technology": "4g", "page_size": 0}, {"technology": "4g", "shell": "forbidden"}, []]:
            response = await self.gateway.call("engineer", "get_sites", arguments)
            self.assertEqual(response["error"]["code"], "INVALID_ARGUMENTS")
        self.assertEqual(FakeMcpClient.called, [])

    async def test_synthetic_records_and_coordinates_retained_with_label(self):
        response = await self.gateway.call("business", "get_sites", {"technology": "4g", "page_size": 2})
        self.assertTrue(response["ok"])
        self.assertEqual(response["data"], FakeMcpClient.result)
        self.assertTrue(response["source"]["synthetic"])
        self.assertEqual(response["source"]["data_kind"], "synthetic_telecom")
        self.assertTrue(response["warnings"])
        self.assertTrue(response["source"]["untrusted_tool_response"])

    async def test_real_geographic_tools_labeled_separately(self):
        response = await self.gateway.call("business", "search_locations", {"query": "fixture-only"})
        self.assertTrue(response["ok"])
        self.assertFalse(response["source"]["synthetic"])
        self.assertEqual(response["source"]["data_kind"], "real_geographic_dataset")

    async def test_weather_replay_provenance_and_valid_geojson_retained(self):
        FakeMcpClient.result = {
            "ok": True,
            "mode": "replay",
            "model": {"id": "mock-only-not-real-inference"},
            "forecast_start": "2026-09-26T00:00:00Z",
            "warnings": ["Deterministic mock fixture; not an observed weather record"],
            "geojson": {"type": "FeatureCollection", "features": [{"type": "Feature", "geometry": {"type": "Point", "coordinates": [101.6, 3.1]}, "properties": {"fixture": True}}]},
        }
        response = await self.gateway.call("forecast", "get_weather_forecast_geojson", {"region": "all", "horizon_hours": 6})
        self.assertTrue(response["ok"])
        self.assertEqual(response["source"]["mode"], "replay")
        self.assertEqual(response["data"]["geojson"], FakeMcpClient.result["geojson"])
        self.assertEqual(response["warnings"], FakeMcpClient.result["warnings"])

    async def test_unavailable_service_has_no_fabricated_evidence(self):
        FakeMcpClient.fail = True
        response = await self.gateway.call("forecast", "get_weather_model_status", {})
        self.assertFalse(response["ok"])
        self.assertEqual(response["error"]["code"], "MCP_UNAVAILABLE")
        self.assertIsNone(response["data"])
        with self.assertRaises(MCPDiscoveryError):
            await self.gateway.discover("forecast")

    async def test_missing_and_destructively_annotated_tools_are_unavailable(self):
        for tool in ["get_ran_kpi", "get_site_info"]:
            response = await self.gateway.call("engineer", tool, {})
            self.assertEqual(response["error"]["code"], "TOOL_UNAVAILABLE")
        self.assertEqual(FakeMcpClient.called, [])

    async def test_upstream_error_is_explicit_without_fake_fallback(self):
        FakeMcpClient.result = {"ok": False, "error": {"code": "upstream_error", "message": "Mock optional dataset missing"}}
        response = await self.gateway.call("business", "search_locations", {})
        self.assertFalse(response["ok"])
        self.assertEqual(response["error"]["code"], "upstream_error")
        self.assertEqual(response["data"], FakeMcpClient.result)

    async def test_timeout_is_explicit(self):
        FakeMcpClient.delay = 0.03
        gateway = RestrictedMcpGateway({"netops": "http://netops.test:8000"}, timeout_seconds=0.001)
        response = await gateway.call("engineer", "get_sites", {"technology": "4g"})
        self.assertEqual(response["error"]["code"], "MCP_TIMEOUT")
        self.assertIsNone(response["data"])

    def test_hypothesis_reads_only_the_opportunity_graph(self):
        self.assertEqual(set(AGENT_TOOL_ALLOWLISTS["hypothesis"]), {"opportunity"})
        self.assertTrue(all(name.startswith("opportunity_") for name in AGENT_TOOL_ALLOWLISTS["hypothesis"]["opportunity"]))

    def test_policy_does_not_grant_by_name_prefix(self):
        self.assertEqual(AGENT_TOOL_ALLOWLISTS["forecast"]["weather"], WEATHER_READ_ONLY_TOOLS)
        self.assertNotIn("get_subscriber_profile", AGENT_TOOL_ALLOWLISTS["engineer"]["netops"])
        self.assertFalse(AGENT_TOOL_ALLOWLISTS["orchestrator"])

    def test_configured_urls_cannot_include_credentials_or_arbitrary_service(self):
        for urls in [{"shell": "http://netops.test"}, {"netops": "file:///tmp/test"}, {"netops": "http://user:secret@netops.test"}, {"netops": "http://netops.test/mcp?secret=test"}]:
            with self.assertRaises(ValueError):
                RestrictedMcpGateway(urls)


if __name__ == "__main__":
    unittest.main()
