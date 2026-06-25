"""SQLite-backed cache for texture scan results.

Stores per-JAR texture colors keyed by (source_jar, jar_mtime).  When a JAR
is unchanged the scan is skipped entirely — typical re-scans complete in
milliseconds instead of minutes.

DB location: ~/.atlas_gtnh/colors.db
"""

import sqlite3
from pathlib import Path

_DB_PATH = Path.home() / ".atlas_gtnh" / "colors.db"

# Bump this when the scan format changes to force a full rescan on next startup.
_SCAN_VERSION = 3  # bumped: texture keys now normalized to lowercase

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
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
CREATE INDEX IF NOT EXISTS idx_jar ON texture_colors (source_jar, jar_mtime);
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
                avg[0], avg[1], avg[2],
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
        pass
