"""TowerSource over the synthetic SQLite file. Everything SQLite-specific lives here."""

from __future__ import annotations

import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import cast

from menara_core import clock, kpi_overlay, repairs
from menara_core.db import connect

from tower_mcp.models import Alarm, KpiPoint, TowerPin, TowerStatus
from tower_mcp.source import NeighbourRecord, StatusRecord, TowerRecord, TowerSource

_STATE_AT = (
    "(SELECT s.status FROM tower_state s WHERE s.enodeb_name = t.enodeb_name "
    "AND s.t_min <= :now ORDER BY s.t_min DESC LIMIT 1)"
)


class SqliteTowerSource:
    synthetic = True

    def __init__(self, conn: sqlite3.Connection) -> None:
        self._conn = conn

    def _now(self) -> int:
        return clock.now_min(self._conn)

    def as_of(self) -> str:
        return clock.as_of(self._conn)

    def _point(self, row: sqlite3.Row) -> KpiPoint:
        prb, drop, thr = kpi_overlay.adjust(
            self._conn, row["enodeb_name"], row["t_min"], row["prb_util"], row["drop_rate"], row["throughput_mbps"]
        )
        return KpiPoint(
            t_min=row["t_min"],
            at=clock.iso_at(self._conn, row["t_min"]),
            prb_util=prb,
            drop_rate=drop,
            throughput_mbps=thr,
        )

    def get_tower(self, enodeb_name: str) -> TowerRecord | None:
        row: sqlite3.Row | None = self._conn.execute(
            "SELECT * FROM tower WHERE enodeb_name = ?", (enodeb_name,)
        ).fetchone()
        if row is None:
            return None
        cells = [
            r["cell_id"]
            for r in self._conn.execute("SELECT cell_id FROM cell WHERE enodeb_name = ? ORDER BY cell_id", (enodeb_name,))
        ]
        return TowerRecord(
            enodeb_name=row["enodeb_name"],
            site_id=row["site_id"],
            name=row["name"],
            town=row["town"],
            state=row["state"],
            lat=row["lat"],
            lng=row["lng"],
            tower_type=row["tower_type"],
            vendor=row["vendor"],
            firmware=row["firmware"],
            cells=cells,
        )

    def get_status(self, enodeb_name: str) -> StatusRecord | None:
        row = self._conn.execute(
            "SELECT status, battery_pct, mains_ok FROM tower_state "
            "WHERE enodeb_name = ? AND t_min <= ? ORDER BY t_min DESC LIMIT 1",
            (enodeb_name, self._now()),
        ).fetchone()
        if row is None:
            return None
        status = repairs.status(self._conn, enodeb_name, self._now(), row["status"])
        return StatusRecord(status=cast(TowerStatus, status), battery_pct=row["battery_pct"], mains_ok=bool(row["mains_ok"]))

    def get_neighbours(self, enodeb_name: str) -> list[NeighbourRecord]:
        return [
            NeighbourRecord(enodeb_name=r["neighbour_name"], distance_km=r["distance_km"])
            for r in self._conn.execute(
                "SELECT neighbour_name, distance_km FROM tower_neighbour WHERE enodeb_name = ? ORDER BY distance_km",
                (enodeb_name,),
            )
        ]

    def latest_kpi(self, enodeb_name: str) -> KpiPoint | None:
        now = self._now()
        row = self._conn.execute(
            "SELECT * FROM tower_kpi WHERE enodeb_name = ? AND t_min <= ? ORDER BY t_min DESC LIMIT 1",
            (enodeb_name, now),
        ).fetchone()
        point = self._point(row) if row else None
        # a repair after the last sample (the seeded KPIs end at a fixed minute) still shows the tower carrying traffic
        fixed = repairs.repaired_min(self._conn, enodeb_name, now)
        if fixed is not None and (point is None or (point.t_min < fixed and point.prb_util == point.throughput_mbps == 0)):
            prb, drop, thr = kpi_overlay.adjust(self._conn, enodeb_name, fixed, 0.0, 0.0, 0.0)
            return KpiPoint(t_min=fixed, at=clock.iso_at(self._conn, fixed), prb_util=prb, drop_rate=drop, throughput_mbps=thr)
        return point

    def kpi_window(self, enodeb_name: str, window_min: int) -> list[KpiPoint]:
        now = self._now()
        rows = self._conn.execute(
            "SELECT * FROM tower_kpi WHERE enodeb_name = ? AND t_min > ? AND t_min <= ? ORDER BY t_min",
            (enodeb_name, now - window_min, now),
        ).fetchall()
        return [self._point(r) for r in rows]

    def count_active_alarms(self, enodeb_name: str) -> int:
        now = self._now()
        rows = self._conn.execute(
            "SELECT raised_min FROM tower_alarm WHERE enodeb_name = :name AND raised_min <= :now "
            "AND (cleared_min IS NULL OR cleared_min > :now)",
            {"name": enodeb_name, "now": now},
        ).fetchall()
        return sum(1 for r in rows if repairs.alarm_cleared_min(self._conn, enodeb_name, now, r["raised_min"]) is None)

    def list_towers(
        self, min_lat: float, min_lng: float, max_lat: float, max_lng: float, status: str | None, limit: int
    ) -> list[TowerPin]:
        now = self._now()
        rows = self._conn.execute(
            "SELECT t.enodeb_name, t.site_id, t.town, t.state, t.lat, t.lng, "
            f"COALESCE({_STATE_AT}, 'UNKNOWN') AS status "
            "FROM tower t WHERE t.lat BETWEEN :min_lat AND :max_lat AND t.lng BETWEEN :min_lng AND :max_lng "
            "ORDER BY t.enodeb_name",
            {"now": now, "min_lat": min_lat, "max_lat": max_lat, "min_lng": min_lng, "max_lng": max_lng},
        ).fetchall()
        pins: list[TowerPin] = []
        for r in rows:
            pin = {k: r[k] for k in TowerPin.model_fields}
            if pin["status"] != "UNKNOWN":
                pin["status"] = repairs.status(self._conn, r["enodeb_name"], now, r["status"])
            if status is None or pin["status"] == status:
                pins.append(TowerPin(**pin))
            if len(pins) >= limit:
                break
        return pins

    def list_alarms(
        self, enodeb_name: str | None, severity: str | None, active_only: bool, limit: int
    ) -> list[Alarm]:
        now = self._now()
        rows = self._conn.execute(
            "SELECT * FROM tower_alarm WHERE raised_min <= :now "
            "AND (:name IS NULL OR enodeb_name = :name) AND (:severity IS NULL OR severity = :severity) "
            + ("AND (cleared_min IS NULL OR cleared_min > :now) " if active_only else "")
            + "ORDER BY CASE severity WHEN 'CRITICAL' THEN 0 WHEN 'MAJOR' THEN 1 WHEN 'MINOR' THEN 2 ELSE 3 END, "
            "raised_min DESC, alarm_id LIMIT :limit",
            {"now": now, "name": enodeb_name, "severity": severity, "limit": limit},
        ).fetchall()
        alarms: list[Alarm] = []
        for r in rows:
            cleared = r["cleared_min"]
            if cleared is None or cleared > now:
                # a repair (finished field job, reset of a hung cell) clears what the seed leaves open
                fixed = repairs.alarm_cleared_min(self._conn, r["enodeb_name"], now, r["raised_min"])
                cleared = fixed if fixed is not None else cleared
            active = cleared is None or cleared > now
            if active_only and not active:
                continue
            alarms.append(
                Alarm(
                    alarm_id=r["alarm_id"],
                    enodeb_name=r["enodeb_name"],
                    code=r["code"],
                    severity=r["severity"],
                    message=r["message"],
                    raised_at=clock.iso_at(self._conn, r["raised_min"]),
                    cleared_at=clock.iso_at(self._conn, cleared) if cleared is not None else None,
                    active=active,
                )
            )
        return alarms


class SqliteSourceFactory:
    """Opens a read-only connection to the seeded database for each tool call."""

    synthetic = True

    def __init__(self, db_path: Path) -> None:
        self._db_path = db_path

    @contextmanager
    def __call__(self) -> Iterator[TowerSource]:
        conn = connect(self._db_path)
        try:
            yield SqliteTowerSource(conn)
        finally:
            conn.close()
