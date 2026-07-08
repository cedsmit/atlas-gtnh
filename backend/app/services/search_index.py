"""Persistent block→chunks index for instant search.

Building the index scans every chunk of a dimension once (slow); after that,
lookups are indexed SQLite queries (instant). The index is keyed by the dimension
path and invalidated by a signature over its region files' names/mtimes/sizes, so
it rebuilds only when the world changes on disk.

DB location: ~/.atlas_gtnh/search_index.db
"""

import hashlib
import logging
import sqlite3
import threading
from contextlib import closing
from pathlib import Path

from app.models.search import SearchBlocksResponse, SearchHit
from app.world.region_reader import scan_region_all_blocks

log = logging.getLogger(__name__)

_DB_PATH = Path.home() / ".atlas_gtnh" / "search_index.db"

_init_lock = threading.Lock()
_initialized = False
# One build lock per dimension so concurrent searches don't rebuild in parallel.
_build_locks: dict[str, threading.Lock] = {}
_build_locks_guard = threading.Lock()

_DDL = """
CREATE TABLE IF NOT EXISTS chunk_blocks (
    dim      TEXT NOT NULL,
    cx       INTEGER NOT NULL,
    cz       INTEGER NOT NULL,
    block_id INTEGER NOT NULL,
    cnt      INTEGER NOT NULL,
    sx       INTEGER NOT NULL,
    sy       INTEGER NOT NULL,
    sz       INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dim_block ON chunk_blocks (dim, block_id);
CREATE TABLE IF NOT EXISTS dim_meta (dim TEXT PRIMARY KEY, signature TEXT NOT NULL);
"""


def _connect() -> sqlite3.Connection:
    global _initialized
    _DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(_DB_PATH), timeout=30)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    if not _initialized:
        with _init_lock:
            if not _initialized:
                for stmt in _DDL.strip().split(";"):
                    s = stmt.strip()
                    if s:
                        conn.execute(s)
                conn.commit()
                _initialized = True
    return conn


def _build_lock_for(dim: str) -> threading.Lock:
    with _build_locks_guard:
        lock = _build_locks.get(dim)
        if lock is None:
            lock = threading.Lock()
            _build_locks[dim] = lock
        return lock


def _region_dir(dimension_path: str) -> Path:
    return Path(dimension_path) / "region"


def _dim_signature(dimension_path: str) -> str:
    """A hash over the dimension's region files (name/mtime/size). Changes when any
    region file is added, removed, or modified — triggering a rebuild."""
    region_dir = _region_dir(dimension_path)
    if not region_dir.is_dir():
        return ""
    h = hashlib.sha1()
    for f in sorted(region_dir.glob("*.mca")):
        st = f.stat()
        h.update(f"{f.name}:{int(st.st_mtime)}:{st.st_size};".encode())
    return h.hexdigest()


def _is_fresh(conn: sqlite3.Connection, dim: str, sig: str) -> bool:
    row = conn.execute("SELECT signature FROM dim_meta WHERE dim = ?", (dim,)).fetchone()
    return bool(row) and row[0] == sig


def build_index(dimension_path: str) -> None:
    """(Re)build the index for a dimension. Expensive — scans every chunk once."""
    region_dir = _region_dir(dimension_path)
    if not region_dir.is_dir():
        raise FileNotFoundError(f"No region directory under {dimension_path}")
    sig = _dim_signature(dimension_path)
    with _build_lock_for(dimension_path):
        # Another thread may have finished the build while we waited for the lock.
        with closing(_connect()) as conn:
            if _is_fresh(conn, dimension_path, sig):
                return
        rows: list[tuple[str, int, int, int, int, int, int, int]] = []
        for region_file in sorted(region_dir.glob("*.mca")):
            for r in scan_region_all_blocks(region_file):
                rows.append((dimension_path, *r))
        log.info("search index: built %d rows for %s", len(rows), dimension_path)
        with closing(_connect()) as conn, conn:
            conn.execute("DELETE FROM chunk_blocks WHERE dim = ?", (dimension_path,))
            conn.executemany(
                "INSERT INTO chunk_blocks "
                "(dim, cx, cz, block_id, cnt, sx, sy, sz) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                rows,
            )
            conn.execute(
                "INSERT OR REPLACE INTO dim_meta (dim, signature) VALUES (?, ?)",
                (dimension_path, sig),
            )


def ensure_index(dimension_path: str) -> None:
    """Build the index if missing or stale; a no-op when already fresh (instant)."""
    sig = _dim_signature(dimension_path)
    with closing(_connect()) as conn:
        if _is_fresh(conn, dimension_path, sig):
            return
    build_index(dimension_path)


def query_index(
    dimension_path: str, block_ids: list[int], limit: int = 500
) -> SearchBlocksResponse:
    """Look up the chunks containing any of *block_ids* (index must be built)."""
    ids = sorted({int(b) for b in block_ids if 0 < int(b) < 65536})
    if not ids:
        return SearchBlocksResponse(
            hits=[], total_matches=0, hit_chunks=0, capped=False, block_ids=[]
        )
    placeholders = ",".join("?" * len(ids))
    with closing(_connect()) as conn:
        rows = conn.execute(
            "SELECT cx, cz, SUM(cnt), MIN(sx), MIN(sy), MIN(sz) "
            "FROM chunk_blocks "
            f"WHERE dim = ? AND block_id IN ({placeholders}) "
            "GROUP BY cx, cz ORDER BY SUM(cnt) DESC LIMIT ?",
            (dimension_path, *ids, limit + 1),
        ).fetchall()
    capped = len(rows) > limit
    rows = rows[:limit]
    hits = [SearchHit(cx=r[0], cz=r[1], count=r[2], x=r[3], y=r[4], z=r[5]) for r in rows]
    return SearchBlocksResponse(
        hits=hits,
        total_matches=sum(h.count for h in hits),
        hit_chunks=len(hits),
        capped=capped,
        block_ids=ids,
    )
