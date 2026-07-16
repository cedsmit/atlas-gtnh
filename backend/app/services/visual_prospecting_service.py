"""Read GregTech ore veins cached by the Visual Prospecting mod.

Visual Prospecting scans the save and caches every GT ore vein it finds into
per-dimension NBT files, keyed by a world id. We read those directly — no ore
scanning or seed replication needed — and surface the veins for the map overlay.

Layout (a GTNH instance):
    <instance>/visualprospecting/server/<wId>/DIM<n>.dat   (dedicated server)
    <world>/visualprospecting/[server/]<wId>/DIM<n>.dat    (singleplayer variants)
where <wId> (e.g. ``World_<uuid>``) is read from
    <world>/data/visualprospecting.dat  ->  root.data.wId

Each DIM<n>.dat is gzipped NBT with an ``ores`` compound holding parallel arrays:
    palette:       List[String]  vein type names ("ore.mix.gold", ...)
    veinTypeIndex: IntArray      index into palette per vein
    chunkX/chunkZ: IntArray      vein chunk coords
    depleted:      ByteArray     1 once mined out
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

import nbtlib

from app.models.ore_veins import OreVein, OreVeinsResponse
from app.services.ore_vein_registry_service import (
    OreVeinRegistry,
    get_ore_vein_data,
)

# Offset (blocks) from the stored vein chunk to the marker anchor. A GT vein spans
# a 3×3 chunk area; the stored chunk's centre is a good-enough anchor and keeps the
# marker inside the vein. Tunable if markers ever read as offset from the ore.
_VEIN_ANCHOR = 8

_DIM_RE = re.compile(r"^DIM(-?\d+)$")


def _root_and_dim(dimension_path: str) -> tuple[Path, int | None]:
    """(world root, numeric dim id) from a dimension folder path.

    Overworld's path is the world root (has level.dat) → dim 0. Other dimensions
    are ``<root>/DIM<n>`` → the parent is the root and <n> the id. A non-DIM modded
    folder has no VP file, so its id is None.
    """
    p = Path(dimension_path)
    if (p / "level.dat").is_file():
        return p, 0
    m = _DIM_RE.match(p.name)
    return p.parent, (int(m.group(1)) if m else None)


def _unnamed_get(nbt: Any, key: str) -> Any:
    """Read a key from an NBT root, tolerating the common unnamed-root compound."""
    val = nbt.get(key)
    if val is not None:
        return val
    root = nbt.get("")
    return root.get(key) if root is not None else None


def _read_world_id(world_root: Path) -> str | None:
    f = world_root / "data" / "visualprospecting.dat"
    if not f.is_file():
        return None
    try:
        nbt = nbtlib.load(str(f))
        data = _unnamed_get(nbt, "data")
        # data may be missing or (in a corrupt/version-mismatched file) not a
        # compound, so guard the .get — a bad file should read as "no VP", not 500.
        wid = data.get("wId") if hasattr(data, "get") else None
        return str(wid) if wid is not None else None
    except Exception:
        return None


def _find_dim_file(world_root: Path, wid: str, dim: int) -> Path | None:
    """Locate DIM<n>.dat across the server/singleplayer VP layouts (first hit wins)."""
    name = f"DIM{dim}.dat"
    for base in [world_root, *world_root.parents][:4]:
        vp = base / "visualprospecting"
        if not vp.is_dir():
            continue
        for cand in (vp / "server" / wid / name, vp / wid / name, vp / "client" / wid / name):
            if cand.is_file():
                return cand
    return None


def _parse_veins(path: Path, registry: OreVeinRegistry) -> list[OreVein]:
    nbt = nbtlib.load(str(path))
    ores = _unnamed_get(nbt, "ores")
    if ores is None or "palette" not in ores:
        return []
    palette = [str(s) for s in ores["palette"]]
    cxs = [int(v) for v in ores.get("chunkX", [])]
    czs = [int(v) for v in ores.get("chunkZ", [])]
    types = [int(v) for v in ores.get("veinTypeIndex", [])]
    depleted = [int(v) for v in ores.get("depleted", [])]
    n = min(len(cxs), len(czs), len(types))
    veins: list[OreVein] = []
    for i in range(n):
        ti = types[i]
        kind = palette[ti] if 0 <= ti < len(palette) else "unknown"
        info = registry.get(kind)  # real GTNH name + material colour, if known
        veins.append(
            OreVein(
                x=cxs[i] * 16 + _VEIN_ANCHOR,
                z=czs[i] * 16 + _VEIN_ANCHOR,
                cx=cxs[i],
                cz=czs[i],
                kind=kind,
                depleted=bool(depleted[i]) if i < len(depleted) else False,
                name=info["name"] if info else None,
                rgb=info["rgb"] if info else None,
                texture=info["texture"] if info else None,
            )
        )
    return veins


def get_ore_veins(dimension_path: str) -> OreVeinsResponse:
    """Ore veins Visual Prospecting has cached for this dimension.

    ``available`` is False only when the world has no VP data at all; it stays True
    (with an empty list) when VP is present but this dimension isn't cached yet.
    """
    root, dim = _root_and_dim(dimension_path)
    # Read the world id first: `available` reflects whether the world has VP data
    # at all, independent of whether this particular dimension maps to a DIM<n>.dat.
    wid = _read_world_id(root)
    if wid is None:
        return OreVeinsResponse(available=False, veins=[])
    if dim is None:
        # A non-DIM modded dimension — VP has no file for it, but the world does
        # have VP data, so report available (with no veins) rather than "no data".
        return OreVeinsResponse(available=True, veins=[])
    dim_file = _find_dim_file(root, wid, dim)
    if dim_file is None:
        return OreVeinsResponse(available=True, veins=[])
    try:
        data = get_ore_vein_data(dimension_path)
        return OreVeinsResponse(
            available=True,
            veins=_parse_veins(dim_file, data.veins),
            sprites=data.sprites,
            sprites_precolored=data.precolored,
        )
    except Exception:
        return OreVeinsResponse(available=True, veins=[])
