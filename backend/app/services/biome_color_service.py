"""Biome grass/foliage colours from the AtlasDumper ``biome_dump.json``.

The AtlasDumper Forge mod writes ``{mc_dir}/config/atlas/biome_dump.json`` — each
biome's real ``getBiomeGrassColor()`` / ``getBiomeFoliageColor()`` (colormap
lookups plus any mod override, e.g. Biomes O' Plenty's fixed/perlin colours).
Serving these lets the map tint grass and foliage from ground truth instead of a
hardcoded temperature/rainfall table (which is wrong for most modded biomes).

Resolution mirrors the icon dump, most-specific first: ``ATLAS_BIOME_DUMP_PATH``
env → an instance's ``config/atlas/biome_dump.json`` (walking up from the world
folder) → ``~/.atlas_gtnh/biome_dump.json`` → the **canonical dump bundled with
Atlas** (``backend/app/data/biome_dump.json``).

Biome grass/foliage colours are deterministic for a given modpack build — the
same for every user — so we capture them once with the AtlasDumper mod and ship
that as the bundled default. This is what makes biome tint correct out of the box
with **no per-user export step**; the dumper is only a maintainer tool for
regenerating the bundled dataset when the pack changes. A per-instance dump still
wins when present, for power users or an exact build match.

Returns ``biome_id -> {grass, foliage}`` as [r, g, b]; empty only when no dump is
found at all (the frontend then falls back to its built-in table).
"""

from __future__ import annotations

import json
import os
from pathlib import Path

# biome_id -> {"grass": [r, g, b], "foliage": [r, g, b]}
BiomeColors = dict[int, dict[str, list[int]]]

_cache: dict[str, BiomeColors] = {}

# Canonical dump shipped with Atlas: backend/app/data/biome_dump.json
# (this file lives at backend/app/services/, so parent.parent is backend/app/).
_BUNDLED = Path(__file__).resolve().parent.parent / "data" / "biome_dump.json"


def _int_to_rgb(v: int) -> list[int]:
    return [(v >> 16) & 0xFF, (v >> 8) & 0xFF, v & 0xFF]


def _candidates(world_path: str) -> list[Path]:
    env = os.environ.get("ATLAS_BIOME_DUMP_PATH", "").strip()
    if env:
        return [Path(env), _BUNDLED]
    out: list[Path] = []
    p = Path(world_path)
    # The world usually sits inside an instance dir that also holds config/atlas/.
    for base in [p, *p.parents][:4]:
        out.append(base / "config" / "atlas" / "biome_dump.json")
    out.append(Path.home() / ".atlas_gtnh" / "biome_dump.json")
    out.append(_BUNDLED)  # ships with Atlas — the zero-setup default
    return out


def _parse(path: Path) -> BiomeColors:
    data = json.loads(path.read_text(encoding="utf-8"))
    result: BiomeColors = {}
    biomes = data.get("biomes", {})
    if not isinstance(biomes, dict):
        return {}
    for bid, entry in biomes.items():
        try:
            result[int(bid)] = {
                "grass": _int_to_rgb(int(entry["grass"])),
                "foliage": _int_to_rgb(int(entry["foliage"])),
            }
        except (KeyError, ValueError, TypeError):
            continue
    return result


def get_biome_colors(world_path: str) -> BiomeColors:
    """``biome_id -> {grass, foliage}`` as [r, g, b]; ``{}`` when no dump is found.

    Candidates are tried most-specific first; a missing, broken, or empty one is
    skipped so resolution falls through (a corrupt instance dump still yields the
    bundled default). A per-instance result is cached; the bundled default is not,
    so a real per-instance dump dropped in later still supersedes it without a
    restart.
    """
    cached = _cache.get(world_path)
    if cached:
        return cached
    for cand in _candidates(world_path):
        if not cand.exists():
            continue
        try:
            result = _parse(cand)
        except Exception:
            result = {}
        if not result:
            continue
        if cand != _BUNDLED:
            _cache[world_path] = result
        return result
    return {}
