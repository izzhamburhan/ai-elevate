# Weather ML third-party attribution

This document credits upstream software, weights, and data. It does not assign a license to AI Elevate or grant permission to redistribute its unlicensed application code. No root or service LICENSE has been selected.

| Component | License / source | Attribution and use in this service |
|---|---|---|
| Chronos forecasting library | [Apache 2.0](https://github.com/amazon-science/chronos-forecasting/blob/main/LICENSE) | Local forecasting interface; preserve upstream LICENSE and [NOTICE](https://github.com/amazon-science/chronos-forecasting/blob/main/NOTICE) when distributing. Upstream notice: Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved. |
| `autogluon/chronos-2-small` | [Model card, Apache 2.0](https://huggingface.co/autogluon/chronos-2-small) | Pretrained time-series forecasting weights. Exact revision and hashes are recorded by bootstrap and evaluation. Weights are not fine-tuned. |
| PyTorch | [BSD-style 3-clause license](https://github.com/pytorch/pytorch/blob/main/LICENSE) | CPU tensor inference; retain copyright, conditions, and disclaimer in source/binary distributions. Preserve bundled component notices. |
| FastMCP | [Apache 2.0](https://github.com/jlowin/fastmcp/blob/main/LICENSE) | Structured MCP transport and tool registration. |
| Hugging Face Hub, Transformers, Accelerate | [Hub](https://github.com/huggingface/huggingface_hub/blob/main/LICENSE), [Transformers](https://github.com/huggingface/transformers/blob/main/LICENSE), [Accelerate](https://github.com/huggingface/accelerate/blob/main/LICENSE): Apache 2.0 | Explicit weight acquisition and local model execution; preserve package licenses. No hosted inference is used. |
| pandas, NumPy, HTTPX, psutil | [pandas](https://github.com/pandas-dev/pandas/blob/main/LICENSE), [NumPy](https://github.com/numpy/numpy/blob/main/LICENSE.txt), [HTTPX](https://github.com/encode/httpx/blob/master/LICENSE.md), [psutil](https://github.com/giampaolo/psutil/blob/master/LICENSE): BSD 3-clause | Data transformations, acquisition HTTP client, and resource inspection. Retain attribution and bundled binary notices. |
| Apache Arrow / PyArrow | [Apache 2.0 plus bundled component notices](https://github.com/apache/arrow/blob/main/LICENSE.txt) | Persistent Parquet data; retain all applicable bundled licenses. |
| uv | [MIT or Apache 2.0](https://github.com/astral-sh/uv#license) | Reproducible environment/lock tooling. Keep either appropriate upstream license material and relevant dependency notices. |
| Weather data | [Open-Meteo](https://open-meteo.com/), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | Public historical reanalysis. Changed by selecting Malaysian locations/variables, converting to UTC hourly Parquet, and computing forecasts/metrics. No endorsement implied. Source request, grid coordinates, acquisition time, and hashes are preserved in dataset manifests. |
| Source data producers | [Open-Meteo historical sources](https://open-meteo.com/en/docs/historical-weather-api) | Reanalysis includes ECMWF/Copernicus ERA5 when `models=era5` is selected. Use the actual manifest's dataset and producer attribution; do not describe reanalysis as independent station observations. |
| Cached pitch geographic context | [Natural Earth terms](https://www.naturalearthdata.com/about/terms-of-use/): public domain | Selected Malaysia/Thailand/Indonesia/Brunei geometries from 1:110m admin-0 countries, upstream revision `ca96624a56bd078437bca8184e78163e5039ad19`. Bundled locally for orientation; coarse outlines are not authoritative boundaries. SHA256 `93d31bf3cd11e6e56063be2cc83052e7f30677e44f2a40bf56f01fdb4d8121af`. |
| Additional Python/container dependencies | Locked `uv.lock`; installed `/reports/dependency-licenses.json` inventory | Retain installed distribution license files. The inventory is metadata evidence, not a complete legal determination or replacement for notices. See the license audit. |

Weather data displays should show a clickable **[Weather data by Open-Meteo](https://open-meteo.com/)** link, including maps and exported reports. Raw forecasting quantiles are uncalibrated; ML output is not an official meteorological forecast. Synthetic NetOps locations and incidents remain labeled synthetic.

Open-Meteo's [free API terms](https://open-meteo.com/en/terms) permit non-commercial requests within published limits. Data licensing and hosted API access terms are separate. Open-Meteo server [AGPLv3-or-later source](https://github.com/open-meteo/open-meteo) is not bundled or modified here.

Docker Desktop is the owner's explicitly approved proprietary local runtime. The service image uses open-source runtime components. No alternative host container runtime is installed.

Research credit: Abdul Fatir Ansari et al., *Chronos-2: From Univariate to Universal Forecasting* (2025), [arXiv:2510.15821](https://arxiv.org/abs/2510.15821).
