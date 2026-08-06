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
import statistics
import threading
from collections.abc import Callable
from contextlib import closing
from pathlib import Path

from app.models.search import BiomePresence, SearchBlocksResponse, SearchHit
from app.world.region_reader import (
    scan_region_all_biomes,
    scan_region_all_blocks,
    scan_region_search_data,
)

log = logging.getLogger(__name__)

_DB_PATH = Path.home() / ".atlas_gtnh" / "search_index.db"

# Bumped when the index schema/content changes so existing DBs rebuild. v2 added
# the chunk_biomes table (biome search); v3 fixed biome extraction for the modded
# 16-bit Biomes16v2 format (v2 indexed 0 biomes on those worlds).
_INDEX_VERSION = "v4"
_VACUUM_DELETE_THRESHOLD = 100_000


class IndexBuildCancelled(Exception):
    """Raised cooperatively between region scans."""


ProgressCallback = Callable[[int, int], None]
CancelCallback = Callable[[], bool]

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
CREATE TABLE IF NOT EXISTS chunk_biomes (
    dim      TEXT NOT NULL,
    cx       INTEGER NOT NULL,
    cz       INTEGER NOT NULL,
    biome_id INTEGER NOT NULL,
    cnt      INTEGER NOT NULL,
    sx       INTEGER NOT NULL,
    sz       INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dim_biome ON chunk_biomes (dim, biome_id);
CREATE TABLE IF NOT EXISTS dim_meta (dim TEXT PRIMARY KEY, signature TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS region_meta (
    dim TEXT NOT NULL, region TEXT NOT NULL, signature TEXT NOT NULL,
    PRIMARY KEY (dim, region)
);
"""


def _prune_stale_dimensions(conn: sqlite3.Connection) -> int:
    """Delete every indexed dimension whose directory no longer exists."""
    dimensions = {
        str(row[0])
        for row in conn.execute(
            "SELECT dim FROM dim_meta "
            "UNION SELECT dim FROM region_meta "
            "UNION SELECT dim FROM chunk_blocks "
            "UNION SELECT dim FROM chunk_biomes"
        )
    }
    stale = sorted(dim for dim in dimensions if not Path(dim).is_dir())
    if not stale:
        return 0

    before = conn.total_changes
    for dim in stale:
        conn.execute("DELETE FROM chunk_blocks WHERE dim = ?", (dim,))
        conn.execute("DELETE FROM chunk_biomes WHERE dim = ?", (dim,))
        conn.execute("DELETE FROM region_meta WHERE dim = ?", (dim,))
        conn.execute("DELETE FROM dim_meta WHERE dim = ?", (dim,))
    deleted = conn.total_changes - before
    log.info("search index: pruned %d stale dimensions (%d rows)", len(stale), deleted)
    return deleted


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
                for table in ("chunk_blocks", "chunk_biomes"):
                    columns = {r[1] for r in conn.execute(f"PRAGMA table_info({table})")}
                    if "region" not in columns:
                        conn.execute(f"ALTER TABLE {table} ADD COLUMN region TEXT")
                conn.execute(
                    "CREATE INDEX IF NOT EXISTS idx_blocks_dim_region ON chunk_blocks (dim, region)"
                )
                conn.execute(
                    "CREATE INDEX IF NOT EXISTS idx_biomes_dim_region ON chunk_biomes (dim, region)"
                )
                conn.commit()
                deleted = _prune_stale_dimensions(conn)
                conn.commit()
                if deleted >= _VACUUM_DELETE_THRESHOLD:
                    # Plain VACUUM is intentional: incremental_vacuum is a no-op
                    # for existing DBs that were not created with auto_vacuum.
                    conn.execute("VACUUM")
                    log.info("search index: reclaimed pages after stale-dimension pruning")
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
    # Prefix the index version so a schema change (e.g. adding chunk_biomes)
    # invalidates old indexes and triggers a one-time rebuild.
    return f"{_INDEX_VERSION}:{h.hexdigest()}"


def _is_fresh(conn: sqlite3.Connection, dim: str, sig: str) -> bool:
    row = conn.execute("SELECT signature FROM dim_meta WHERE dim = ?", (dim,)).fetchone()
    return bool(row) and row[0] == sig


def _legacy_build_index(dimension_path: str) -> None:
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
        biome_rows: list[tuple[str, int, int, int, int, int, int]] = []
        for region_file in sorted(region_dir.glob("*.mca")):
            for r in scan_region_all_blocks(region_file):
                rows.append((dimension_path, *r))
            for br in scan_region_all_biomes(region_file):
                biome_rows.append((dimension_path, *br))
        log.info(
            "search index: built %d block + %d biome rows for %s",
            len(rows),
            len(biome_rows),
            dimension_path,
        )
        with closing(_connect()) as conn, conn:
            conn.execute("DELETE FROM chunk_blocks WHERE dim = ?", (dimension_path,))
            conn.executemany(
                "INSERT INTO chunk_blocks "
                "(dim, cx, cz, block_id, cnt, sx, sy, sz) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                rows,
            )
            conn.execute("DELETE FROM chunk_biomes WHERE dim = ?", (dimension_path,))
            conn.executemany(
                "INSERT INTO chunk_biomes "
                "(dim, cx, cz, biome_id, cnt, sx, sz) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                biome_rows,
            )
            conn.execute(
                "INSERT OR REPLACE INTO dim_meta (dim, signature) VALUES (?, ?)",
                (dimension_path, sig),
            )


def _legacy_ensure_index(dimension_path: str) -> None:
    """Build the index if missing or stale; a no-op when already fresh (instant)."""
    sig = _dim_signature(dimension_path)
    with closing(_connect()) as conn:
        if _is_fresh(conn, dimension_path, sig):
            return
    _legacy_build_index(dimension_path)


def _region_signatures(dimension_path: str) -> dict[str, str]:
    region_dir = _region_dir(dimension_path)
    if not region_dir.is_dir():
        return {}
    result: dict[str, str] = {}
    for path in sorted(region_dir.glob("*.mca")):
        stat = path.stat()
        result[path.name] = f"{_INDEX_VERSION}:{stat.st_mtime_ns}:{stat.st_size}"
    return result


def build_index(
    dimension_path: str,
    progress: ProgressCallback | None = None,
    cancelled: CancelCallback | None = None,
) -> None:
    """Update changed regions atomically, retaining the old index on cancellation."""
    region_dir = _region_dir(dimension_path)
    if not region_dir.is_dir():
        raise FileNotFoundError(f"No region directory under {dimension_path}")
    with _build_lock_for(dimension_path):
        current = _region_signatures(dimension_path)
        with closing(_connect()) as conn:
            stored = dict(
                conn.execute(
                    "SELECT region, signature FROM region_meta WHERE dim = ?", (dimension_path,)
                )
            )
        # A database created before per-region metadata was introduced has no
        # rows in ``region_meta``.  Treat it as legacy even for an empty region
        # directory so stale rows are removed when a world is deleted/cleared.
        legacy = not stored
        changed = (
            sorted(current)
            if legacy
            else sorted(name for name, sig in current.items() if stored.get(name) != sig)
        )
        removed = sorted(set(stored) - set(current))
        total = len(changed) + len(removed)
        if legacy and not current:
            with closing(_connect()) as conn:
                conn.execute("DELETE FROM chunk_blocks WHERE dim = ?", (dimension_path,))
                conn.execute("DELETE FROM chunk_biomes WHERE dim = ?", (dimension_path,))
                conn.execute("DELETE FROM dim_meta WHERE dim = ?", (dimension_path,))
                conn.commit()
            if progress:
                progress(0, 0)
            return
        if total == 0:
            if progress:
                progress(0, 0)
            return

        done = 0
        with closing(_connect()) as conn:
            try:
                conn.execute("BEGIN IMMEDIATE")
                if legacy:
                    conn.execute("DELETE FROM chunk_blocks WHERE dim = ?", (dimension_path,))
                    conn.execute("DELETE FROM chunk_biomes WHERE dim = ?", (dimension_path,))
                for region in removed:
                    if cancelled and cancelled():
                        raise IndexBuildCancelled
                    conn.execute(
                        "DELETE FROM chunk_blocks WHERE dim = ? AND region = ?",
                        (dimension_path, region),
                    )
                    conn.execute(
                        "DELETE FROM chunk_biomes WHERE dim = ? AND region = ?",
                        (dimension_path, region),
                    )
                    conn.execute(
                        "DELETE FROM region_meta WHERE dim = ? AND region = ?",
                        (dimension_path, region),
                    )
                    done += 1
                    if progress:
                        progress(done, total)
                for region in changed:
                    if cancelled and cancelled():
                        raise IndexBuildCancelled
                    blocks, biomes = scan_region_search_data(region_dir / region)
                    if cancelled and cancelled():
                        raise IndexBuildCancelled
                    conn.execute(
                        "DELETE FROM chunk_blocks WHERE dim = ? AND region = ?",
                        (dimension_path, region),
                    )
                    conn.execute(
                        "DELETE FROM chunk_biomes WHERE dim = ? AND region = ?",
                        (dimension_path, region),
                    )
                    conn.executemany(
                        "INSERT INTO chunk_blocks "
                        "(dim, region, cx, cz, block_id, cnt, sx, sy, sz) "
                        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                        ((dimension_path, region, *row) for row in blocks),
                    )
                    conn.executemany(
                        "INSERT INTO chunk_biomes "
                        "(dim, region, cx, cz, biome_id, cnt, sx, sz) "
                        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                        ((dimension_path, region, *row) for row in biomes),
                    )
                    conn.execute(
                        "INSERT OR REPLACE INTO region_meta (dim, region, signature) "
                        "VALUES (?, ?, ?)",
                        (dimension_path, region, current[region]),
                    )
                    done += 1
                    if progress:
                        progress(done, total)
                conn.execute("DELETE FROM dim_meta WHERE dim = ?", (dimension_path,))
                conn.commit()
            except BaseException:
                conn.rollback()
                raise


def ensure_index(
    dimension_path: str,
    progress: ProgressCallback | None = None,
    cancelled: CancelCallback | None = None,
) -> None:
    build_index(dimension_path, progress, cancelled)


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


def query_biomes(
    dimension_path: str, biome_ids: list[int], limit: int = 500
) -> SearchBlocksResponse:
    """Look up the chunks containing any of *biome_ids* (index must be built).

    Biomes are 2D, so hits carry no meaningful Y — it's reported as a nominal
    surface level (64). ``count`` is the number of matching columns in the chunk.
    """
    ids = sorted({int(b) for b in biome_ids if 0 <= int(b) < 65536})
    if not ids:
        return SearchBlocksResponse(
            hits=[], total_matches=0, hit_chunks=0, capped=False, block_ids=[]
        )
    placeholders = ",".join("?" * len(ids))
    with closing(_connect()) as conn:
        rows = conn.execute(
            "SELECT cx, cz, SUM(cnt), MIN(sx), MIN(sz) "
            "FROM chunk_biomes "
            f"WHERE dim = ? AND biome_id IN ({placeholders}) "
            "GROUP BY cx, cz ORDER BY SUM(cnt) DESC LIMIT ?",
            (dimension_path, *ids, limit + 1),
        ).fetchall()
    capped = len(rows) > limit
    rows = rows[:limit]
    hits = [SearchHit(cx=r[0], cz=r[1], count=r[2], x=r[3], y=64, z=r[4]) for r in rows]
    return SearchBlocksResponse(
        hits=hits,
        total_matches=sum(h.count for h in hits),
        hit_chunks=len(hits),
        capped=capped,
        block_ids=ids,
    )


def biomes_present(dimension_path: str) -> list[BiomePresence]:
    """The distinct biomes that occur in a dimension, most-widespread first.

    Lets the UI list only the biomes actually in this world (not every biome the
    pack registers), each with its area (columns) and chunk spread.
    """
    with closing(_connect()) as conn:
        rows = conn.execute(
            "SELECT biome_id, SUM(cnt), COUNT(*) "
            "FROM chunk_biomes WHERE dim = ? "
            "GROUP BY biome_id ORDER BY SUM(cnt) DESC",
            (dimension_path,),
        ).fetchall()
    return [BiomePresence(biome_id=r[0], columns=r[1], chunks=r[2]) for r in rows]


def chunk_stats(
    dimension_path: str, metric: str, block_ids: list[int] | None = None
) -> list[tuple[int, int, int]]:
    """Per-chunk (cx, cz, value) over the index, for a heatmap overlay.

    metric 'variety' = distinct block types per chunk (built areas score high);
    metric 'density' = total count of *block_ids* per chunk (where those blocks are).
    """
    with closing(_connect()) as conn:
        if metric == "density" and block_ids:
            ids = sorted({int(b) for b in block_ids if 0 < int(b) < 65536})
            if not ids:
                return []
            placeholders = ",".join("?" * len(ids))
            rows = conn.execute(
                "SELECT cx, cz, SUM(cnt) FROM chunk_blocks "
                f"WHERE dim = ? AND block_id IN ({placeholders}) GROUP BY cx, cz",
                (dimension_path, *ids),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT cx, cz, COUNT(DISTINCT block_id) FROM chunk_blocks "
                "WHERE dim = ? GROUP BY cx, cz",
                (dimension_path,),
            ).fetchall()
    cells = [(int(r[0]), int(r[1]), int(r[2])) for r in rows]
    if not cells:
        return []
    # Drop outlier chunks (some mods write chunks at garbage coords, e.g. ~-2^21)
    # so the heatmap's bounds stay sane — keep those within MAX_DIST of the median.
    max_dist = 4096  # chunks (~128 regions)
    mcx = statistics.median(c[0] for c in cells)
    mcz = statistics.median(c[1] for c in cells)
    return [c for c in cells if abs(c[0] - mcx) <= max_dist and abs(c[1] - mcz) <= max_dist]
