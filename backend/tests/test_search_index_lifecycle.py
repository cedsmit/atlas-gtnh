import sqlite3
from contextlib import closing
from pathlib import Path

import pytest

from app.services import search_index


def _insert_dimension(conn: sqlite3.Connection, dim: str) -> None:
    conn.execute(
        "INSERT INTO chunk_blocks "
        "(dim, region, cx, cz, block_id, cnt, sx, sy, sz) "
        "VALUES (?, 'r.0.0.mca', 0, 0, 1, 1, 0, 64, 0)",
        (dim,),
    )
    conn.execute(
        "INSERT INTO chunk_biomes "
        "(dim, region, cx, cz, biome_id, cnt, sx, sz) "
        "VALUES (?, 'r.0.0.mca', 0, 0, 1, 256, 0, 0)",
        (dim,),
    )
    conn.execute("INSERT INTO dim_meta (dim, signature) VALUES (?, 'legacy')", (dim,))
    conn.execute(
        "INSERT INTO region_meta (dim, region, signature) VALUES (?, 'r.0.0.mca', 'current')",
        (dim,),
    )


def test_startup_prunes_missing_dimensions_and_keeps_existing_ones(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setattr(search_index, "_DB_PATH", tmp_path / "search_index.db")
    monkeypatch.setattr(search_index, "_initialized", False)
    monkeypatch.setattr(search_index, "_VACUUM_DELETE_THRESHOLD", 0)
    existing = tmp_path / "existing-dimension"
    existing.mkdir()
    missing = tmp_path / "deleted-dimension"

    with closing(search_index._connect()) as conn, conn:
        _insert_dimension(conn, str(existing))
        _insert_dimension(conn, str(missing))

    # A backend restart runs the one-time startup hygiene again.
    monkeypatch.setattr(search_index, "_initialized", False)
    with closing(search_index._connect()) as conn:
        for table in ("chunk_blocks", "chunk_biomes", "dim_meta", "region_meta"):
            assert (
                conn.execute(
                    f"SELECT COUNT(*) FROM {table} WHERE dim = ?", (str(missing),)
                ).fetchone()[0]
                == 0
            )
        assert (
            conn.execute(
                "SELECT COUNT(*) FROM chunk_blocks WHERE dim = ?", (str(existing),)
            ).fetchone()[0]
            == 1
        )
