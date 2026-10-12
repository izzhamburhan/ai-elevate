# MINDS × kepler.gl — Map Visualization Use Cases

Use cases for the Elevate map workspace (kepler.gl + AI assistant). Each one is a question
a user asks in the chat. The assistant answers it by calling MINDS MCP tools (see
`MINDS_MCP_TOOLS.md`) and drawing the result as one or more kepler.gl layers.

The list covers all 16 layer types in the
[kepler.gl layer guide](https://docs.kepler.gl/docs/user-guides/c-types-of-layers).

**Status legend**

| Status | Meaning |
|---|---|
| ✅ Ready | The existing MCP tools return everything the layer needs. |
| 🟡 Partial | The data exists, but needs a join, client-side conversion, or looping over calls. |
| 🔴 New data | Needs a new data source or endpoint that MINDS does not have yet. |

---

## 1. Coverage matrix

| Layer | Use cases | Best status |
|---|---|---|
| Point | UC-01, UC-02, UC-03, UC-04 | ✅ |
| Arc | UC-05, UC-06 | 🟡 |
| Line | UC-07, UC-08, UC-09 | 🟡 |
| Hexbin | UC-10, UC-11 | ✅ |
| Heatmap | UC-12, UC-13 | ✅ |
| Cluster | UC-14, UC-15 | ✅ |
| Icon | UC-16, UC-17 | ✅ |
| Grid | UC-18, UC-19 | 🟡 |
| GeoJSON | UC-20 – UC-24 | ✅ |
| H3 | UC-25, UC-26 | 🟡 |
| S2 | UC-27 | 🟡 |
| Vector Tile | UC-28 | 🔴 |
| Raster Tile | UC-29 | 🔴 |
| WMS | UC-30 | 🔴 |
| Flow | UC-31, UC-32 | 🟡 |
| 3D Tile | UC-33 | 🔴 |

---

## 2. Use cases by layer

### Point layer
*Needs: lat/lng per row.*

#### UC-01 — Track one IMSI's movement over a week (headline use case)
- **Prompt:** "Show me where IMSI 502xxxxxxxxxxxx went from 1 to 7 Oct."
- **Tools:** `get_visited_sites(imsi, start_date, end_date)` returns the sites visited. Call
  `get_site_info` for any site that comes back without coordinates. Add
  `get_subscriber_activity(type=signal_strength)` to get the RSRP at each stop.
- **Layers:**
  - Point: one dot per visited site. Colour = day of week. Size = time spent there (online time).
  - Line (UC-07): joins the stops in time order.
  - Time filter on the visit timestamp, with **playback** so the user can watch the week unfold.
- **Insight:** Daily routine, places the subscriber keeps returning to, and stops where the
  signal was poor. Useful for investigating a complaint ("my signal drops every evening").
- **Status:** 🟡. The portal's visited-sites response has `site_id`, `bearer_cell`,
  `cluster`, `signal_type` and `cell_technology`, but no time per visit. **Workaround:** call
  the tool once per day (`start_date = end_date`) to get day-level steps. Hour-level playback
  needs the endpoint to return a time for each visit.

#### UC-02 — National site inventory by technology
- **Prompt:** "Plot all 5G and MOCN sites in the Central region."
- **Tools:** `get_sites(technology, region)`, paging through all results.
- **Layer:** Point. Colour = technology. A filter on region and cluster.
- **Status:** ✅

#### UC-03 — Network trouble tickets on the map
- **Prompt:** "Show open 4G NTTs within 5 km of me."
- **Tools:** `get_ntt_tickets(technology, status, radius, current_lat, current_long)`.
- **Layer:** Point. Colour = ticket status. Tooltip = site ID, open date and fault.
- **Status:** ✅

#### UC-04 — A subscriber's signal-strength samples
- **Prompt:** "Plot this subscriber's RSRP readings for last week."
- **Tools:** `get_subscriber_activity(type=signal_strength, imsi, …)`.
- **Layer:** Point. Colour on the standard RSRP bands (Good / Fair / Poor).
- **Status:** 🟡. If the samples carry a site ID rather than coordinates, join them to site
  locations first.

---

### Arc layer
*Needs: two lat/lng pairs per row, drawn as 3D arcs.*

#### UC-05 — A subscriber's home and work anchors
- **Prompt:** "Where does this subscriber live and work?"
- **Tools:** `get_nba_visited_sites(msisdn, rank_by_online_time=true)`. Take the top two
  sites, then split the visits into night-time (home) and daytime (work).
- **Layer:** Arc from home to work. Width = number of days the commute was seen.
- **Status:** 🟡. Needs time-of-day per visit (see UC-01).

#### UC-06 — Subscribers served by a far-away site
- **Prompt:** "Is this subscriber being served by the right site?"
- **Tools:** `get_nba_nearest_site` and `get_nba_network_connection` (the serving cell), or
  `get_best_server(lat, lng)`.
- **Layer:** Arc from the subscriber's location to the serving site. Colour = distance. A
  second arc to the nearest site lets the user compare the two.
- **Insight:** Shows overshooting cells and coverage gaps that a neighbouring site is filling.
- **Status:** 🟡

---

### Line layer
*Needs: two lat/lng pairs per row, drawn as flat 2D lines.*

#### UC-07 — Hop-by-hop path for one IMSI
- Draws the line part of UC-01: one segment per pair of consecutive visited sites. Colour =
  time of day. Width = time spent at the next stop.
- **Status:** 🟡 (same limitation as UC-01)

#### UC-08 — BIN to its top 5 serving cells
- **Prompt:** "Which cells serve BIN-12345?"
- **Tools:** `get_bin_info(section=top_cells | serving_cell, grid_id)`, then
  `get_cell_details` to get each cell's coordinates.
- **Layer:** Lines from the BIN centroid to each cell. Width = rank. Colour = RSRP.
- **Insight:** Spots cells serving far outside their intended area.
- **Status:** 🟡

#### UC-09 — BIN neighbour relations
- Same pattern as UC-08, using `get_bin_info(section=neighbouring_cells)`.
- **Status:** 🟡

---

### Hexbin layer
*Needs: lat/lng. Points are grouped into hexagons; colour and height show the totals.*

#### UC-10 — Congestion hotspots nationwide
- **Prompt:** "Where is 4G congestion concentrated?"
- **Tools:** `get_congested_cells(technology=4g)`.
- **Layer:** Hexbin. Height = number of congested cells. Colour = average utilisation.
- **Status:** ✅

#### UC-11 — Trouble ticket density by area
- **Tools:** `get_ntt_tickets`, all statuses, for a date range.
- **Layer:** Hexbin of open NTTs. Compare two date ranges side by side to see whether
  hotspots are clearing.
- **Status:** ✅

---

### Heatmap layer
*Needs: lat/lng, plus an optional weight per point.*

#### UC-12 — RF quality heatmap (RSRP / RSRQ / throughput)
- **Prompt:** "Show a weekly average RSRP heatmap around KLCC."
- **Tools:** `get_bin_kpi_values(kpi, observation_duration, calculation_type, center, radius)`.
- **Layer:** Heatmap. Weight = how poor the KPI is (weaker signal = hotter). This matches
  the portal's existing BIN heat map.
- **Status:** ✅

#### UC-13 — Speed-test experience heatmap
- **Tools:** `get_site_speedtest(site_id, date)` for every site in the area.
- **Layer:** Heatmap. Weight = 1 / download speed, so slow areas glow.
- **Status:** 🟡. One call per site; a bulk endpoint would make this fast.

---

### Cluster layer
*Needs: lat/lng. Nearby points merge into one bubble that splits apart as you zoom in.*

#### UC-14 — Planned maintenance
- **Prompt:** "What maintenance is planned this week?"
- **Tools:** `get_plan_maintenance`, `get_plan_maintenance_summary`.
- **Layer:** Cluster. Zoom out for regional counts; zoom in to see individual sites.
- **Status:** ✅

#### UC-15 — Points of interest and properties inside BINs
- **Tools:** `get_bin_places(type=poi | property, grid_id)`.
- **Layer:** Cluster. Shows how many buildings or businesses a poor BIN affects.
- **Status:** ✅

---

### Icon layer
*Needs: lat/lng plus a category field that picks the icon.*

#### UC-16 — Network status board
- **Prompt:** "Show me network status in Johor."
- **Tools:** `get_sites`, `get_ntt_tickets`, `get_plan_maintenance`, `get_congested_cells`.
- **Layer:** Icon. Tower icons for 4G, 5G, MOCN, HWC and AOP sites, overlaid with ⚠ for an
  open NTT, 🔧 for maintenance and 🔥 for a congested site.
- **Status:** ✅

#### UC-17 — Subscriber advisory context map
- **Prompt:** "Why is this customer complaining?"
- **Tools:** `get_mobile_dashboard_advisory(imsi)`, `get_nba_nearest_site`,
  `get_nba_site_related`.
- **Layer:** Icon. Pins for the subscriber, their serving site, their nearest site, and any
  nearby site with an NTT or maintenance. This is the map version of the portal's mobile
  advisory screen.
- **Status:** ✅

---

### Grid layer
*Needs: lat/lng. Points are counted into square cells.*

#### UC-18 — Coverage gaps from site density
- **Prompt:** "Where do we have the fewest 5G sites per km²?"
- **Tools:** `get_sites(technology=5g)`, all pages.
- **Layer:** Grid. Cell size about 2 km; colour = site count. Overlay the 5G coverage layer
  (UC-22) to confirm the gaps.
- **Status:** ✅

#### UC-19 — Worst-cell concentration
- **Tools:** `get_worst_cells(scope=national, technology)`, then `get_ran_site_info` for
  each site's coordinates.
- **Layer:** Grid. Colour = number of worst cells.
- **Status:** 🟡. Needs the coordinate join.

---

### GeoJSON layer
*Needs: GeoJSON geometry (points, paths or polygons).*

#### UC-20 — BIN choropleth
- **Prompt:** "Colour the BINs in Petaling Jaya by throughput."
- **Tools:** `get_bin_polygons(layer=bin_border)` joined on `grid_id` to
  `get_bin_kpi_values(kpi=throughput)`.
- **Layer:** GeoJSON polygons. Fill = KPI value; optional 3D height = traffic.
- **Status:** ✅

#### UC-21 — HWC clover and TM cluster boundaries
- **Tools:** `get_bin_polygons(layer=hwc_clover | tm_cluster)`.
- **Layer:** GeoJSON outlines, used as a backdrop under the other layers.
- **Status:** ✅

#### UC-22 — Coverage and congestion, week against week
- **Prompt:** "Compare FDD coverage this week with four weeks ago."
- **Tools:** `get_coverage_layer(technology, week)` and `get_congestion_layer(duplex, week)`.
  The response includes `available_weeks`, which feeds a week picker.
- **Layer:** Two GeoJSON layers in split-map mode.
- **Status:** ✅

#### UC-23 — Analyse an area the user draws
- **Prompt:** The user draws a polygon, then asks "What's the RF quality inside this area?"
- **Tools:** `get_bins_in_area(mode=polygon, polygon)`.
- **Layer:** The drawn polygon, with the BINs inside it styled by KPI. The assistant also
  writes a short summary in the chat.
- **Status:** ✅

#### UC-24 — Animated trip for one IMSI
- An upgrade to UC-01: build a GeoJSON LineString whose points carry timestamps
  `[lng, lat, 0, unix_ts]`. kepler.gl then animates it as a moving trail.
- **Status:** 🟡. Needs a time per visit (see UC-01).

---

### H3 layer
*Needs: an H3 hexagon ID column.*

#### UC-25 — National KPI on a uniform hexagon grid
- Convert each BIN centroid from `get_bin_kpi_values` to an H3 ID (resolution 8 or 9) in the
  browser with `h3-js`, then average per hexagon.
- **Layer:** H3. Every region is drawn on the same grid, so regions are directly comparable,
  and the view can switch resolution with zoom.
- **Status:** 🟡. Conversion happens client-side.

#### UC-26 — A subscriber's monthly footprint
- **Prompt:** "Where has this subscriber spent time over the last 30 days?"
- **Tools:** `get_nba_visited_sites` and `get_nba_historical_days`. Convert each site to an H3
  ID.
- **Layer:** H3. Colour = number of distinct days seen in each hexagon.
- **Status:** 🟡

---

### S2 layer
*Needs: an S2 token column.*

#### UC-27 — Site service areas on S2 cells
- Convert site coordinates to level-13 S2 tokens and aggregate traffic or tickets per cell.
  This mainly serves teams already using S2 indexing, such as Google-based partner data.
  For internal use, H3 (UC-25) is the better choice.
- **Status:** 🟡. No native S2 data; conversion happens client-side.

---

### Vector Tile layer
*Needs: MVT or PMTiles URLs.*

#### UC-28 — Full-country BIN grid without paging
- Export the national BIN grid with its KPIs to PMTiles every week and serve it as one tile
  layer. Today, `get_bin_kpi_values` and `get_bin_polygons` page by bounding box, which is
  slow at national zoom.
- **Status:** 🔴. Needs a tile export pipeline (for example tippecanoe) and somewhere to host
  the tiles.

---

### Raster Tile layer
*Needs: PMTiles or a Cloud-Optimised GeoTIFF (COG) with STAC metadata.*

#### UC-29 — Terrain and planned-coverage backdrop
- Lay a digital elevation model or satellite image under the coverage layer to explain holes
  caused by hills or valleys. Planning-tool coverage predictions (for example from Atoll)
  exported as COG can be shown against measured BIN RSRP.
- **Status:** 🔴. External imagery or planning exports are needed.

---

### WMS layer
*Needs: the URL of an OGC Web Map Service.*

#### UC-30 — Government and land-use overlays
- Add a WMS feed for land use, population density, roads or new developments. This helps
  prioritise sites, for example a new township with no coverage.
- **Status:** 🔴. Needs an approved WMS source.

---

### Flow layer
*Needs: origin/destination pairs (lat/lng or H3) with an optional count.*

#### UC-31 — Commuter flows between clusters
- **Prompt:** "How do subscribers move into KL city centre on weekday mornings?"
- Group visited-site transitions across many subscribers into cluster-to-cluster or
  H3-to-H3 counts.
- **Layer:** Flow. Thickness = number of subscribers. Filter by hour and weekday.
- **Insight:** Capacity planning along commuter corridors and at event venues.
- **Status:** 🔴. Today's tools work on one IMSI at a time; this needs an anonymised,
  aggregated mobility endpoint.

#### UC-32 — One IMSI's weekly flow summary
- A compact alternative to UC-01. Count the moves between H3 cells over the week and draw
  them as flows instead of a path.
- **Status:** 🟡

---

### 3D Tile layer
*Needs: OGC 3D Tiles, I3S or Cesium Ion URLs.*

#### UC-33 — Buildings blocking 5G in the city centre
- Load a 3D buildings tileset (for example Cesium OSM Buildings) over the city centre. Place
  5G sites at antenna height and colour the BINs by RSRP. This explains indoor-coverage and
  building-shadow complaints.
- **Status:** 🔴. Needs a 3D Tiles source and antenna height data.

---

## 3. Multi-layer stories

These combine several layers to answer one question.

| Story | Layers | Tools |
|---|---|---|
| **Investigate one subscriber's complaint** | Icon (UC-17), Point + Line (UC-01/07), Heatmap (UC-12), GeoJSON BINs (UC-20), time playback | subscriber profile, advisory, visited sites, BIN KPIs |
| **Weekly network health review** | GeoJSON coverage and congestion (UC-22), Hexbin congestion (UC-10), Cluster maintenance (UC-14), Point NTTs (UC-03) | coverage, congestion, NTT, maintenance |
| **New-site planning** | Grid density (UC-18), H3 KPI (UC-25), Flow (UC-31), WMS land use (UC-30) | sites, BIN KPIs, mobility, external |
| **Area deep-dive** | GeoJSON drawn area (UC-23), Line top cells (UC-08), Cluster POIs (UC-15) | bins in area, BIN info, BIN places |

---

## 4. Gaps and open questions

1. **Time per visit.** UC-01, 05, 07, 24 and 32 work best if `get_visited_sites` returns a
   time and duration for each visit. Without that, they fall back to day-level steps.
2. **Coordinates in responses.** Several tools return only IDs (sites, cells, worst cells).
   Including lat/lng in the response would save the extra lookup call.
3. **Bulk and aggregate endpoints.** Per-site speed tests (UC-13) and any mobility across
   many subscribers (UC-31) need batch or aggregated tools.
4. **Privacy (PDPA).** IMSI movement is personal data. Limit UC-01, 05, 24, 26 and 32 to
   authorised roles, log every lookup, and show only anonymised, aggregated data in flow
   views.
5. **Large datasets.** National BIN views need vector tiles (UC-28) instead of paged calls.
