---
name: elevate-geographic-suitability
description: Compare actual available Malaysian geographic and synthetic telecom inventory for a limited commercial suitability recommendation without fabricating demand or revenue.
---

# Supported geographic analysis

1. Establish the requested city and practical criteria. For a Kuala Lumpur booth comparison, query `get_sites` with technology `4g`, region `Central`, and cluster `KLCC`, `Bukit Bintang` or `Bangsar`. Preserve returned IDs and WGS84 coordinates.
2. Use `get_site_info` for a selected returned site if additional inventory detail is useful. Inventory is synthetic telecom data, not live measured radio performance or customer demand.
3. The real place and boundary Parquet files are not installed in the current demo runtime. Call `search_locations`, `list_location_categories`, `list_admin_areas`, `lookup_admin_area` or `get_admin_boundary` only when the user explicitly asks for places, POIs or administrative boundaries; otherwise state that real place data was not used. If such a call reports missing Parquet data, keep the explicit failure and continue only with available evidence. Do not install or reset NetOps data from the agent.
4. Compare returned locations and inventory statuses. Clearly call network-based geographic suitability a limited assumption-based recommendation. Do not invent footfall, event attendance, crowd density, confirmed rents or validated revenue. Shared Weather Agent evidence must retain its historical replay or live label.
5. Return candidates with exact existing site IDs/coordinates, source references, missing commercial evidence, and practical next steps such as permission, cost and observed demand checks.
6. Keep only a concise recommendation reference and known assumptions in your private Hermes memory.

Future Footfall/Business ML integration may contribute a source-validated structured result later. This foundation does not implement those models or claim their predictions are available.
