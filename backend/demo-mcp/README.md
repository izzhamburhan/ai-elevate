# demo-mcp

Scenario clock and reset for the synthetic demo. Every other MCP reads "now" from the scenario clock, so moving it
lets slow things finish (a drone inspection, the 10 minutes to watch a tilt) without waiting.

| Tool | Does |
|---|---|
| `demo_get_clock` | Current scenario time (`t_min` since T0 and the timestamp) |
| `demo_advance_clock` | Moves the clock forward 1 to 1440 minutes |
| `demo_set_clock` | Sets the clock to a minute between -1440 and 4320 |
| `demo_reset` | Clears all runtime rows (incidents, approvals, RAN changes, ...) and resets the clock and policy defaults |

Run: `uv run python -m demo_mcp --transport streamable-http --port 8122` (or `python run_all.py demo`).
All data is synthetic. `demo_reset` is hidden from the chat agent by the frontend.
