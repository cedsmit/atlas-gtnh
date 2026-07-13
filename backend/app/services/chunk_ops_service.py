"""Chunk-level save operations: copy chunks between saves, and delete chunks so
Minecraft regenerates them (with the real GT/GTNH worldgen) on next load.

Both mutate region files and therefore require the world to be **closed** in
Minecraft — the caller (UI) must enforce that. Writes go through region_writer,
which snapshots a ``.bak`` and writes atomically.

Paths here are *dimension* paths (the directory whose ``region/`` subfolder holds
the ``.mca`` files): the world root for the overworld, or ``<world>/DIMx``.
"""

from __future__ import annotations

import logging
import re
import shutil
from pathlib import Path

from app.world.chunk_transform import remap_chunk_record
from app.world.region_writer import (
    backup_region,
    local_index,
    read_region_records,
    write_region_records,
)
from app.world.session_lock import is_world_open

log = logging.getLogger(__name__)

_RE_REGION = re.compile(r"r\.(-?\d+)\.(-?\d+)\.mca$")
_WORLD_OPEN_MSG = "World is currently open in Minecraft — close it first, then try again."


def _ensure_closed(dim_path: str) -> None:
    """Raise if the world is loaded in Minecraft (writing it would corrupt it)."""
    if is_world_open(dim_path):
        raise PermissionError(_WORLD_OPEN_MSG)


def _group_by_region(chunks: list[tuple[int, int]]) -> dict[tuple[int, int], list[tuple[int, int]]]:
    by: dict[tuple[int, int], list[tuple[int, int]]] = {}
    for cx, cz in chunks:
        by.setdefault((cx >> 5, cz >> 5), []).append((cx, cz))
    return by


def delete_chunks(dim_path: str, chunks: list[tuple[int, int]]) -> dict[str, object]:
    """Remove *chunks* from their region files so Minecraft regenerates them.

    Returns counts of deleted vs. already-absent chunks and the region files
    touched. A missing region file means those chunks were never generated.
    """
    _ensure_closed(dim_path)
    region_dir = Path(dim_path) / "region"
    deleted = missing = 0
    touched: list[str] = []

    for (rx, rz), group in _group_by_region(chunks).items():
        path = region_dir / f"r.{rx}.{rz}.mca"
        records = read_region_records(path)
        if not records:
            missing += len(group)
            continue
        changed = False
        for cx, cz in group:
            idx = local_index(cx % 32, cz % 32)
            if idx in records:
                del records[idx]
                deleted += 1
                changed = True
            else:
                missing += 1
        if changed:
            backup_region(path)
            write_region_records(path, records)
            touched.append(path.name)
            log.info("delete_chunks: rewrote %s (%d remaining)", path.name, len(records))

    return {"deleted": deleted, "missing": missing, "regions": touched}


def delete_chunks_except(dim_path: str, keep: list[tuple[int, int]]) -> dict[str, object]:
    """Delete every generated chunk EXCEPT those in *keep* (the inverse of a
    selection) so Minecraft regenerates the rest. Scans every region file in the
    dimension. Very destructive — the caller must confirm strongly.
    """
    _ensure_closed(dim_path)
    region_dir = Path(dim_path) / "region"
    keep_set = {(int(cx), int(cz)) for cx, cz in keep}
    deleted = 0
    touched: list[str] = []
    if not region_dir.is_dir():
        return {"deleted": 0, "kept": len(keep_set), "regions": []}

    for path in sorted(region_dir.glob("*.mca")):
        m = _RE_REGION.search(path.name)
        if not m:
            continue
        rx, rz = int(m.group(1)), int(m.group(2))
        records = read_region_records(path)
        if not records:
            continue
        keep_local = {
            local_index(cx % 32, cz % 32)
            for (cx, cz) in keep_set
            if cx >> 5 == rx and cz >> 5 == rz
        }
        remove = [i for i in records if i not in keep_local]
        if not remove:
            continue
        for i in remove:
            del records[i]
        backup_region(path)
        write_region_records(path, records)
        deleted += len(remove)
        touched.append(path.name)
        log.info("delete-except %s: removed %d, kept %d", path.name, len(remove), len(records))

    return {"deleted": deleted, "kept": len(keep_set), "regions": touched}


def copy_chunks(
    src_dim: str,
    dst_dim: str,
    chunks: list[tuple[int, int]],
    offset: tuple[int, int] = (0, 0),
) -> dict[str, object]:
    """Copy *chunks* from *src_dim* to *dst_dim*, shifted by *offset* (dx, dz) chunks.

    With no offset the compressed record is transplanted byte-exact (preserves
    GTNH Blocks16/Data16, tile entities, etc.). With an offset the chunk NBT is
    remapped (xPos/zPos + TileEntity/Entity/TileTick positions). Same-world paste
    is allowed only when an offset is given. Missing source chunks are skipped.
    """
    dx, dz = offset
    src_dir = Path(src_dim) / "region"
    dst_dir = Path(dst_dim) / "region"
    same_world = src_dir.resolve() == dst_dir.resolve()
    if same_world and dx == 0 and dz == 0:
        raise ValueError("source and destination are the same location")
    _ensure_closed(dst_dim)  # only the destination is written

    # Pre-read every source region so a same-world offset paste reads the
    # originals, never chunks we've just written this call.
    src_cache: dict[tuple[int, int], dict[int, tuple[bytes, int]]] = {}
    for cx, cz in chunks:
        rk = (cx >> 5, cz >> 5)
        if rk not in src_cache:
            src_cache[rk] = read_region_records(src_dir / f"r.{rk[0]}.{rk[1]}.mca")

    # Group the writes by destination region (dest coord = source + offset).
    dst_groups: dict[tuple[int, int], list[tuple[int, int, int, int]]] = {}
    for cx, cz in chunks:
        dcx, dcz = cx + dx, cz + dz
        dst_groups.setdefault((dcx >> 5, dcz >> 5), []).append((cx, cz, dcx, dcz))

    dx_blocks, dz_blocks = dx * 16, dz * 16
    copied = missing = 0
    touched: list[str] = []

    for (drx, drz), items in dst_groups.items():
        dst_path = dst_dir / f"r.{drx}.{drz}.mca"
        dst_records = read_region_records(dst_path)
        changed = False
        for scx, scz, dcx, dcz in items:
            entry = src_cache[(scx >> 5, scz >> 5)].get(local_index(scx % 32, scz % 32))
            if entry is None:
                missing += 1
                continue
            record, ts = entry
            if dx or dz:
                record = remap_chunk_record(record, dcx, dcz, dx_blocks, dz_blocks)
            dst_records[local_index(dcx % 32, dcz % 32)] = (record, ts)
            copied += 1
            changed = True
        if changed:
            backup_region(dst_path)
            write_region_records(dst_path, dst_records)
            touched.append(dst_path.name)
            log.info("copy_chunks: wrote %d chunks into %s", len(items), dst_path.name)

    return {"copied": copied, "missing": missing, "regions": touched}


def create_world(
    src_dim: str,
    new_world_path: str,
    chunks: list[tuple[int, int]],
    offset: tuple[int, int] = (0, 0),
) -> dict[str, object]:
    """Create a new world at *new_world_path* seeded from the source world's
    level.dat (so seed + block-ID registry match), then paste *chunks* into it.

    The destination folder must not already exist or must be empty.
    """
    src_dim_p = Path(src_dim)
    if (src_dim_p / "level.dat").is_file():
        src_root, dim_sub = src_dim_p, ""  # overworld dimension == world root
    else:
        src_root, dim_sub = src_dim_p.parent, src_dim_p.name  # <world>/DIMx
    level_dat = src_root / "level.dat"
    if not level_dat.is_file():
        raise FileNotFoundError(f"level.dat not found for source world ({src_root})")

    new_root = Path(new_world_path)
    if new_root.exists() and any(new_root.iterdir()):
        raise ValueError(f"destination folder is not empty: {new_world_path}")
    new_root.mkdir(parents=True, exist_ok=True)
    shutil.copy2(level_dat, new_root / "level.dat")

    dst_dim = new_root / dim_sub if dim_sub else new_root
    result = copy_chunks(src_dim, str(dst_dim), chunks, offset)
    result["world"] = str(new_root)
    return result
