---
name: elevate-weather-replay
description: Use the real Weather ML MCP for local Chronos rainfall and temperature analysis, honest replay labeling, uncertainty and geographic site exposure.
---

# Weather evidence procedure

1. Call `get_weather_model_status` first. Check readiness, mode, the actual full cached location list and observation/context timestamps. An unavailable service or stale live data is a failed analysis, not permission to invent a forecast.
2. For a map investigation use `get_weather_forecast_geojson` with a supported 6, 12 or 24 hour horizon. Actual cached IDs are `all`, `kuala-lumpur`, `penang`, `johor-bahru`. Shah Alam/Selangor uses nearby `kuala-lumpur` or the cached `Central` region; never use `Shah Alam` as the weather region. For the bounded demonstration choose six hours, preserve the geographic grid-distance limitation, and report after these two source calls.
3. For exact existing site IDs explicitly supplied or returned in source GeoJSON, `predict_weather_for_sites` can perform a join. Never invent example IDs or copy a site name in place of a site ID. If no exact IDs are available, ask for inventory evidence. `predict_rainfall` and `predict_temperature` require WGS84 latitude/longitude and the same validated horizons; use them when that specific output is requested, without duplicating a sufficient geographic forecast.
4. Describe actual model-returned medians and quantiles with mm per hourly record or degrees Celsius. Preserve UTC and Asia/Kuala_Lumpur valid times. Explain that cached historical ERA5 weather inputs and Chronos ML predictions are separate evidence types.
5. Retain the returned GeoJSON and its source/model attribution for the map adapter. Joined telecom sites are synthetic; low/elevated/high exposure is a geographic rainfall rule, not an outage classifier.
6. If asked about forecast quality, call `get_weather_model_metrics`; do not invent confidence or calibration. The current small backtest does not establish operational meteorological skill. Uncalibrated 10/90 bounds are not an 80% rainfall-event confidence statement.
7. Return the actual findings and source references with warnings, and record only a concise reference in your private Hermes memory.

Never infer heavy rain from the user's wording. The September 26, 2026 replay may correctly show low exposure. Never use observations after the context cutoff as model inputs.
