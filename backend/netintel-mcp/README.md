# netintel-mcp

Network intelligence over the NetOps data. It has five read-only MCP tools:
- `investigate_customer_complaint`
- `analyze_network_congestion`
- `correlate_network_incidents`
- `assess_weather_network_exposure`
- `recommend_network_maintenance`

The tools read `backend/data/intel.duckdb`, a deterministic hourly extension of `netops.duckdb`. Weather values come from the local Weather ML service when it is running.

```bash
uv run python -m netintel_mcp.seed                                      # build backend/data/intel.duckdb (~30 s)
uv run python -m netintel_mcp --transport streamable-http --port 8125   # or: python run_all.py netintel
uv run pytest netintel-mcp
```

Contracts, data provenance, scenarios, Hermes mapping and validation are in [docs/AI_NETWORK_INTELLIGENCE.md](../../docs/AI_NETWORK_INTELLIGENCE.md). All network data is synthetic.