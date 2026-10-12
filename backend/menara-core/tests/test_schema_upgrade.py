from __future__ import annotations

import sqlite3
from pathlib import Path

from menara_core.seed.schema import upgrade


def test_upgrade_adds_columns_an_older_db_lacks_once(tmp_path: Path) -> None:
    conn = sqlite3.connect(tmp_path / "old.db")
    conn.execute("CREATE TABLE ntt (seq INTEGER PRIMARY KEY, ntt_id TEXT)")  # the table before fault_began_min
    conn.execute("INSERT INTO ntt (ntt_id) VALUES ('NTT-0001')")
    assert upgrade(conn) == ["ntt.fault_began_min"]
    assert upgrade(conn) == []
    assert conn.execute("SELECT ntt_id, fault_began_min FROM ntt").fetchone() == ("NTT-0001", None)


def test_upgrade_leaves_a_db_without_the_table_alone(tmp_path: Path) -> None:
    conn = sqlite3.connect(tmp_path / "empty.db")
    assert upgrade(conn) == []
