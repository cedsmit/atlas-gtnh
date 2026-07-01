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
from pathlib import Path

from app.world.region_writer import (
    backup_region,
    local_index,
    read_region_records,
    write_region_records,
)

log = logging.getLogger(__name__)

_RE_REGION = re.compile(r"r\.(-?\d+)\.(-?\d+)\.mca$")


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


def copy_chunks(src_dim: str, dst_dim: str, chunks: list[tuple[int, int]]) -> dict[str, object]:
    """Copy *chunks* from *src_dim* to *dst_dim* at the same coordinates.

    Byte-exact transplant of the compressed region record (preserves GTNH
    Blocks16/Data16 sections, tile entities, etc.). Missing source chunks are
    skipped and counted. Destination region files are created as needed.
    """
    src_dir = Path(src_dim) / "region"
    dst_dir = Path(dst_dim) / "region"
    if src_dir.resolve() == dst_dir.resolve():
        raise ValueError("source and destination are the same world/dimension")

    copied = missing = 0
    touched: list[str] = []

    for (rx, rz), group in _group_by_region(chunks).items():
        src_records = read_region_records(src_dir / f"r.{rx}.{rz}.mca")
        if not src_records:
            missing += len(group)
            continue
        dst_path = dst_dir / f"r.{rx}.{rz}.mca"
        dst_records = read_region_records(dst_path)
        changed = False
        for cx, cz in group:
            idx = local_index(cx % 32, cz % 32)
            rec = src_records.get(idx)
            if rec is None:
                missing += 1
                continue
            dst_records[idx] = rec
            copied += 1
            changed = True
        if changed:
            backup_region(dst_path)  # no-op if the dest region is brand new
            write_region_records(dst_path, dst_records)
            touched.append(dst_path.name)
            log.info("copy_chunks: wrote %d chunks into %s", len(group), dst_path.name)

    return {"copied": copied, "missing": missing, "regions": touched}
