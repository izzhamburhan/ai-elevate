# Order 5.5: Map-Aware Hermes Workspace

The **Agents** tab in the workspace side panel now connects the Kepler map to the Hermes agents. Kepler stays the main map, and the workspace layout is unchanged. Everything is a frontend change; the Hermes service, the agents, the models and the data are reused as they are.

**All telecom, commercial and demand data is synthetic.** The agents run on a local model through the existing Hermes service.

## What the Agents tab shows

1. **The five agents.** Orchestrator, Forecast, Engineer, Business and Hypothesis appear as collapsible cards. Each card shows:
   - a live availability dot, taken from Hermes `/api/agents`;
   - the agent's role;
   - whether it can be limited to a map area;
   - the tools Hermes actually registered for it;
   - its warnings and saved sessions.

   While an agent works, its card shows the tool it is using.
2. **Selected area.** Draw a polygon, rectangle or circle with Kepler's draw tool, or click a tower. The tab then fetches what the area holds from the existing MCP tools, through `/api/menara/call`. The blocks are labelled by kind:

   | Block | Source (MCP tool) | Label |
   |---|---|---|
   | NetOps sites in the area, congested cells and critical cells (last 7 days) | `mlpredict.predict_site_failure_risk` (site list), `netintel.analyze_network_congestion` | Synthetic |
   | Rainfall at the nearest station | `weather.weather_get_rainfall` | Synthetic weather |
   | Commercial demand: the area's demand signal, or the nearest one | `mlpredict.get_business_demand_signals` (`demand-signals-v1`) | ML predicted |
   | Outage risk for the next 24 h, and the weekend congestion forecast | `mlpredict.predict_site_failure_risk`, `mlpredict.forecast_network_congestion` | ML predicted |

   The tools search the circle around the area. For polygons and rectangles, sites and cells are then filtered to the drawn shape. If a block is unavailable, it says why; for example, when a running server is older than the tool. Predictions are labelled as separate from agent findings and as not validated by Hermes.
3. **Telco Opportunity Graph.** This is unchanged:
   - the instant graph ranking, labelled **Graph-ranked**;
   - live validation by the Hypothesis agent;
   - **Show last validated run**, with results labelled **Agent-validated** once Hermes has computed the verdicts.
4. **Ask an agent.** Pick one of the five agents. For agents that can be limited to an area (Orchestrator, Engineer, Forecast and Business), you can attach the selected area. Hypothesis reads the national graph, so the area is not attached and the form says why.
5. **Results.** These show the progress timeline, then three tabs:
   - **Summary:**
     - the area-scope verdict;
     - the executive summary, from the agent's own text;
     - KPI cards: risk, MCP calls and the sites in the evidence;
     - the agent's recommendation;
     - "Show findings on map".
   - **Evidence:** a table of site IDs, metrics, values, timestamps and the MCP source (tool, service, agent, synthetic flag). Rows come only from successful MCP calls recorded in the Hermes ledger. Click a row with a pin to highlight it on the map.
   - **Report:** findings per agent, methodology (agents, tools, sources, area scope, IDs and times), limitations (Hermes warnings) and next actions.
6. **Saved investigations.** The last eight runs are kept in this browser and reopen from the Hermes ledger. Each reopened run keeps its area, because the area is read back from the prompt.

## Map → Hermes, honestly

Hermes accepts only `{agent_id, prompt, session_id}`, and its API is not changed here. The selected area goes into the prompt as a structured block:

```
[MAP SELECTION - structured context; synthetic NetOps data]
{"kind":"rectangle","label":"Drawn Rectangle · 4 vertices · ~8.3 km²","center":{"lat":3.06576,"lng":101.52086},"radius_km":2.04,"bbox":[…],"site_ids":["CB5348","CB7552",…],"site_count":12}
Scope rule: query only these Site_IDs (site_id) or radius queries centred inside this area with radius <= 3 km. …
```

**The UI never claims that an agent analysed the area just because the area was sent.** After the run, `areaAdherence` checks the arguments of every successful tool call recorded in the ledger:
- **In the area:** the call named only the area's Site_IDs (`site_id`, `site`, `site_ids`), or it used a centre inside the area with a radius no larger than the area's radius plus 1 km.
- **Outside:** the call named a site outside the area, or searched a wider circle.
- **Unscoped:** the call used no location at all, for example a region or national query.

The verdicts are:

| Verdict | Meaning |
|---|---|
| `respected` | Every call stayed in the area. |
| `partly respected` | Some calls stayed in the area; the banner says the findings are not limited to it. |
| `not area-scoped` | No call stayed in the area; the banner says not to read the findings as an analysis of it. |
| `no tool calls` | Nothing was recorded, so nothing was analysed. |

## Map ↔ pane

- **Evidence → map:** clicking an evidence row adds one cyan highlight ring and flies the map to it. The location comes from:
  - the record's own coordinates;
  - the coordinates of an area site;
  - the run's GeoJSON.

  It is never inferred from prose.
- **Tower → pane:** pinning a tower's popover (or any agent or opportunity point) reports the point to the Agents tab. The tab then:
  - selects the 2 km around a tower as the area;
  - if a run is open, shows how many of its evidence rows lie within 1.5 km of the point or match its ID, and filters the Evidence tab to them.

  Menara towers (for example `PUCH-5061`) and NetOps sites (for example `CB8519`) are different synthetic inventories, so they are matched by distance.

## Files

| File | Purpose |
|---|---|
| `frontend/src/lib/hermes/workspace.ts` | area model, containment, prompt block, area-scope check, evidence rows, summary digest (pure, unit-tested) |
| `frontend/src/lib/hermes/area-insights.ts` | the area's network, weather, demand and prediction blocks from existing MCP tools |
| `frontend/src/lib/hermes/map-focus.ts` | the clicked-point store and the evidence highlight layer |
| `frontend/src/components/map/panels/agents-workspace.tsx` | agent roster, area card, results tabs, progress timeline, provenance chips |
| `frontend/src/components/map/panels/hermes-panel.tsx` | the Agents tab, wired together; keeps the Order 4 flow |
| `frontend/src/components/map/tower-popover.tsx` | reports a pinned point to the Agents tab |
| `frontend/tests/hermes-workspace.test.mjs` | 6 tests: areas, prompt block, call scope, verdicts, evidence and digest |

Not changed: the Hermes service and profiles, NetOps, the MCP servers, the models, the data, `/api/hermes`, `/api/menara/call`, and the overall workspace design.

## Running it

The frontend reaches the existing services:
- the Menara MCPs via `run_all.py`, with `--search`, the default;
- Hermes on 8011 (`hermes-multi-agent`: `docker compose -p ai-elevate-hermes up -d`, which uses local Ollama `qwen3.5:9b`);
- the Opportunity Graph on 8127.

`get_business_demand_signals` needs the MLPredict server from main after PR #13. If the running server is older, the demand block says so.

**Agent result labels:**
- **Hermes finding:** only on completed or partial runs.
- **Agent-validated:** only on a Hypothesis run with Hermes-computed verdicts.

**Summary risk** is computed from recorded data, never from agent prose. It comes from, in order:
1. Hermes feasibility verdicts;
2. mapped severities;
3. recorded `get_ran_kpi` values against the thresholds NetOps returned with them.

## Verification (2026-10-13, MacBook Apple Silicon)

| Check | Result |
|---|---|
| `npm run test:hermes` (9 new workspace tests; Order 4, 6 and 7 tests included) | PASS: 25 |
| `npm run test:weather`; `boundary-context.test.mjs` | PASS: 8; PASS: 2 |
| `npm run lint`, `npx tsc --noEmit`, `npm run build` | PASS (0 lint problems, 0 type errors) |
| Real Hermes run with an area attached: Engineer, `c462515a826b451dbd95e9b68a5db2e9`, drawn rectangle over Shah Alam (12 NetOps sites) | **completed**. 2 successful MCP calls: `get_ran_kpi` on exactly the 12 Site_IDs, and `get_ntt_tickets` within 3 km of a point inside the area. Area scope: **respected**. |
| Risk check on that run | medium: 1 of 36 KPI values breaches a NetOps threshold (CK9926 availability 99.41% < 99.5%, which the agent's prose called "a rounding artifact") |
| Earlier runs, recorded honestly in the UI | `b9a21672…` failed (`gemma4` did not call tools); `a50969a1…` failed (NetOps in `--search` mode exposed no tools to Hermes; the UI said "no tool calls, nothing analysed"); `14dcf23f…` failed (task timeout after 2 area-scoped calls; the UI showed the 13 recorded rows and "did not complete") |
| Opportunity Graph | graph-ranked cards in 0.8 s; Hypothesis validation `bd214774…` **completed** with Hermes-computed verdicts (screenshot 08) |
| Browser: draw a rectangle → area card filtered to the shape (12 sites; 11 congested, 8 critical cells) | PASS (screenshot 02) |
| Browser: click a tower → area becomes 2 km around it (GEOR-4130) | PASS (screenshot 07) |
| Browser: Summary, Evidence and Report tabs; reopen a saved investigation from the Hermes ledger | PASS (screenshots 03, 04) |
| Browser: click evidence row CK9926 → cyan ring and fly-to on its site (12 of 13 rows have a location; the 13th is the "0 NTT tickets" summary) | PASS (screenshot 05) |
| Browser: pin the CK9926 point on the map → pane shows "11 evidence rows from this run within 1.5 km" | PASS (screenshot 06) |
| No stale area data for a new selection | Results are keyed by the area. A reopened run reports against its own recorded area, read from its prompt, not the current selection. |
| No duplicate overlays | The highlight and findings layers replace their own dataset each time. |

## Known limitations and environment notes

- **Forecast agent unavailable.** Weather ML (`weather-ml-mcp`, port 8002) is not running here. Starting it needs an image build, the Chronos model bootstrap and an ERA5 ingest (see `weather-ml-mcp/README.md`); it is not a configuration fix. The roster shows Forecast as unavailable with Hermes's warning, and the form disables it. The existing Weather panel's 503 console errors come from the same missing service.
- **Hermes needs NetOps without `--search`.** Hermes discovers the real NetOps tool names over MCP. `run_all.py` starts NetOps with `--search` by default, which lists only `netops_search_tools`/`netops_call_tool`, so the Engineer gets no tools. For these checks, a second read-only NetOps instance ran on port 8010 without search, and Hermes was pointed at it with its existing env variable. No code or normal server configuration was changed:
  ```bash
  cd backend/netops-mcp && uv run python -m netops_mcp.server --http --host 0.0.0.0 --port 8010        # uses backend/netops-mcp/data
  cd hermes-multi-agent && NETOPS_MCP_URL=http://host.docker.internal:8010/mcp HERMES_TASK_TIMEOUT_SECONDS=900 \
    docker compose -p ai-elevate-hermes up -d --force-recreate
  ```
  Alternatively, run `python run_all.py --no-search` for the whole stack.
- **Local model speed.** With `qwen3.5:9b` on this Mac, an Engineer run took 70 s once the model was warm. One run hit the default 360 s task timeout, so the checks used `HERMES_TASK_TIMEOUT_SECONDS=900` (an existing env knob). The Hypothesis validation took about 12 minutes.
- **Area scope depends on the agent.** The agent decides which tools and dates to use. In the verified run it queried 2026-09-25, not the latest day; the Evidence tab shows that date as recorded. The scope check judges only what the calls actually did.
- **Demand signals** need the MLPredict server from main after PR #13. An older running server shows "not available on the running mlpredict server".
- **Reopened polygon runs** are checked against their recorded centre and radius (the prompt carries the bounding box, not the full ring).
- **Synthetic data everywhere:** NetOps, intel, ML, opportunity and commercial figures are labelled synthetic, ML predicted or graph-ranked in the UI.
