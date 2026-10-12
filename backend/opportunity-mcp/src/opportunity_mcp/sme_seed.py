"""Generate the one new synthetic dataset: SME demand and fixed serviceability per existing area.

Every row is tied to an existing intel.duckdb area and derived from that area's actual synthetic sites, so the
numbers stay coherent with the network: denser morphology means more SMEs, and a higher share of fibre-backhauled
sites means more fibre-serviceable premises. Same intel.duckdb + same SEED = the same CSV.
Run: `uv run python -m opportunity_mcp.sme_seed` (writes src/opportunity_mcp/data/sme_demand.csv).
"""

from __future__ import annotations

import csv
import hashlib
import random
from pathlib import Path

import duckdb

from opportunity_mcp.paths import INTEL_DB, SME_CSV

SEED = "42"
GENERATOR = "opportunity-sme-v1"
# Synthetic registered-SME density per site footprint, by NetOps morphology
SME_PER_SITE = {"Dense Urban": 420, "Urban": 260, "Sub Urban": 140, "Rural": 50}
SECTORS = ["Retail & F&B", "Professional services", "Light manufacturing", "Logistics", "Hospitality & tourism"]
FIELDS = ["area_id", "cluster", "sme_count", "fibre_serviceable_pct", "tm_business_penetration_pct", "mobile_only_sme_pct",
          "broadband_enquiries_90d", "dominant_sector", "synthetic", "generator"]


def _rng(area_id: str) -> random.Random:
    return random.Random(int(hashlib.sha256(f"{SEED}:{area_id}".encode()).hexdigest()[:16], 16))


def build_rows(intel_db: Path = INTEL_DB) -> list[dict]:
    con = duckdb.connect(str(intel_db), read_only=True)
    areas = con.execute("SELECT area_id, cluster FROM area ORDER BY area_id").fetchall()
    sites = con.execute("SELECT cluster, morphology, backhaul FROM site").fetchall()
    con.close()
    rows = []
    for area_id, cluster in areas:
        rng = _rng(area_id)
        own = [s for s in sites if s[0] == cluster]
        fibre_share = sum(s[2] == "Fiber" for s in own) / len(own)
        sme = round(sum(SME_PER_SITE.get(s[1], 100) for s in own) * rng.uniform(0.85, 1.15))
        serviceable = min(95.0, max(20.0, 30 + 55 * fibre_share + rng.uniform(-10, 10)))
        penetration = rng.uniform(16, 40)
        mobile_only = min(60.0, rng.uniform(12, 28) + (100 - serviceable) * 0.25)
        # unserved premises and mobile-only firms drive enquiries for business broadband
        enquiries = round(sme * rng.uniform(0.02, 0.05) * (1 + (100 - serviceable) / 100 + mobile_only / 100))
        rows.append({"area_id": area_id, "cluster": cluster, "sme_count": sme, "fibre_serviceable_pct": round(serviceable, 1),
                     "tm_business_penetration_pct": round(penetration, 1), "mobile_only_sme_pct": round(mobile_only, 1),
                     "broadband_enquiries_90d": enquiries, "dominant_sector": rng.choices(SECTORS, weights=[5, 4, 2, 2, 2])[0],
                     "synthetic": "true", "generator": GENERATOR})
    return rows


def write(rows: list[dict], path: Path = SME_CSV) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=FIELDS, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)


def main() -> None:
    rows = build_rows()
    write(rows)
    print(f"wrote {SME_CSV}: {len(rows)} synthetic area rows ({GENERATOR}, seed {SEED})")


if __name__ == "__main__":
    main()
