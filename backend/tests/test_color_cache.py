import sqlite3
from contextlib import closing
from pathlib import Path

import pytest

from app.services import color_cache


def test_batch_source_lookup_uses_one_connection_and_keeps_first_jar(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setattr(color_cache, "_DB_PATH", tmp_path / "colors.db")
    monkeypatch.setattr(color_cache, "_initialized", False)

    with closing(color_cache._connect()) as conn, conn:
        rows = [
            ("mod:a", "z.jar", 1.0, 1, 2, 3),
            ("mod:a", "a.jar", 1.0, 1, 2, 3),
            ("mod:b", "b.jar", 1.0, 1, 2, 3),
        ]
        conn.executemany(
            "INSERT INTO texture_colors "
            "(registry_name, source_jar, jar_mtime, avg_r, avg_g, avg_b) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            rows,
        )

    original_connect = color_cache._connect
    connections = 0

    def counted_connect() -> sqlite3.Connection:
        nonlocal connections
        connections += 1
        return original_connect()

    monkeypatch.setattr(color_cache, "_connect", counted_connect)

    assert color_cache.get_texture_source_jars(["mod:b", "mod:a", "mod:a", "missing"]) == {
        "mod:a": "a.jar",
        "mod:b": "b.jar",
    }
    assert connections == 1
