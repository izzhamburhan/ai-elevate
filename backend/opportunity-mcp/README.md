# opportunity-mcp

Telco Opportunity Graph (Order 4) on port **8127**. NetworkX graph over the existing `intel.duckdb` and `ml.duckdb` plus a small synthetic SME demand seed; ranks three explainable TM opportunities. Read-only, deterministic, all data synthetic.

```bash
uv run python -m opportunity_mcp.sme_seed                                   # regenerate src/opportunity_mcp/data/sme_demand.csv
uv run python -m opportunity_mcp --transport streamable-http --port 8127    # tools: opportunity_discover, opportunity_explain, opportunity_graph_summary
```

See [docs/TELCO_OPPORTUNITY_GRAPH.md](../../docs/TELCO_OPPORTUNITY_GRAPH.md).
