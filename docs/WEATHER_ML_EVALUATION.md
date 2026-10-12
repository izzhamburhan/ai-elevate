# Weather ML evaluation

Evaluation execution: **PASS**.

This is retrospective historical replay of public reanalysis. It is not an official forecast or a validation against independent station measurements.

## Protocol

- **split:** Chronological development60%/validation20%/test20% by UTC-hour count; no fitting or fine-tuning
- **origins:** Deterministically evenly spaced from a 24-hour origin grid within each split; sampled subset, no selection by errors
- **forecast:** Direct model calls with prediction_length 6, 12, and 24 for each target/origin. Held-out windows are nested across horizons, so horizon results are dependent
- **context:** Only observations timestamp <= origin; no future covariates; gaps remain explicit and incomplete windows are skipped
- **intervals:** Chronos raw q0.1/q0.9, nominal80%, uncalibrated. Baseline test bounds from validation-only pooled hourly residual q0.1/q0.9
- **point_forecast:** q0.5 median (same point estimate used by deployed service)
- **rainfall:** Precipitation mm per previous hourly interval, used as rainfall proxy in Malaysia; sum-of-medians is not a total quantile
- **reference:** Open-Meteo historical reanalysis, not independent station ground truth or as-of operational observations
- **leakage:** Application input chronology enforced. Pretraining corpus overlap and training cutoff unknown; absence of pretrained-model leakage cannot be guaranteed

## Test metrics (all locations pooled)

| Target | Horizon | Method | Hours | MAE | RMSE | 80% interval coverage | Mean interval width |
|---|---:|---|---:|---:|---:|---:|---:|
| precipitation (mm/hour) | 6h | chronos | 54 | 0.1607 | 0.2796 | 0.6111 | 0.4761 |
| precipitation (mm/hour) | 6h | persistence | 54 | 0.2611 | 0.4681 | 0.5556 | 0.2578 |
| precipitation (mm/hour) | 6h | seasonal_naive_24 | 54 | 0.1870 | 0.3769 | 0.7963 | 0.6550 |
| precipitation (mm/hour) | 12h | chronos | 108 | 0.2766 | 1.0048 | 0.5370 | 0.5415 |
| precipitation (mm/hour) | 12h | persistence | 108 | 0.4046 | 1.0819 | 0.6019 | 0.4167 |
| precipitation (mm/hour) | 12h | seasonal_naive_24 | 108 | 0.3278 | 1.0640 | 0.8148 | 0.5236 |
| precipitation (mm/hour) | 24h | chronos | 216 | 0.3735 | 1.0840 | 0.5972 | 0.6411 |
| precipitation (mm/hour) | 24h | persistence | 216 | 0.4745 | 1.0950 | 0.6898 | 0.3967 |
| precipitation (mm/hour) | 24h | seasonal_naive_24 | 216 | 0.4986 | 1.2363 | 0.6944 | 0.5003 |
| temperature_2m (°C) | 6h | chronos | 54 | 0.2567 | 0.3283 | 0.7407 | 0.8622 |
| temperature_2m (°C) | 6h | persistence | 54 | 0.5704 | 0.6826 | 0.7593 | 1.2900 |
| temperature_2m (°C) | 6h | seasonal_naive_24 | 54 | 0.6019 | 0.7873 | 0.8148 | 2.0833 |
| temperature_2m (°C) | 12h | chronos | 108 | 0.4773 | 0.7209 | 0.8148 | 1.8328 |
| temperature_2m (°C) | 12h | persistence | 108 | 2.0870 | 2.8626 | 0.4074 | 2.4167 |
| temperature_2m (°C) | 12h | seasonal_naive_24 | 108 | 0.8324 | 1.1229 | 0.6852 | 2.0500 |
| temperature_2m (°C) | 24h | chronos | 216 | 0.9343 | 1.3397 | 0.5694 | 2.0131 |
| temperature_2m (°C) | 24h | persistence | 216 | 1.9944 | 2.7544 | 0.8287 | 6.2167 |
| temperature_2m (°C) | 24h | seasonal_naive_24 | 216 | 1.2088 | 1.6987 | 0.7130 | 3.3067 |

## Rainfall diagnostics

| Horizon | Method | Wet hours | Wet-hour MAE (mm/h) | Total rainfall MAE (mm/window) | Total rainfall bias (mm/window) |
|---|---|---:|---:|---:|---:|
| 6h | chronos | 26 | 0.2827 | 0.9466 | -0.3155 |
| 6h | persistence | 26 | 0.3115 | 1.5667 | 0.4778 |
| 6h | seasonal_naive_24 | 26 | 0.2615 | 1.0556 | -0.3222 |
| 12h | chronos | 55 | 0.4718 | 3.2348 | -2.0950 |
| 12h | persistence | 55 | 0.4855 | 4.8111 | -0.3667 |
| 12h | seasonal_naive_24 | 55 | 0.4745 | 3.4889 | -1.2222 |
| 24h | chronos | 101 | 0.7145 | 8.2868 | -6.6846 |
| 24h | persistence | 101 | 0.7218 | 8.7889 | -3.1444 |
| 24h | seasonal_naive_24 | 101 | 0.7139 | 8.2778 | -2.0778 |

## Baseline comparison

Chronos has lower test MAE in **12/12** available target/horizon/baseline comparisons. Ties are not wins.

- PASS: precipitation 6h versus persistence: Chronos MAE 0.1607; baseline MAE 0.2611.
- PASS: precipitation 6h versus seasonal_naive_24: Chronos MAE 0.1607; baseline MAE 0.1870.
- PASS: precipitation 12h versus persistence: Chronos MAE 0.2766; baseline MAE 0.4046.
- PASS: precipitation 12h versus seasonal_naive_24: Chronos MAE 0.2766; baseline MAE 0.3278.
- PASS: precipitation 24h versus persistence: Chronos MAE 0.3735; baseline MAE 0.4745.
- PASS: precipitation 24h versus seasonal_naive_24: Chronos MAE 0.3735; baseline MAE 0.4986.
- PASS: temperature_2m 6h versus persistence: Chronos MAE 0.2567; baseline MAE 0.5704.
- PASS: temperature_2m 6h versus seasonal_naive_24: Chronos MAE 0.2567; baseline MAE 0.6019.
- PASS: temperature_2m 12h versus persistence: Chronos MAE 0.4773; baseline MAE 2.0870.
- PASS: temperature_2m 12h versus seasonal_naive_24: Chronos MAE 0.4773; baseline MAE 0.8324.
- PASS: temperature_2m 24h versus persistence: Chronos MAE 0.9343; baseline MAE 1.9944.
- PASS: temperature_2m 24h versus seasonal_naive_24: Chronos MAE 0.9343; baseline MAE 1.2088.

A FAIL above describes predictive skill relative to that baseline, not a service failure. Next experiment: extend rolling origins across wet/dry seasons and additional locations; test past-only multivariate covariates against independent station records, then recalibrate intervals on a separate calibration set. Do not fine-tune until enough labeled data and a blind holdout exist.

## Runtime and provenance

- Successful inference calls: 108/108.
- Mean inference latency: 0.0316 seconds; p95: 0.0350 seconds.
- Process peak RSS: 535.3 MiB. Whole evaluation process high-water RSS including imports/model/data, not model-only allocation or container memory
- Skipped windows: 0; model errors: 0.
- Exact origins, validation metrics, per-location scores, source manifests, artifact hashes, and per-window predictions are in report.json.
- Cached CPU model load: 7.2792 seconds.
- 6h direct inference: 36 successful calls, mean 0.0317 seconds, p95 0.0360 seconds.
- 12h direct inference: 36 successful calls, mean 0.0311 seconds, p95 0.0342 seconds.
- 24h direct inference: 36 successful calls, mean 0.0319 seconds, p95 0.0354 seconds.
- Model: `autogluon/chronos-2-small`; revision: `ddec01313e50b6bc58ebaa92ede81bc24a3d9f9a`.

## Limitations

- Small retrospective sample; no claim of operational forecast skill or official meteorological forecast
- Reanalysis was acquired after evaluation dates and may include revisions/assimilation unavailable at forecast origin
- Sparse rainfall and a short sample make interval coverage and wet-hour scores unstable
- Raw quantiles are not calibrated rainfall-event probabilities; exposure rules do not predict telecom outages
- If a baseline wins, retain the integration and enlarge blind evaluation before choosing a deployment forecast method

Weather data: [Open-Meteo](https://open-meteo.com/), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Data transformed into hourly UTC Parquet and forecast/evaluation outputs. Model: [Chronos-2-Small](https://huggingface.co/autogluon/chronos-2-small), Apache 2.0.
