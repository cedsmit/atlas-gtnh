"""SQLite-backed cache for texture scan results and JSON blockstate/model assets.

Stores per-JAR texture colors and JSON assets keyed by (source_jar, jar_mtime).
When a JAR is unchanged the scan is skipped entirely — typical re-scans complete
in milliseconds instead of minutes.

DB location: ~/.atlas_gtnh/colors.db
"""

import json
import logging
import sqlite3
from pathlib import Path
from typing import Any

log = logging.getLogger(__name__)

_DB_PATH = Path.home() / ".atlas_gtnh" / "colors.db"

# Bump this when the scan format changes to force a full rescan on next startup.
_SCAN_VERSION = 4  # bumped: now also caches blockstate + model JSON assets

_DDL = """
CREATE TABLE IF NOT EXISTS texture_colors (
    registry_name TEXT NOT NULL,
    source_jar    TEXT NOT NULL,
    jar_mtime     REAL NOT NULL,
    avg_r         INTEGER NOT NULL,
    avg_g         INTEGER NOT NULL,
    avg_b         INTEGER NOT NULL,
    dominant_r    INTEGER,
    dominant_g    INTEGER,
    dominant_b    INTEGER,
    PRIMARY KEY (registry_name, source_jar)
);
CREATE TABLE IF NOT EXISTS json_assets (
    asset_type  TEXT NOT NULL,
    asset_key   TEXT NOT NULL,
    source_jar  TEXT NOT NULL,
    jar_mtime   REAL NOT NULL,
    content     TEXT NOT NULL,
    PRIMARY KEY (asset_type, asset_key, source_jar)
);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
CREATE INDEX IF NOT EXISTS idx_jar ON texture_colors (source_jar, jar_mtime);
CREATE INDEX IF NOT EXISTS idx_json_jar ON json_assets (source_jar, jar_mtime);
"""


def _connect() -> sqlite3.Connection:
    _DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(_DB_PATH), timeout=10)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    for stmt in _DDL.strip().split(";"):
        s = stmt.strip()
        if s:
            conn.execute(s)
    conn.commit()
    # If the scan format changed, wipe cached results so JARs are rescanned.
    try:
        row = conn.execute("SELECT value FROM meta WHERE key='scan_version'").fetchone()
        stored = int(row[0]) if row else 0
        if stored < _SCAN_VERSION:
            conn.execute("DELETE FROM texture_colors")
            try:
                conn.execute("DELETE FROM json_assets")
            except Exception:
                pass
            conn.execute(
                "INSERT OR REPLACE INTO meta (key, value) VALUES ('scan_version', ?)",
                (str(_SCAN_VERSION),),
            )
            conn.commit()
    except Exception:
        pass
    return conn


def load_jar_colors(
    jar_path: Path,
) -> dict[str, tuple[int, int, int]] | None:
    """Return cached dominant (avg as fallback) colors for *jar_path* if mtime matches."""
    try:
        mtime = jar_path.stat().st_mtime
        with _connect() as conn:
            rows = conn.execute(
                "SELECT registry_name,"
                "  COALESCE(dominant_r, avg_r),"
                "  COALESCE(dominant_g, avg_g),"
                "  COALESCE(dominant_b, avg_b) "
                "FROM texture_colors WHERE source_jar = ? AND jar_mtime = ?",
                (str(jar_path), mtime),
            ).fetchall()
        if not rows:
            return None
        return {row[0]: (row[1], row[2], row[3]) for row in rows}
    except Exception:
        log.warning("color cache: failed to load colors for %s", jar_path, exc_info=True)
        return None


def get_texture_source_jar(texture_key: str) -> str | None:
    """Return the source JAR path for *texture_key*, or None if not in cache."""
    try:
        with _connect() as conn:
            row = conn.execute(
                "SELECT source_jar FROM texture_colors WHERE registry_name = ? LIMIT 1",
                (texture_key,),
            ).fetchone()
        return row[0] if row else None
    except Exception:
        log.warning("color cache: failed to look up source jar for %s", texture_key, exc_info=True)
        return None


def save_jar_colors(
    jar_path: Path,
    colors: dict[str, tuple[tuple[int, int, int], tuple[int, int, int] | None]],
) -> None:
    """
    Persist *colors* for *jar_path*.

    *colors* maps registry_name → (avg_rgb, dominant_rgb | None).
    Deletes any existing records for this JAR before inserting.
    """
    try:
        mtime = jar_path.stat().st_mtime
        jar_str = str(jar_path)
        rows = [
            (
                name,
                jar_str,
                mtime,
                avg[0],
                avg[1],
                avg[2],
                dom[0] if dom else None,
                dom[1] if dom else None,
                dom[2] if dom else None,
            )
            for name, (avg, dom) in colors.items()
        ]
        with _connect() as conn:
            conn.execute("DELETE FROM texture_colors WHERE source_jar = ?", (jar_str,))
            conn.executemany(
                "INSERT INTO texture_colors "
                "(registry_name, source_jar, jar_mtime, avg_r, avg_g, avg_b, "
                " dominant_r, dominant_g, dominant_b) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                rows,
            )
    except Exception:
        log.warning("color cache: failed to save colors for %s", jar_path, exc_info=True)


def load_jar_json_assets(
    jar_path: Path,
) -> tuple[dict[str, Any], dict[str, Any]] | None:
    """
    Return (blockstates, models) cached for *jar_path* if the mtime still matches.

    Returns None when the JAR hasn't been scanned yet (caller should rescan).
    Returns ({}, {}) when the JAR was scanned but contained no JSON assets.
    """
    try:
        mtime = jar_path.stat().st_mtime
        jar_str = str(jar_path)
        with _connect() as conn:
            rows = conn.execute(
                "SELECT asset_type, asset_key, content FROM json_assets "
                "WHERE source_jar = ? AND jar_mtime = ?",
                (jar_str, mtime),
            ).fetchall()
        if not rows:
            return None  # Not cached — caller must scan
        blockstates: dict[str, Any] = {}
        models: dict[str, Any] = {}
        for asset_type, key, content_str in rows:
            if asset_type == "_sentinel":
                continue  # JAR was scanned but had no JSON assets
            try:
                parsed = json.loads(content_str)
            except Exception:
                continue
            if asset_type == "bs":
                blockstates[key] = parsed
            elif asset_type == "m":
                models[key] = parsed
        return blockstates, models
    except Exception:
        log.warning("color cache: failed to load JSON assets for %s", jar_path, exc_info=True)
        return None


def save_jar_json_assets(
    jar_path: Path,
    blockstates: dict[str, Any],
    models: dict[str, Any],
) -> None:
    """
    Persist blockstate and model JSON assets for *jar_path*.

    Inserts a sentinel record when both dicts are empty so subsequent startups
    know this JAR was already scanned and don't re-open it.
    """
    try:
        mtime = jar_path.stat().st_mtime
        jar_str = str(jar_path)
        rows: list[tuple[str, str, str, float, str]] = []
        for key, val in blockstates.items():
            rows.append(("bs", key, jar_str, mtime, json.dumps(val, separators=(",", ":"))))
        for key, val in models.items():
            rows.append(("m", key, jar_str, mtime, json.dumps(val, separators=(",", ":"))))
        if not rows:
            rows.append(("_sentinel", "_empty", jar_str, mtime, "{}"))
        with _connect() as conn:
            conn.execute("DELETE FROM json_assets WHERE source_jar = ?", (jar_str,))
            conn.executemany(
                "INSERT OR REPLACE INTO json_assets "
                "(asset_type, asset_key, source_jar, jar_mtime, content) "
                "VALUES (?, ?, ?, ?, ?)",
                rows,
            )
    except Exception:
        log.warning("color cache: failed to save JSON assets for %s", jar_path, exc_info=True)
