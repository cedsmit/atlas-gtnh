"""SQLite-backed cache for texture scan results and JSON blockstate/model assets.

Stores per-JAR texture colors and JSON assets keyed by (source_jar, jar_mtime).
When a JAR is unchanged the scan is skipped entirely — typical re-scans complete
in milliseconds instead of minutes.

DB location: ~/.atlas_gtnh/colors.db
"""

import json
import logging
import sqlite3
import threading
from collections.abc import Collection
from contextlib import closing
from pathlib import Path
from typing import Any

log = logging.getLogger(__name__)

_DB_PATH = Path.home() / ".atlas_gtnh" / "colors.db"

# Schema DDL and the scan-version wipe are one-time-per-process work. Guarding
# them behind a flag keeps _connect() cheap on the hot path (a cold scan opens a
# fresh connection per JAR), while the lock makes init safe across the worker
# threads that asyncio.to_thread spins up.
_init_lock = threading.Lock()
_initialized = False

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


def _initialize(conn: sqlite3.Connection) -> None:
    """Create the schema and apply the scan-version wipe. Runs once per process."""
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


def _connect() -> sqlite3.Connection:
    """Open a connection, initializing the schema on the first call per process.

    Callers own the returned connection and must close it — use
    ``with closing(_connect()) as conn:``.
    """
    global _initialized
    _DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(_DB_PATH), timeout=10)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    if not _initialized:
        with _init_lock:
            if not _initialized:
                _initialize(conn)
                _initialized = True
    return conn


def load_jar_colors(
    jar_path: Path,
) -> dict[str, tuple[int, int, int]] | None:
    """Return cached dominant (avg as fallback) colors for *jar_path* if mtime matches."""
    try:
        mtime = jar_path.stat().st_mtime
        with closing(_connect()) as conn:
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


def get_texture_source_jar(
    texture_key: str, allowed_source_jars: Collection[str] | None = None
) -> str | None:
    """Return the first live source JAR for *texture_key* in the active pack."""
    return get_texture_source_jars([texture_key], allowed_source_jars).get(texture_key)


def get_texture_source_jars(
    texture_keys: list[str], allowed_source_jars: Collection[str] | None = None
) -> dict[str, str]:
    """Return one live source JAR per cached texture key using one connection.

    Restrict candidates to the current world's JAR set when supplied. Missing
    JARs are skipped in favour of the next candidate and pruned from both cache
    tables so they cannot poison future lookups.
    """
    if not texture_keys:
        return {}

    unique_keys = list(dict.fromkeys(texture_keys))
    allowed = set(allowed_source_jars) if allowed_source_jars is not None else None
    if allowed is not None and not allowed:
        return {}
    result: dict[str, str] = {}
    dead_jars: set[str] = set()
    existence: dict[str, bool] = {}
    try:
        with closing(_connect()) as conn:
            # Stay below SQLite builds whose host-parameter limit is 999.
            for start in range(0, len(unique_keys), 900):
                batch = unique_keys[start : start + 900]
                placeholders = ",".join("?" for _ in batch)
                rows = conn.execute(
                    "SELECT registry_name, source_jar FROM texture_colors "
                    f"WHERE registry_name IN ({placeholders}) "
                    "ORDER BY registry_name, source_jar",
                    batch,
                ).fetchall()
                for registry_name, source_jar in rows:
                    if allowed is not None and source_jar not in allowed:
                        continue
                    exists = existence.get(source_jar)
                    if exists is None:
                        exists = Path(source_jar).is_file()
                        existence[source_jar] = exists
                    if not exists:
                        dead_jars.add(source_jar)
                        continue
                    result.setdefault(registry_name, source_jar)
            if dead_jars:
                conn.executemany(
                    "DELETE FROM texture_colors WHERE source_jar = ?",
                    ((jar,) for jar in dead_jars),
                )
                conn.executemany(
                    "DELETE FROM json_assets WHERE source_jar = ?",
                    ((jar,) for jar in dead_jars),
                )
                conn.commit()
                log.info("color cache: pruned %d missing source JARs", len(dead_jars))
    except Exception:
        log.warning("color cache: failed to batch-look up source jars", exc_info=True)
        return {}
    return result


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
        with closing(_connect()) as conn, conn:
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
        with closing(_connect()) as conn:
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
        with closing(_connect()) as conn, conn:
            conn.execute("DELETE FROM json_assets WHERE source_jar = ?", (jar_str,))
            conn.executemany(
                "INSERT OR REPLACE INTO json_assets "
                "(asset_type, asset_key, source_jar, jar_mtime, content) "
                "VALUES (?, ?, ?, ?, ?)",
                rows,
            )
    except Exception:
        log.warning("color cache: failed to save JSON assets for %s", jar_path, exc_info=True)
