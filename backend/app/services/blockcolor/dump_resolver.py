"""
Forge icon dump resolver.

Reads the JSON produced by the AtlasDumper Forge mod and maps
registry_name + meta → texture icon name (the exact string Minecraft uses).

The dump format is atlas-gtnh-icon-dump-v1:
{
  "blocks": {
    "gregtech:gt.blockmachines": {
      "8":  {"0": "gregtech:iconsets/...", "1": "gregtech:machine_ev_top", ...},
      ...
    }
  }
}

Side numbering in Forge 1.7.10:
  0 = bottom (Y-)   1 = top (Y+)   2 = north (Z-)
  3 = south (Z+)    4 = west (X-)  5 = east (X+)

Side priority for top-down map rendering: top (1) first, then cardinal
sides for wall/pillar blocks, bottom last.
"""

from __future__ import annotations

import json
import logging
import threading
from collections.abc import Container
from dataclasses import dataclass, field
from pathlib import Path

log = logging.getLogger(__name__)

# Side 1 = top face — what a top-down map wants.
# Fallback to cardinal sides for blocks that only register a side texture.
_SIDE_PRIORITY = [1, 2, 3, 4, 5, 0]


def normalize_icon_candidates(icon: str) -> list[str]:
    """Texture-DB key candidates for a raw Forge IIcon name, best match first.

    Forge ``IIcon.getIconName()`` strings from the dump come in three shapes that
    don't directly match Atlas texture-DB keys (``{lowercase_domain}:{lowercase_filename}``):
      - vanilla bare words:  ``"stone"``, ``"grass_top"``  → imply the ``minecraft`` domain
      - IC2 sub-index icons: ``"ic2:blockOreCopper:0"``     → drop the trailing ``:<n>``
      - mixed-case domain:   ``"TwilightForest:Naga"``      → lowercase to match the on-disk path

    Returns candidates ordered exact-before-lowercased so an exact DB hit wins.
    """
    candidates: list[str] = []

    def add(x: str) -> None:
        if x and x not in candidates:
            candidates.append(x)

    base = icon
    # IC2 (and similar) register texture-sheet icons as "domain:name:<index>".
    # The underlying PNG is "domain:name" — strip a purely-numeric trailing segment.
    if ":" in base:
        head, tail = base.rsplit(":", 1)
        if tail.isdigit():
            base = head

    if ":" not in base:
        # No domain — Minecraft implies the "minecraft" domain for vanilla icons.
        add("minecraft:" + base)
        add("minecraft:" + base.lower())
    else:
        add(base)
        add(base.lower())
    return candidates


def resolve_db_key(icon: str, db_keys: Container[str]) -> str | None:
    """Return the first normalized candidate of *icon* present in *db_keys*, else None.

    *db_keys* is any container supporting ``in`` (e.g. the ``texture_colors`` dict).
    """
    for cand in normalize_icon_candidates(icon):
        if cand in db_keys:
            return cand
    return None


@dataclass
class DumpResult:
    resolved: bool
    texture_key: str | None = None
    side_used: int = -1
    is_ambiguous: bool = False  # True when sides carry different icons
    meta_exact: bool = False  # False if we fell back to meta 0
    trace: list[str] = field(default_factory=list)


class ForgeDumpResolver:
    """Concurrent-safe: load() is serialised and publishes all fields atomically."""

    def __init__(self) -> None:
        # {registry_name_lower: {meta_str: {side_str: icon_name}}}
        self._blocks: dict[str, dict[str, dict[str, str]]] = {}
        self._loaded = False
        self._path: str | None = None
        self._summary: dict[str, object] = {}
        self._mods: list[str] = []  # ["modid@version", ...] from the dump
        self._lock = threading.Lock()  # serialises load() across threads

    # ── Loading ───────────────────────────────────────────────────────────────

    def load(self, path: Path) -> bool:
        """Load a dump file. Returns True on success.

        Serialised so two concurrent loads can't interleave their field writes
        and leave the resolver with a mix of two dumps.
        """
        try:
            with open(path, encoding="utf-8") as f:
                data = json.load(f)
        except Exception as exc:
            log.warning("ForgeDumpResolver: cannot open %s: %s", path, exc)
            return False

        if data.get("format") != "atlas-gtnh-icon-dump-v1":
            log.warning("ForgeDumpResolver: unrecognised format in %s", path)

        raw: dict[str, dict[str, dict[str, str]]] = data.get("blocks", {})
        with self._lock:
            # Lowercase registry names for case-insensitive lookup
            self._blocks = {k.lower(): v for k, v in raw.items()}
            self._path = str(path)
            self._summary = data.get("summary", {})
            self._mods = data.get("mods", []) or []
            self._loaded = True  # set last: readers see a fully-populated resolver
        log.info(
            "ForgeDumpResolver: loaded %d blocks from %s (errors=%s)",
            len(self._blocks),
            path,
            self._summary.get("errors", "?"),
        )
        return True

    # ── Properties ────────────────────────────────────────────────────────────

    @property
    def is_loaded(self) -> bool:
        return self._loaded

    @property
    def block_count(self) -> int:
        return len(self._blocks)

    def has_block(self, registry_name: str) -> bool:
        """True if the dump contains any entry for *registry_name* (case-insensitive)."""
        return registry_name.lower() in self._blocks

    @property
    def path(self) -> str | None:
        return self._path

    @property
    def summary(self) -> dict[str, object]:
        return self._summary

    @property
    def mods(self) -> list[str]:
        """Raw 'modid@version' strings recorded in the dump (empty for old dumps)."""
        return self._mods

    @property
    def mods_map(self) -> dict[str, str]:
        """{mod_id: version} parsed from the dump's mods list."""
        result: dict[str, str] = {}
        for entry in self._mods:
            mod_id, _, version = entry.rpartition("@")
            if mod_id:
                result[mod_id] = version
            else:  # no '@' — treat the whole string as the id
                result[entry] = ""
        return result

    # ── Resolution ────────────────────────────────────────────────────────────

    def resolve(self, registry_name: str, meta: int = 0) -> DumpResult:
        """
        Look up registry_name + meta in the dump.

        Returns DumpResult with resolved=True and texture_key set on success.
        The texture_key is the raw icon name from Forge (e.g. "gregtech:machine_ev_top").
        It is NOT guaranteed to be in the Atlas texture DB — callers must check.
        """
        trace: list[str] = []

        if not self._loaded:
            trace.append("Dump not loaded")
            return DumpResult(resolved=False, trace=trace)

        key = registry_name.lower()
        block_data = self._blocks.get(key)
        if block_data is None:
            trace.append(f"Block not in dump ({key!r})")
            return DumpResult(resolved=False, trace=trace)
        trace.append(f"Found {key!r} in dump")

        # Try exact meta; fall back to meta 0 if missing
        meta_str = str(meta)
        side_data = block_data.get(meta_str)
        meta_exact = side_data is not None

        if side_data is None:
            side_data = block_data.get("0")
            if side_data is None:
                trace.append(f"Meta {meta} not in dump, no meta-0 fallback")
                return DumpResult(resolved=False, trace=trace)
            trace.append(f"Meta {meta} missing, using meta 0")
        else:
            trace.append(f"Found meta {meta}")

        # Pick best side using top-down priority
        selected_icon: str | None = None
        selected_side = -1
        for side in _SIDE_PRIORITY:
            icon = side_data.get(str(side))
            if icon:
                selected_icon = icon
                selected_side = side
                break

        if selected_icon is None:
            trace.append("All sides empty in dump entry")
            return DumpResult(resolved=False, meta_exact=meta_exact, trace=trace)

        trace.append(f"Side {selected_side} → {selected_icon!r}")

        # Ambiguity: more than one distinct icon across sides
        all_icons = set(side_data.values())
        is_ambiguous = len(all_icons) > 1

        return DumpResult(
            resolved=True,
            texture_key=selected_icon,
            side_used=selected_side,
            is_ambiguous=is_ambiguous,
            meta_exact=meta_exact,
            trace=trace,
        )

    def get_all_meta_icons(self, registry_name: str) -> dict[int, str] | None:
        """
        Return {meta: top_icon_name} for all metas present in the dump.
        Used to build meta-texture maps for complex blocks (GT machines, etc).
        Returns None if the block isn't in the dump.
        """
        if not self._loaded:
            return None
        block_data = self._blocks.get(registry_name.lower())
        if block_data is None:
            return None

        result: dict[int, str] = {}
        for meta_str, side_data in block_data.items():
            try:
                meta = int(meta_str)
            except ValueError:
                continue
            for side in _SIDE_PRIORITY:
                icon = side_data.get(str(side))
                if icon:
                    result[meta] = icon
                    break
        return result or None


# ── Module-level singleton ────────────────────────────────────────────────────
# Loaded once at startup; shared across all requests.

_resolver = ForgeDumpResolver()


def get_dump_resolver() -> ForgeDumpResolver:
    return _resolver


def try_load_dump(path: Path | str) -> bool:
    """Load a dump file into the module-level singleton. Returns True on success."""
    return _resolver.load(Path(path))
