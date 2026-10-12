# mlpredict-mcp

Local ML predictions (LightGBM and an Isolation Forest, on CPU) with eight read-only MCP tools on port 8126:
- `predict_area_footfall`
- `rank_business_locations`
- `predict_site_failure_risk`
- `forecast_network_congestion`
- `detect_network_anomalies`
- `get_business_demand_signals` (combines the models per area; the Opportunity Graph contract)
- `get_ml_model_metrics`
- `get_ml_model_status`

```bash
uv run python -m netintel_mcp.seed && uv run python -m mlpredict_mcp.data && uv run python -m mlpredict_mcp.train
uv run python -m mlpredict_mcp --transport streamable-http --port 8126     # or: python run_all.py mlpredict
uv run pytest mlpredict-mcp
```

To run it in a container (Docker or Podman; needed on a Mac without Homebrew `libomp`), see `Containerfile` and `compose.yaml`.

Live demo over MCP (Analyze Network, Predict Future Risk, Identify Demand, Recommend Areas): `uv run python -m mlpredict_mcp.demo`. See [docs/ORDER5_PREDICTIVE_INTELLIGENCE.md](../../docs/ORDER5_PREDICTIVE_INTELLIGENCE.md).

Data, models, metrics, licences and limitations are documented in [docs/PREDICTIVE_ML_ECOSYSTEM.md](../../docs/PREDICTIVE_ML_ECOSYSTEM.md). All data is synthetic, and every metric is a synthetic benchmark.