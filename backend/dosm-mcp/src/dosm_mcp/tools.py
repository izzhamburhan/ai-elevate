"""dosm-mcp tool logic. Read-only queries over the DuckDB built by `python -m dosm_mcp.download`."""

from __future__ import annotations

import datetime as dt
import difflib
import math
import re
from decimal import Decimal
from typing import Any

import duckdb
from menara_core.envelope import Envelope, wrap_at
from menara_core.errors import InvalidInputError, NotFoundError

SOURCE = "dosm-mcp"
ATTRIBUTION = "Department of Statistics Malaysia (DOSM), OpenDOSM / data.gov.my, CC BY 4.0."
MAX_LIMIT = 5000
MAX_VALUES = 40
STATE_ALIASES = {
    "kl": "w.p. kuala lumpur",
    "kuala lumpur": "w.p. kuala lumpur",
    "putrajaya": "w.p. putrajaya",
    "labuan": "w.p. labuan",
    "penang": "pulau pinang",
    "malacca": "melaka",
    "n9": "negeri sembilan",
    "ns": "negeri sembilan",
}


# --- helpers ---------------------------------------------------------------------------------------------------


def _clean(v: Any) -> Any:
    if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
        return None
    if isinstance(v, Decimal):
        return float(v)
    if isinstance(v, dt.datetime | dt.date):
        return v.isoformat()
    return v


def rows(cur: duckdb.DuckDBPyConnection) -> list[dict[str, Any]]:
    names = [d[0] for d in cur.description or []]
    return [{n: _clean(v) for n, v in zip(names, r, strict=True)} for r in cur.fetchall()]


def built_at(conn: duckdb.DuckDBPyConnection) -> str:
    return str(conn.execute("SELECT built_at FROM _build").fetchone()[0])[:19]  # type: ignore[index]


def _wrap[T](conn: duckdb.DuckDBPyConnection, tool: str, data: T, ref: str | None = None, warnings: list[str] | None = None) -> Envelope[T]:
    return wrap_at(built_at(conn), source=SOURCE, tool=tool, data=data, ref=ref, warnings=warnings, synthetic=False)


def dataset(conn: duckdb.DuckDBPyConnection, dataset_id: str) -> dict[str, Any]:
    key = dataset_id.strip().lower()
    found = rows(conn.execute("SELECT * FROM _catalogue WHERE lower(id) = ? OR table_name = ?", [key, key]))
    if not found:
        ids = [r[0] for r in conn.execute("SELECT id FROM _catalogue").fetchall()]
        close = difflib.get_close_matches(key, ids, n=5, cutoff=0.5)
        raise NotFoundError(f"Unknown dataset '{dataset_id}'. Close matches: {close or 'none'}. Use dosm_search_datasets.")
    meta = found[0]
    if not meta["loaded"]:
        raise NotFoundError(f"Dataset '{meta['id']}' is in the catalogue but not downloaded. Run: python -m dosm_mcp.download {meta['id']}")
    return meta


def columns(conn: duckdb.DuckDBPyConnection, table: str) -> dict[str, str]:
    return {r[0]: r[1] for r in conn.execute(f'DESCRIBE "{table}"').fetchall()}


def _norm_place(s: str) -> str:
    s = re.sub(r"[^a-z0-9 ]", " ", s.lower().replace("w.p.", "").replace("wilayah persekutuan", ""))
    s = re.sub(r"\bhulu\b", "ulu", s)
    return " ".join(s.split())


def match_places(conn: duckdb.DuckDBPyConnection, table: str, col: str, wanted: str, where: str = "", params: list[Any] | None = None) -> list[str]:
    """Every spelling `table` uses for a state or district (case, W.P. prefix, Hulu/Ulu and common aliases ignored).
    More than one when DOSM renamed a place between years (Ulu Langat -> Hulu Langat)."""
    target = _norm_place(STATE_ALIASES.get(wanted.strip().lower(), wanted))
    return sorted(v for v in _distinct(conn, table, col, where, params) if _norm_place(v) == target)


def _distinct(conn: duckdb.DuckDBPyConnection, table: str, col: str, where: str = "", params: list[Any] | None = None) -> list[str]:
    """Distinct values of a column; empty when the table was not downloaded."""
    try:
        return [r[0] for r in conn.execute(f'SELECT DISTINCT "{col}" FROM "{table}" {where}', params or []).fetchall() if r[0]]
    except duckdb.CatalogException:
        return []


def match_place(conn: duckdb.DuckDBPyConnection, table: str, col: str, wanted: str, where: str = "", params: list[Any] | None = None) -> str | None:
    hits = match_places(conn, table, col, wanted, where, params)
    return hits[0] if hits else None


def _place_or_raise(conn: duckdb.DuckDBPyConnection, table: str, col: str, wanted: str, where: str = "", params: list[Any] | None = None) -> str:
    hit = match_place(conn, table, col, wanted, where, params)
    if hit is None:
        values = _distinct(conn, table, col, where, params)
        if not values:
            raise NotFoundError(f"{table} has no data. Run: python -m dosm_mcp.download {table}")
        raise NotFoundError(f"No {col} '{wanted}' in {table}. Known: {sorted(values)}")
    return hit


# --- catalogue -------------------------------------------------------------------------------------------------


def search_datasets(
    conn: duckdb.DuckDBPyConnection,
    query: str = "",
    category: str | None = None,
    geography: str | None = None,
    frequency: str | None = None,
    limit: int = 20,
) -> Envelope[dict[str, Any]]:
    cat = rows(conn.execute("SELECT * FROM _catalogue"))
    fields: dict[str, str] = {}
    for ds, name, title in conn.execute("SELECT dataset_id, name, title FROM _fields").fetchall():
        fields[ds] = fields.get(ds, "") + f" {name} {title}"
    terms = [t for t in re.split(r"\W+", query.lower()) if t]
    scored = []
    for d in cat:
        if category and category.lower() not in (d["category"] + " " + d["subcategory"]).lower():
            continue
        if geography and geography.upper() not in [g.upper() for g in d["geography"]]:
            continue
        if frequency and frequency.upper() != d["frequency"].upper():
            continue
        title, topic = d["title"].lower(), f"{d['category']} {d['subcategory']} {d['id']}".lower()
        text, cols = d["description"].lower(), fields.get(d["id"], "").lower()
        score = sum(4 * (t in title) + 3 * (t in topic) + (t in text) + (t in cols) for t in terms)
        if terms and score == 0:
            continue
        scored.append((score, d))
    scored.sort(key=lambda x: (-x[0], x[1]["category"], x[1]["id"]))
    limit = max(1, min(limit, 300))
    out = [
        {
            "dataset_id": d["id"],
            "title": d["title"],
            "category": f"{d['category']} / {d['subcategory']}",
            "frequency": d["frequency"],
            "geography": d["geography"],
            "coverage": f"{d['dataset_begin']}-{d['dataset_end']}",
            "last_updated": d["last_updated"],
            "rows": d["row_count"],
        }
        for _, d in scored[:limit]
    ]
    categories: dict[str, int] = {}
    for d in cat:
        categories[d["category"]] = categories.get(d["category"], 0) + 1
    data = {"query": query, "total": len(scored), "returned": len(out), "datasets": out, "categories": categories, "attribution": ATTRIBUTION}
    return _wrap(conn, "dosm_search_datasets", data, ref=query or None)


def describe_dataset(conn: duckdb.DuckDBPyConnection, dataset_id: str) -> Envelope[dict[str, Any]]:
    meta = dataset(conn, dataset_id)
    t = meta["table_name"]
    types = columns(conn, t)
    docs = {r[0]: (r[1], r[2]) for r in conn.execute("SELECT name, title, description FROM _fields WHERE dataset_id = ?", [meta["id"]]).fetchall()}
    cols = []
    for name, typ in types.items():
        title, desc = docs.get(name, ("", ""))
        col: dict[str, Any] = {"name": name, "type": typ, "title": title, "description": desc}
        if typ == "VARCHAR":
            n = conn.execute(f'SELECT count(DISTINCT "{name}") FROM "{t}"').fetchone()[0]  # type: ignore[index]
            col["distinct"] = n
            col["values"] = [r[0] for r in conn.execute(f'SELECT DISTINCT "{name}" FROM "{t}" ORDER BY 1 LIMIT {MAX_VALUES}').fetchall()]
            if n > MAX_VALUES:
                col["values_truncated"] = True
        cols.append(col)
    date_range = None
    sample_where = ""
    if "date" in types:
        lo, hi = conn.execute(f'SELECT min(date), max(date) FROM "{t}"').fetchone()  # type: ignore[misc]
        date_range = {"first": _clean(lo), "latest": _clean(hi)}
        sample_where = f'WHERE date = (SELECT max(date) FROM "{t}")'
    sample = rows(conn.execute(f'SELECT * FROM "{t}" {sample_where} LIMIT 5'))
    data = {
        "dataset_id": meta["id"],
        "table": t,
        "title": meta["title"],
        "description": meta["description"],
        "category": f"{meta['category']} / {meta['subcategory']}",
        "frequency": meta["frequency"],
        "geography": meta["geography"],
        "demography": meta["demography"],
        "rows": meta["row_count"],
        "date_range": date_range,
        "data_as_of": meta["data_as_of"],
        "last_updated": meta["last_updated"],
        "next_update": meta["next_update"],
        "columns": cols,
        "sample_latest": sample,
        "methodology": meta["methodology"],
        "caveat": meta["caveat"],
        "source_url": meta["link_parquet"],
        "attribution": ATTRIBUTION,
    }
    return _wrap(conn, "dosm_describe_dataset", data, ref=meta["id"])


# --- data ------------------------------------------------------------------------------------------------------


def query_dataset(
    conn: duckdb.DuckDBPyConnection,
    dataset_id: str,
    filters: dict[str, Any] | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    latest: bool = False,
    columns_: list[str] | None = None,
    order: str = "desc",
    limit: int = 200,
) -> Envelope[dict[str, Any]]:
    meta = dataset(conn, dataset_id)
    t = meta["table_name"]
    types = columns(conn, t)
    lower = {c.lower(): c for c in types}

    def col(name: str) -> str:
        if name.lower() not in lower:
            raise InvalidInputError(f"No column '{name}' in {meta['id']}. Columns: {list(types)}")
        return lower[name.lower()]

    where: list[str] = []
    params: list[Any] = []
    warnings: list[str] = []
    for name, value in (filters or {}).items():
        c = col(name)
        values = value if isinstance(value, list) else [value]
        if types[c] == "VARCHAR":
            if c in ("state", "district"):
                matched = [m for v in values for m in (match_places(conn, t, c, str(v)) or [str(v)])]
            else:
                matched = [str(v) for v in values]
            where.append(f'lower("{c}") IN ({", ".join("lower(?)" for _ in matched)})')
            params += matched
        else:
            where.append(f'"{c}" IN ({", ".join("?" for _ in values)})')
            params += values
    has_date = "date" in types
    if (date_from or date_to or latest) and not has_date:
        warnings.append(f"{meta['id']} has no date column; date_from/date_to/latest ignored")
    if has_date:
        if date_from:
            where.append("date >= CAST(? AS DATE)")
            params.append(date_from)
        if date_to:
            where.append("date <= CAST(? AS DATE)")
            params.append(date_to)
    clause = f"WHERE {' AND '.join(where)}" if where else ""
    if latest and has_date:
        latest_date = conn.execute(f'SELECT max(date) FROM "{t}" {clause}', params).fetchone()[0]  # type: ignore[index]
        clause = f"{clause} {'AND' if clause else 'WHERE'} date = ?"
        params = [*params, latest_date]
    select = ", ".join(f'"{col(c)}"' for c in columns_) if columns_ else "*"
    direction = "ASC" if order.lower() == "asc" else "DESC"
    order_by = f"ORDER BY date {direction}" if has_date else ""
    limit = max(1, min(limit, MAX_LIMIT))
    total = conn.execute(f'SELECT count(*) FROM "{t}" {clause}', params).fetchone()[0]  # type: ignore[index]
    out = rows(conn.execute(f'SELECT {select} FROM "{t}" {clause} {order_by} LIMIT {limit}', params))
    if total > limit:
        warnings.append(f"{total} rows match; returned {limit}. Narrow with filters/dates or raise limit (max {MAX_LIMIT}).")
    if total == 0 and filters:
        warnings.append("No rows matched. dosm_describe_dataset lists each column's values.")
    data = {"dataset_id": meta["id"], "title": meta["title"], "total": total, "returned": len(out), "rows": out, "last_updated": meta["last_updated"], "attribution": ATTRIBUTION}
    return _wrap(conn, "dosm_query_dataset", data, ref=meta["id"], warnings=warnings)


_WRITE = re.compile(r"\b(insert|update|delete|create|drop|alter|attach|detach|copy|export|import|install|load|pragma|set|call|checkpoint)\b", re.I)


def run_sql(conn: duckdb.DuckDBPyConnection, sql: str, limit: int = 500) -> Envelope[dict[str, Any]]:
    body = sql.strip().rstrip(";")
    if ";" in body:
        raise InvalidInputError("One statement only.")
    if not re.match(r"^\s*(select|with|from|summarize|describe)\b", body, re.I) or _WRITE.search(re.sub(r"'[^']*'", "''", body)):
        raise InvalidInputError("Read-only: SELECT / WITH / FROM / DESCRIBE / SUMMARIZE only.")
    limit = max(1, min(limit, MAX_LIMIT))
    try:
        if re.match(r"^\s*(describe|summarize)\b", body, re.I):
            out = rows(conn.execute(body))[:limit]
            total = len(out)
        else:
            out = rows(conn.execute(f"SELECT * FROM ({body}) LIMIT {limit + 1}"))
            total = len(out)
            out = out[:limit]
    except duckdb.Error as e:
        raise InvalidInputError(f"SQL error: {str(e).splitlines()[0]}") from e
    warnings = [f"Truncated to {limit} rows."] if total > limit else []
    return _wrap(conn, "dosm_sql", {"returned": len(out), "rows": out, "attribution": ATTRIBUTION}, warnings=warnings)


# --- summaries -------------------------------------------------------------------------------------------------


def _latest(conn: duckdb.DuckDBPyConnection, table: str, cols: list[str], where: str, params: list[Any]) -> dict[str, Any] | None:
    """Newest matching row; None when nothing matches or the table was not downloaded."""
    select = ", ".join(f'"{c}"' for c in cols)  # quoted: economic_indicators has a column named "leading"
    try:
        got = rows(conn.execute(f'SELECT date, {select} FROM "{table}" WHERE {where} ORDER BY date DESC LIMIT 1', params))
    except duckdb.CatalogException:
        return None
    return got[0] if got else None


def area_profile(conn: duckdb.DuckDBPyConnection, state: str, district: str | None = None) -> Envelope[dict[str, Any]]:
    """Latest population, income, poverty, inequality, labour force and amenities for a state or district."""
    st = _place_or_raise(conn, "population_state", "state", state)
    level = "district" if district else "state"
    out: dict[str, Any] = {"state": st, "level": level}
    warnings: list[str] = []

    def place(table: str) -> tuple[str, list[Any]] | None:
        s = match_place(conn, table, "state", st)
        if s is None:
            return None
        if not district:
            return "state = ?", [s]
        ds = match_places(conn, table, "district", district, "WHERE state = ?", [s])
        return (f"state = ? AND district IN ({', '.join('?' for _ in ds)})", [s, *ds]) if ds else None

    if district:
        out["district"] = _place_or_raise(conn, "population_district", "district", district, "WHERE state = ?", [st])
    pop_table = f"population_{level}"
    p = place(pop_table)
    if p:
        overall = f"{p[0]} AND sex = 'both' AND age = 'overall' AND ethnicity = 'overall'"
        series = rows(conn.execute(f'SELECT date, population FROM "{pop_table}" WHERE {overall} ORDER BY date DESC LIMIT 2', p[1]))
        if series:
            cur = series[0]
            out["population"] = {"year": cur["date"][:4], "thousands": cur["population"], "source": pop_table}
            if len(series) == 2 and series[1]["population"]:
                out["population"]["growth_pct"] = round(100 * (cur["population"] / series[1]["population"] - 1), 2)
    checks = [
        ("household_income_rm", f"hh_income_{level}", ["income_mean", "income_median"]),
        ("poverty_pct", f"hh_poverty_{level}", ["poverty_absolute", "poverty_relative"] + ([] if district else ["poverty_hardcore"])),
        ("inequality", f"hh_inequality_{level}", ["gini"]),
        ("labour_force", "lfs_district" if district else "lfs_qtr_state", ["lf", "lf_employed", "lf_unemployed", "p_rate", "u_rate"]),
    ]
    for key, table, cols in checks:
        p = place(table)
        got = _latest(conn, table, cols, p[0], p[1]) if p else None
        if got:
            out[key] = {**got, "source": table}
        else:
            warnings.append(f"no {key} for this {level} in {table}")
    amen = place("hh_access_amenities") if district else ("state = ? AND district = 'All Districts'", [st])
    got = _latest(conn, "hh_access_amenities", ["piped_water", "sanitation", "electricity"], *amen) if amen else None
    if got:
        out["amenities_pct"] = {**got, "source": "hh_access_amenities"}
    s = match_place(conn, "hh_access_internet", "state", st)
    if s:
        internet = rows(conn.execute(
            "SELECT date, strata, proportion FROM hh_access_internet WHERE state = ? AND date = (SELECT max(date) FROM hh_access_internet WHERE state = ?)",
            [s, s],
        ))
        if internet:
            out["households_with_internet_pct"] = {"date": internet[0]["date"], **{r["strata"]: r["proportion"] for r in internet}, "scope": "state", "source": "hh_access_internet"}
    out["units"] = "population in thousands; income in RM/month; poverty, rates and amenities in %; lf counts in thousands"
    out["attribution"] = ATTRIBUTION
    return _wrap(conn, "dosm_area_profile", out, ref=out.get("district") or st, warnings=warnings)


def economy_snapshot(conn: duckdb.DuckDBPyConnection) -> Envelope[dict[str, Any]]:
    """Latest headline indicators for Malaysia, each with its reference date."""
    out: dict[str, Any] = {}
    warnings: list[str] = []
    picks = [
        ("gdp_growth_yoy_pct", "gdp_qtr_real", ["value"], "series = 'growth_yoy'"),
        ("gdp_growth_qoq_pct", "gdp_qtr_real", ["value"], "series = 'growth_qoq'"),
        ("inflation_pct", "cpi_headline_inflation", ["inflation_yoy", "inflation_mom"], "division = 'overall'"),
        ("unemployment", "lfs_month", ["u_rate", "p_rate", "lf_unemployed"], "TRUE"),
        ("trade_rm", "trade_headline", ["exports", "imports", "balance"], "series = 'abs'"),
        ("trade_growth_yoy_pct", "trade_headline", ["exports", "imports"], "series = 'growth_yoy'"),
        ("industrial_production_growth_yoy_pct", "ipi", ["index"], "series = 'growth_yoy'"),
        ("economic_indicators", "economic_indicators", ["leading", "coincident", "lagging"], "TRUE"),
        ("population_thousands", "population_malaysia", ["population"], "sex = 'both' AND age = 'overall' AND ethnicity = 'overall'"),
    ]
    for key, table, cols, where in picks:
        got = _latest(conn, table, cols, where, [])
        if got:
            out[key] = {**got, "source": table}
        else:
            warnings.append(f"{key}: {table} not available")
    out["units"] = "growth and rates in %; u_rate/p_rate %; lf_unemployed in thousands; trade_rm in RM (monthly)"
    out["attribution"] = ATTRIBUTION
    return _wrap(conn, "dosm_economy_snapshot", out, warnings=warnings)
