"""GregTech ore-vein registry (name + material colour) from ``ore_vein_dump.json``.

The AtlasDumper Forge mod writes ``ore_vein_dump.json`` — for each GregTech
``OreMixes`` entry: the Visual-Prospecting palette key (``ore.mix.X``), its
localized name, the representative material's RGB, its dimensions, and a
best-effort ore-texture key. Serving these lets the map label each cached vein
with its real GTNH name + material colour instead of a hashed placeholder.

Resolution mirrors the biome/icon dumps, most-specific first: ``ATLAS_ORE_VEIN_DUMP_PATH``
env → an instance's ``config/atlas/ore_vein_dump.json`` (walking up from the world
folder) → ``~/.atlas_gtnh/ore_vein_dump.json`` → the **canonical dump bundled with
Atlas** at ``backend/app/data/<major>/ore_vein_dump.json`` (GTNH major detected from
the world's ModList — see ``pack_version``).

The ore-mix registry is deterministic for a given pack build — identical for every
user — so we capture it once with the AtlasDumper and ship it as the bundled
default: zero-setup, correct out of the box. A per-instance dump still wins when
present. Returns ``ore.mix.X -> {name, rgb, texture}``; empty only when no dump is
found at all (the frontend then falls back to its built-in table).
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import NamedTuple, TypedDict

from app.services.pack_version import detect_gtnh_major, load_major_signatures

_DUMP_NAME = "ore_vein_dump.json"


class VeinInfo(TypedDict):
    name: str
    rgb: int  # 0xRRGGBB
    texture: (
        str | None
    )  # icon-name key into the sprites map, e.g. "gregtech:materialicons/METALLIC/ore"


# ore.mix.X -> VeinInfo
OreVeinRegistry = dict[str, VeinInfo]


class OreVeinData(NamedTuple):
    """A parsed ore-vein dump: the per-vein registry + the shared sprite atlas.

    ``sprites`` maps an icon name (each vein's ``texture``) to a base64 ore-overlay
    PNG, deduped by set — so ~30 entries cover every vein. ``precolored`` is the
    subset of those keys whose art is already coloured (drawn as-is, not tinted).
    Both empty for an old (pre-sprite) dump; ``veins`` still populates.
    """

    veins: OreVeinRegistry
    sprites: dict[str, str]  # icon name -> base64 PNG
    precolored: list[str]  # sprite keys drawn as-is (no rgb tint)


_EMPTY = OreVeinData(veins={}, sprites={}, precolored=[])
_cache: dict[str, OreVeinData] = {}

# Canonical dumps ship at backend/app/data/<major>/ore_vein_dump.json (this file is
# at backend/app/services/, so parent.parent is backend/app/). The GTNH major
# version is detected per world from its ModList.
_DATA_DIR = Path(__file__).resolve().parent.parent / "data"


def _bundled_candidate(world_path: str) -> Path | None:
    """The version-selected bundled dump for this world, or None if none is bundled."""
    signatures = load_major_signatures(_DATA_DIR, _DUMP_NAME)
    major = detect_gtnh_major(world_path, signatures)
    return _DATA_DIR / major / _DUMP_NAME if major else None


def _candidates(world_path: str) -> list[Path]:
    env = os.environ.get("ATLAS_ORE_VEIN_DUMP_PATH", "").strip()
    bundled = _bundled_candidate(world_path)
    if env:
        return [Path(env), *([bundled] if bundled else [])]
    out: list[Path] = []
    p = Path(world_path)
    # The world usually sits inside an instance dir that also holds config/atlas/.
    for base in [p, *p.parents][:4]:
        out.append(base / "config" / "atlas" / _DUMP_NAME)
    out.append(Path.home() / ".atlas_gtnh" / _DUMP_NAME)
    if bundled:  # ships with Atlas — the zero-setup default, below any per-instance dump
        out.append(bundled)
    return out


def _parse(path: Path) -> OreVeinData:
    data = json.loads(path.read_text(encoding="utf-8"))
    veins = data.get("veins", {})
    result: OreVeinRegistry = {}
    if isinstance(veins, dict):
        for key, entry in veins.items():
            try:
                name = entry.get("name")
                rgb = entry.get("rgb")
                if name is None or rgb is None:
                    continue
                tex = entry.get("texture")
                result[str(key)] = VeinInfo(
                    name=str(name),
                    rgb=int(rgb),
                    texture=str(tex) if tex is not None else None,
                )
            except (AttributeError, ValueError, TypeError):
                continue
    sprites_raw = data.get("sprites", {})
    sprites: dict[str, str] = {}
    if isinstance(sprites_raw, dict):
        for k, v in sprites_raw.items():
            if isinstance(v, str) and v:
                sprites[str(k)] = v
    pre_raw = data.get("sprites_precolored", [])
    precolored = (
        [str(k) for k in pre_raw if isinstance(k, str)] if isinstance(pre_raw, list) else []
    )
    return OreVeinData(veins=result, sprites=sprites, precolored=precolored)


def get_ore_vein_data(world_path: str) -> OreVeinData:
    """Parsed ore-vein dump (registry + sprite atlas); empty when no dump is found.

    Candidates are tried most-specific first; a missing, broken, or empty one is
    skipped so resolution falls through to the bundled default. A per-instance
    result is cached; the bundled default is not, so a real per-instance dump
    dropped in later still supersedes it without a restart.
    """
    cached = _cache.get(world_path)
    if cached is not None:
        return cached
    for cand in _candidates(world_path):
        if not cand.exists():
            continue
        try:
            parsed = _parse(cand)
        except Exception:
            parsed = _EMPTY
        if not parsed.veins and not parsed.sprites:
            continue
        # Don't cache a bundled default (anything under backend/app/data) so a real
        # per-instance dump dropped in later still supersedes it without a restart.
        if _DATA_DIR not in cand.parents:
            _cache[world_path] = parsed
        return parsed
    return _EMPTY


def get_ore_vein_registry(world_path: str) -> OreVeinRegistry:
    """``ore.mix.X -> {name, rgb, texture}``; ``{}`` when no dump is found."""
    return get_ore_vein_data(world_path).veins
