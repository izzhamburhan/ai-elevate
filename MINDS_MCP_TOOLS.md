# MINDS MCP Tools

`?` = optional parameter.

| Tool name | Tool description | Parameters |
|---|---|---|
| `get_coverage_layer` | Get a coverage layer by `technology` (fdd, tdd, 5g, mocn, hwc) for a week. Omit `week` to get the latest available week. The response includes the `week` returned and `available_weeks`. | `technology`, `week?`, `boundary?` |
| `get_coverage_boxes` | Get dashboard coverage box values. | – |
| `get_sites` | Get sites by `technology` (mocn, 5g, 4g, 3g, 2g, aop), with optional region/cluster filter. Paginated with `page`, `page_size`; returns `total`. | `technology`, `region?`, `cluster?`, `page?`, `page_size?` |
| `search_sites` | Search sites by site ID or name. Paginated with `page`, `page_size`; returns `total`. | `site_id`, `page?`, `page_size?` |
| `search_locations` | Search **real** Malaysian places (Overture Maps: ~845k points of interest plus states, districts, towns, neighbourhoods) by keywords, category, state and/or distance from `lat`/`lng` (default radius 5 km). Use to geocode a place name or find places near a site. Paginated with `page`, `page_size`; returns `total`. | `query?`, `category?`, `state?`, `kind?`, `lat?`, `lng?`, `radius_km?`, `page?`, `page_size?` |
| `list_location_categories` | List categories usable in `search_locations` with counts. Paginated with `page`, `page_size`; returns `total`. | `search?`, `kind?`, `page?`, `page_size?` |
| `get_site_info` | Get detail of a site by `technology` and `site_id`. | `technology`, `site_id` |
| `get_site_cells` | Get cell detail of a site by `technology` and `site_id`. Paginated with `page`, `page_size`; returns `total`. | `technology`, `site_id`, `page?`, `page_size?` |
| `get_best_server` | Get the best serving site for a coordinate by `technology` (2g3g, 4g). | `technology`, `lat`, `lng` |
| `get_total_site_number` | Get total number of MOCN, 4G and 5G sites. | – |
| `get_ctt_summary` | Get customer trouble ticket (CTT) figures by `scope` (total, cluster, subscriber_percentage). | `scope`, `year?` |
| `get_ntt_tickets` | Get network trouble ticket (NTT) status per site by `technology` (4g, 5g). Paginated with `page`, `page_size`; returns `total`. | `technology`, `status?`, `start_date?`, `end_date?`, `site_id?`, `radius?`, `current_lat?`, `current_long?`, `page?`, `page_size?` |
| `get_ntt_summary` | Get NTT figures by `scope` (total, mocn_5g, region, region_detail, cluster). | `scope`, `duration?`, `region_name?`, `start_date?`, `end_date?`, `site_id?`, `radius?`, `current_lat?`, `current_long?` |
| `get_plan_maintenance` | Get planned maintenance on sites. Paginated with `page`, `page_size`; returns `total`. | `site?`, `search?`, `lat?`, `lng?`, `radius?`, `page?`, `page_size?` |
| `get_plan_maintenance_summary` | Get planned maintenance totals. | `duration?` |
| `get_congested_cells` | Get congested cells by `technology` (all, 4g, 4g_mocn, 5g). Paginated with `page`, `page_size`; returns `total`. | `technology`, `site?`, `search?`, `lat?`, `lng?`, `radius?`, `page?`, `page_size?` |
| `get_congestion_layer` | Get a congestion layer by duplex mode (fdd, tdd) for a week. Omit `week` to get the latest available week. The response includes the `week` returned and `available_weeks`. | `duplex`, `week?`, `boundary?` |
| `get_bin_polygons` | Get BIN map base polygons by `layer` (bin_border, hwc_clover, tm_cluster). Paginated with `page`, `page_size`; returns `total`. | `layer`, `center?`, `radius?`, `northwest?`, `northeast?`, `southeast?`, `southwest?`, `page?`, `page_size?` |
| `search_bins` | Search BINs by location or ID. Paginated with `page`, `page_size`; returns `total`. | `bin_id`, `page?`, `page_size?` |
| `get_bin_kpi_values` | Get BIN KPI values for the heat layer by `kpi` (rsrp, rsrq, throughput). Paginated with `page`, `page_size`; returns `total`. | `kpi`, `observation_duration`, `calculation_type`, `center?`, `radius?`, `northwest?`, `northeast?`, `southeast?`, `southwest?`, `page?`, `page_size?` |
| `get_bin_info` | Get detail of a BIN by `section` (performance, coverage, top_cells, serving_cell, neighbouring_cells). | `section`, `grid_id`, `observation_duration?`, `calculation_type?` |
| `get_bin_places` | Get places inside a BIN by `type` (poi, property). Paginated with `page`, `page_size`; returns `total`. | `type`, `grid_id`, `page?`, `page_size?` |
| `get_cell_details` | Get detail of a cell. | `cell_name`, `observation_duration?` |
| `get_bins_in_area` | Get BIN data inside an area by `mode` (freehand polygon, cluster). Paginated with `page`, `page_size`; returns `total`. | `mode`, `polygon?`, `cluster?`, `page?`, `page_size?` |
| `get_bin_network_elements` | Get 4G network elements in the BIN view by `entity` (site, cell). Paginated with `page`, `page_size`; returns `total`. | `entity`, `site_id?`, `tdd_site_id?`, `status?`, `page?`, `page_size?` |
| `get_site4g_region_totals` | Get 4G site totals by region. | – |
| `get_subscriber_profile` | Get subscriber detail by `section` (customer, device, network). | `section`, `msisdn` or `imsi`, `start_date?`, `end_date?` |
| `get_subscriber_activity` | Get subscriber history by `type` (signal_strength, speedtest, app_usage, voice_sms) and date range. Paginated with `page`, `page_size`; returns `total`. | `type`, `imsi`, `start_date?`, `end_date?`, `page?`, `page_size?` |
| `get_visited_sites` | Get sites visited by a subscriber with location and status. Paginated with `page`, `page_size`; returns `total`. | `imsi`, `start_date?`, `end_date?`, `page?`, `page_size?` |
| `get_mobile_dashboard_advisory` | Get advisory for the subscriber mobile dashboard. | `imsi` |
| `get_dashboard_legends` | Get legends for the mobile dashboard. | – |
| `get_nba_advisory` | Get the ML next-best-action advisory for a subscriber. | `msisdn`, `line_status`, `quota_usage`, `ntt_status`, `connection_type`, `congestion_status`, `plan_maintenance_status`, `final_RSRP_status`, `final_SINR_status`, `usage_volume`, `volte_total_short_calls_status`, `volte_total_call_attempt_status`, `overall_KPI_status`, `latency_status` |
| `get_site_speedtest` | Get Ookla speed-test results for a site on a date. Omit `date` to get the latest available date. The response includes the `date` returned and `available_dates`. | `site_id`, `date?` |
| `get_nba_subscriber_profile` | Get NBA subscriber data by `section` (customer_profile, morphology, device, usage_ratio, subs_related, voice_call). Omit `query_date` to get the latest available date. The response includes the `query_date` returned and `available_dates`. | `section`, `msisdn`, `query_date?` |
| `get_nba_network_kpi` | Get network KPI around the subscriber. Omit `query_date` to get the latest available date. The response includes the `query_date` returned and `available_dates`. | `msisdn`, `query_date?` |
| `get_nba_rf_quality` | Get subscriber RF quality (latest version). Omit `query_date` to get the latest available date. The response includes the `query_date` returned and `available_dates`. | `msisdn`, `query_date?` |
| `get_nba_nearest_site` | Get nearest site information for the subscriber (latest version). Omit `query_date` to get the latest available date. The response includes the `query_date` returned and `available_dates`. | `msisdn`, `query_date?` |
| `get_nba_site_related` | Get site-related NBA data (latest version). Omit `query_date` to get the latest available date. The response includes the `query_date` returned and `available_dates`. | `msisdn`, `query_date?` |
| `get_nba_network_connection` | Get subscriber network connection information (latest version). Omit `query_date` to get the latest available date. The response includes the `query_date` returned and `available_dates`. | `msisdn`, `query_date?` |
| `get_nba_visited_sites` | Get sites visited by the subscriber, optionally ranked by online time. Paginated with `page`, `page_size`; returns `total`. Omit `query_date` to get the latest available date. The response includes the `query_date` returned and `available_dates`. | `msisdn`, `query_date?`, `rank_by_online_time?`, `page?`, `page_size?` |
| `get_nba_historical_days` | Get subscriber historical days (latest version). Omit `query_date` to get the latest available date. The response includes the `query_date` returned and `available_dates`. | `msisdn`, `query_date?` |
| `verify_nba_api_data` | Verify NBA API data. | – |
| `get_vip_tickets` | Get VIP tickets with filters (CTT2, customer name, MSISDN, complaint date range, status). Paginated with `page`, `page_size`; returns `total`. | `ctt2?`, `customer_name?`, `msisdn?`, `complaint_date_gte?`, `complaint_date_lte?`, `status?`, `psc_pic?`, `root_cause2?`, `problem?`, `complaint_forward_by?`, `ordering?`, `page?`, `page_size?` |
| `get_vip_ticket_detail` | Get detail of a VIP ticket. | `ctt2` |
| `get_ticket_filter_options` | Get filter and search dropdown values for VIP tickets. | – |
| `export_vip_tickets_csv` | Export VIP tickets as CSV using the same filters as `get_vip_tickets`. | same filters as `get_vip_tickets` |
| `get_ticket_comments` | Get remarks or feedback of a ticket by `type` (remark, feedback) and `scope` (latest_per_group, history). Paginated with `page`, `page_size`; returns `total`. | `type`, `scope`, `ctt2`, `group_id?`, `page?`, `page_size?` |
| `get_ticket_assignees` | Get ticket assignees by `type` (group, pic). | `type`, `name_filter?` |
| `create_vip_ticket` | Create a VIP ticket. | `payload` |
| `delete_vip_ticket` | Delete a VIP ticket. | `ctt2` |
| `add_ticket_comment` | Add a remark or feedback to a ticket by `type` (remark, feedback). | `type`, `ctt2`, `group_id`, `payload` |
| `send_ticket_email` | Send a ticket email by `type` (new_ticket, escalation). | `type`, `ctt2`, `payload` |
| `get_ticket_attachments` | Get attachments of a ticket. Paginated with `page`, `page_size`; returns `total`. | `ctt2`, `page?`, `page_size?` |
| `upload_ticket_attachment` | Upload an attachment to a ticket. | `ctt2`, `files` |
| `download_ticket_attachment` | Download a ticket attachment. | `ctt2`, `filename` |
| `get_ran_kpi` | Get RAN KPI by `level` (national, region, site) for one or more KPIs. Omit `start_date` and `end_date` to get the latest available period. The response includes the `start_date` and `end_date` returned and `available_range`. | `level`, `kpi`, `technology`, `start_date?`, `end_date?`, `granularity?`, `vendor?`, `region?`, `site_id?`, `exclusion?` |
| `get_ran_kpi_summary` | Get RAN KPI summary. Omit `start_date` and `end_date` to get the latest available period. The response includes the `start_date` and `end_date` returned and `available_range`. | `technology`, `start_date?`, `end_date?`, `region?`, `vendor?` |
| `get_ran_site_info` | Get RAN site information. | `site_id` |
| `get_worst_cells` | Get worst cells by `scope` (national, kpi). Paginated with `page`, `page_size`; returns `total`. Omit `start_date` and `end_date` to get the latest available period. The response includes the `start_date` and `end_date` returned and `available_range`. | `scope`, `technology`, `start_date?`, `end_date?`, `kpi?`, `region?`, `vendor?`, `page?`, `page_size?` |
