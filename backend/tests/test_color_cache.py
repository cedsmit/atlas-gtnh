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

    a_jar = tmp_path / "a.jar"
    b_jar = tmp_path / "b.jar"
    z_jar = tmp_path / "z.jar"
    for jar in (a_jar, b_jar, z_jar):
        jar.touch()

    with closing(color_cache._connect()) as conn, conn:
        rows = [
            ("mod:a", str(z_jar), 1.0, 1, 2, 3),
            ("mod:a", str(a_jar), 1.0, 1, 2, 3),
            ("mod:b", str(b_jar), 1.0, 1, 2, 3),
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
        "mod:a": str(a_jar),
        "mod:b": str(b_jar),
    }
    assert connections == 1


def test_source_lookup_skips_and_prunes_dead_jars(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setattr(color_cache, "_DB_PATH", tmp_path / "colors.db")
    monkeypatch.setattr(color_cache, "_initialized", False)
    dead = tmp_path / "a-dead.jar"
    live = tmp_path / "z-live.jar"
    live.touch()

    with closing(color_cache._connect()) as conn, conn:
        conn.executemany(
            "INSERT INTO texture_colors "
            "(registry_name, source_jar, jar_mtime, avg_r, avg_g, avg_b) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            [
                ("mod:block", str(dead), 1.0, 1, 2, 3),
                ("mod:block", str(live), 1.0, 4, 5, 6),
            ],
        )
        conn.execute(
            "INSERT INTO json_assets "
            "(asset_type, asset_key, source_jar, jar_mtime, content) "
            "VALUES ('bs', 'mod:block', ?, 1.0, '{}')",
            (str(dead),),
        )

    assert color_cache.get_texture_source_jar("mod:block") == str(live)
    with closing(color_cache._connect()) as conn:
        assert (
            conn.execute(
                "SELECT COUNT(*) FROM texture_colors WHERE source_jar = ?", (str(dead),)
            ).fetchone()[0]
            == 0
        )
        assert (
            conn.execute(
                "SELECT COUNT(*) FROM json_assets WHERE source_jar = ?", (str(dead),)
            ).fetchone()[0]
            == 0
        )


def test_source_lookup_is_scoped_to_current_pack(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setattr(color_cache, "_DB_PATH", tmp_path / "colors.db")
    monkeypatch.setattr(color_cache, "_initialized", False)
    first = tmp_path / "first.jar"
    second = tmp_path / "second.jar"
    first.touch()
    second.touch()
    with closing(color_cache._connect()) as conn, conn:
        conn.executemany(
            "INSERT INTO texture_colors "
            "(registry_name, source_jar, jar_mtime, avg_r, avg_g, avg_b) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            [
                ("mod:block", str(first), 1.0, 1, 2, 3),
                ("mod:block", str(second), 1.0, 4, 5, 6),
            ],
        )

    assert color_cache.get_texture_source_jar("mod:block", [str(second)]) == str(second)
