# dosm-mcp

FastMCP server for **official Malaysian statistics** from DOSM (Department of Statistics Malaysia), the data
behind [OpenDOSM](https://open.dosm.gov.my). All ~204 DOSM datasets in the data.gov.my catalogue are downloaded
once into a local DuckDB file. After that, the tools answer in about 100 ms and work offline, with no
`api.data.gov.my` rate limit (4 requests/minute).

**Real data.** Responses use the Menara envelope with `synthetic: false`. Licence: CC BY 4.0, attribute DOSM.

## Quick start (from `backend/`)

```bash
uv sync
uv run python -m dosm_mcp.download                       # ~80 MB, ~1 min first time, ~15 s to refresh
uv run python -m dosm_mcp --transport streamable-http    # http://127.0.0.1:8123/mcp
python run_all.py dosm                                   # same, and downloads on first run
```

Refresh the data with the same download command. It re-downloads only the files whose `Last-Modified`
changed, then rebuilds `data/dosm.duckdb`. Stop the server first: on Windows the rebuilt file cannot replace one
that is open.

| Download option | |
|---|---|
| `ids...` | Download only these datasets (e.g. `population_district cpi_core`) |
| `--force` | Re-download everything |
| `--months 3` | Months of PriceCatcher to keep (it is published as one file per month) |
| `--max-mb 200` | Skip larger files (`0` = no limit) |

## Tools

| Tool | What |
|---|---|
| `dosm_search_datasets` | Keyword search over the catalogue, with category, geography and frequency filters |
| `dosm_describe_dataset` | Columns with meaning and allowed values, date range, latest rows, methodology |
| `dosm_query_dataset` | Rows with column filters, a date range or `latest`. State and district names are normalised (KL, Penang, Hulu/Ulu) |
| `dosm_sql` | Read-only DuckDB SQL, one table per dataset (`-` becomes `_`). The connection is read-only and cannot touch files or the network |
| `dosm_area_profile` | State or district: population, household income, poverty, Gini, labour force, amenities, internet access |
| `dosm_economy_snapshot` | Latest GDP growth, inflation, unemployment, trade, IPI, economic indicators, population |

## Where the data comes from

- Catalogue: the [`data-gov-my/datagovmy-meta`](https://github.com/data-gov-my/datagovmy-meta) repo, which holds the
  metadata behind open.dosm.gov.my. It is downloaded as one zip from codeload.github.com.
- Files: the `link_parquet` of each dataset on `storage.dosm.gov.my` / `storage.data.gov.my`.
- Files are stored under `data/` (gitignored): `parquet/`, `dosm.duckdb`, `catalogue.json`, `fields.json` and `state.json`.
