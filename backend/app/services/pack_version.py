"""Detect a world's GTNH major version from its FML ModList.

No portable pack-version string exists in ``level.dat`` or instance metadata (mmc-pack.json
only lists LWJGL/Minecraft/Forge; instance.cfg keeps it in the renamable folder name). The
only signal that travels *with* a world is the FML ModList, already read by
``world/block_registry.read_world_modlist``.

We key off GTNH-specific "anchor" mods (present in the ModList, bumped every pack build) and
match them against the reference ``mods`` signature each bundled dataset carries (the ``mods``
array the AtlasDumper writes into both ``icon_dump.json`` and ``biome_dump.json``). This picks
the right ``backend/app/data/<major>/`` dataset for a world.

Self-maintaining: dropping in ``data/2.9/`` (with its dump's ``mods`` array) extends detection
with no code change. A per-instance dump still overrides the bundled default upstream.
"""

from __future__ import annotations

import json
from pathlib import Path

from app.world.block_registry import read_world_modlist

# GTNH-specific mods, bumped every pack build; appear as lowercase ids in the ModList.
_ANCHORS = ("gregtech_nh", "gtnhlib", "gtnhmixins", "gtnhlanth", "gregtech")


def _norm(mods: dict[str, str]) -> dict[str, str]:
    return {k.lower(): v for k, v in mods.items()}


def _sig_from_dump(dump_path: Path) -> dict[str, str]:
    """Parse a dump's ``mods`` array (``["modid@version", ...]``) into ``{modid: version}``."""
    try:
        data = json.loads(dump_path.read_text(encoding="utf-8"))
    except Exception:
        return {}
    out: dict[str, str] = {}
    for entry in data.get("mods", []):
        mod_id, _, ver = str(entry).partition("@")
        if mod_id:
            out[mod_id] = ver
    return out


def load_major_signatures(
    data_dir: Path, filename: str = "biome_dump.json"
) -> dict[str, dict[str, str]]:
    """``{major -> {mod_id: version}}`` for every ``data/<major>/<filename>`` present."""
    sigs: dict[str, dict[str, str]] = {}
    if not data_dir.is_dir():
        return sigs
    for sub in sorted(p for p in data_dir.iterdir() if p.is_dir()):
        dump = sub / filename
        if dump.exists():
            sigs[sub.name] = _sig_from_dump(dump)
    return sigs


def detect_gtnh_major(world_path: str | Path, signatures: dict[str, dict[str, str]]) -> str | None:
    """Best-matching major key from ``signatures``; ``None`` if none are bundled.

    Scores each major by exact ``(anchor_mod, version)`` matches against the world's ModList
    and returns the highest. Falls back to the newest bundled major when no anchor matches
    (non-GTNH / unknown world), so a bundled dataset is always chosen when one exists.
    """
    if not signatures:
        return None
    world = _norm(read_world_modlist(Path(world_path)))
    best: str | None = None
    best_score = -1
    for major in sorted(signatures):  # deterministic; later (newer) wins ties
        sig = _norm(signatures[major])
        score = sum(1 for a in _ANCHORS if world.get(a) is not None and world.get(a) == sig.get(a))
        if score >= best_score:
            best, best_score = major, score
    return best if best_score > 0 else sorted(signatures)[-1]
