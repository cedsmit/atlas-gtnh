"""Pure block colour / texture resolution helpers and constant tables.

Stateless: given a world path, an AssetDatabase, or a block-id map, resolve
colours and texture keys.  No in-process caching — BlockColorService owns that.
"""

import logging
import os
import re
import threading
import time
from pathlib import Path
from typing import Any

from app.services.blockcolor.asset_database import AssetDatabase
from app.services.blockcolor.blockstate_resolver import resolve_block_texture
from app.services.blockcolor.dump_resolver import get_dump_resolver, resolve_db_key, try_load_dump
from app.services.blockcolor.legacy_resolver import resolve_legacy_texture
from app.services.blockcolor.scan_progress import get_scan_progress_tracker
from app.services.blockcolor.vanilla_tables import (
    _ACACIA_WOODS,
    _BLOCK_NAME_PREFIXES,
    _FALLBACK_SUFFIXES,
    _LOG_WOODS,
    _OVERRIDES,
    _PLANK_WOODS,
    _WOOL_COLORS,
)
from app.services.color_cache import (
    load_jar_colors,
    load_jar_json_assets,
    save_jar_colors,
    save_jar_json_assets,
)
from app.world.texture_colors import scan_jar, scan_jar_assets

log = logging.getLogger(__name__)


def _camel_to_snake(s: str) -> str:
    """Convert camelCase portion of a registry name to snake_case.
    'colorizedLeaves2' → 'colorized_leaves2'
    """
    return re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", s).lower()


def find_minecraft_dir(world_path: Path) -> Path | None:
    for candidate in [world_path.parent, world_path.parent.parent, world_path.parent.parent.parent]:
        if (candidate / "mods").is_dir() or (candidate / "versions").is_dir():
            return candidate
    return None


def _collect_jars(mc_dir: Path) -> list[Path]:
    jars: list[Path] = []
    seen: set[Path] = set()

    for subdir_name in ("mods", "versions"):
        d = mc_dir / subdir_name
        if d.is_dir():
            for j in d.glob("**/*.jar"):
                if j not in seen:
                    jars.append(j)
                    seen.add(j)

    # Try to locate the vanilla Minecraft 1.7.10 JAR (has all vanilla block textures).
    # GTNH players use many launchers — each stores the JAR in a different location.
    appdata = Path(os.environ.get("APPDATA", ""))
    userprofile = Path(os.environ.get("USERPROFILE", str(Path.home())))
    # Maven path used by all modern launchers (com/mojang/minecraft/1.7.10/...).
    _client_rel = Path("com") / "mojang" / "minecraft" / "1.7.10" / "minecraft-1.7.10-client.jar"

    vanilla_candidates: list[Path] = [
        # Standard Minecraft launcher (users who also have vanilla installed)
        Path.home() / ".minecraft" / "versions" / "1.7.10" / "1.7.10.jar",
        appdata / ".minecraft" / "versions" / "1.7.10" / "1.7.10.jar",
        # Legacy FTB / Technic — instance bin/ folder
        mc_dir / "bin" / "minecraft.jar",
        # Prism Launcher — global libraries under %APPDATA%\PrismLauncher\libraries\
        appdata / "PrismLauncher" / "libraries" / _client_rel,
        # GDLauncher Carbon (new) — global libraries
        appdata / "gdlauncher_next" / "data" / "libraries" / _client_rel,
        # GDLauncher (old)
        appdata / "gdlauncher" / "libraries" / _client_rel,
        # ATLauncher
        appdata / "ATLauncher" / "libraries" / _client_rel,
        # CurseForge App
        userprofile / "curseforge" / "minecraft" / "Install" / "versions" / "1.7.10" / "1.7.10.jar",
    ]

    # Walk up from mc_dir looking for a sibling libraries/ directory.
    # Prism: instances/<name>/ → instances/ → PrismLauncher/ → libraries/ there.
    # GDLauncher: data/instances/<name>/ → data/instances/ → data/ → libraries/ there.
    for ancestor in [mc_dir.parent, mc_dir.parent.parent]:
        lib_candidate = ancestor / "libraries" / _client_rel
        if lib_candidate not in seen:
            vanilla_candidates.append(lib_candidate)

    for candidate in vanilla_candidates:
        if candidate.exists() and candidate not in seen:
            jars.append(candidate)
            seen.add(candidate)
            break  # use only the first vanilla JAR found

    return jars


def _resolve_texture_key(
    registry_name: str,
    texture_colors: dict[str, tuple[int, int, int]],
) -> str | None:
    """Return the resolved texture key for *registry_name*, or None.

    Resolution order:
      1. Exact override from _OVERRIDES.
      2. Direct name match (lowercase + snake_case) with optional suffixes.
      3. Same as 2 but with the pipe-namespace suffix stripped
         (BuildCraft|Factory → buildcraft).
      4. Trailing-number strip — "gt.blockores1" → try override for "gt.blockores".
      5. Common block-name prefixes stripped ("blockGenerator" → "generator").
      6. "tile." prefix stripped (AE2 pattern).
    """
    norm_name = registry_name.lower()

    # 1. Exact override.
    override = _OVERRIDES.get(norm_name)
    if override and override in texture_colors:
        return override

    if ":" not in registry_name:
        return None

    # fmt: off
    raw_domain = norm_name.split(":", 1)[0]
    orig_name  = registry_name.split(":", 1)[1]
    lower_name = orig_name.lower()
    # fmt: on

    # Many mods use pipe-delimited mod-category namespaces (BuildCraft|Factory,
    # BuildCraft|Transport, …) but their JAR assets live under the base name only
    # (assets/buildcraft/textures/…).  Build a clean domain without the |-suffix.
    clean_domain = raw_domain.split("|")[0] if "|" in raw_domain else raw_domain

    def _try_bases(domain: str, name_lower: str, name_orig: str) -> str | None:
        bases = [name_lower]
        sn = _camel_to_snake(name_orig)
        if sn != name_lower:
            bases.append(sn)
        for base in bases:
            for suffix in ("", *_FALLBACK_SUFFIXES):
                key = f"{domain}:{base}{suffix}"
                if key in texture_colors:
                    return key
        return None

    # 2. Direct name match.
    result = _try_bases(raw_domain, lower_name, orig_name)
    if result:
        return result

    # 3. Pipe-namespace stripped domain (BuildCraft|Factory → buildcraft).
    if clean_domain != raw_domain:
        result = _try_bases(clean_domain, lower_name, orig_name)
        if result:
            return result

    # 4. Trailing-number strip: "gt.blockores1" → check override for "gt.blockores".
    #    Also retries resolution with the suffix removed.
    stripped_num = re.sub(r"\d+$", "", lower_name)
    if stripped_num and stripped_num != lower_name:
        alt_norm = f"{clean_domain}:{stripped_num}"
        alt_override = _OVERRIDES.get(alt_norm)
        if alt_override and alt_override in texture_colors:
            return alt_override
        result = _try_bases(clean_domain, stripped_num, orig_name.rstrip("0123456789"))
        if result:
            return result

    # 5. Strip common block-name prefixes.
    #    IC2 registers "blockGenerator"; texture is "generator" or "generator_top".
    #    GT  registers "gt.blockCasings"; texture might be "casings_top".
    for prefix in _BLOCK_NAME_PREFIXES:
        if lower_name.startswith(prefix) and len(lower_name) > len(prefix):
            tail = lower_name[len(prefix) :]
            tail_orig = orig_name[len(prefix) :]
            result = _try_bases(clean_domain, tail, tail_orig)
            if result:
                return result

    # 6. "tile." prefix stripped (AE2 "tile.OreQuartz" → "orequartz").
    if lower_name.startswith("tile."):
        tail = lower_name[5:]
        tail_orig = orig_name[5:] if len(orig_name) > 5 else ""
        if tail:
            result = _try_bases(clean_domain, tail, tail_orig)
            if result:
                return result

    return None


def _resolve_unified(
    registry_name: str,
    meta: int,
    db: AssetDatabase,
) -> tuple[str | None, str]:
    """
    Full four-stage texture resolver.

    Returns (texture_key | None, method) where method is one of:
      'override'             — matched a hardcoded _OVERRIDES entry
      'forge_dump'           — resolved via Forge icon dump (exact icon name)
      'forge_dump_ambiguous' — resolved via dump but sides carry different icons
      'modern'               — resolved via blockstate/model pipeline
      'legacy_*'             — resolved via 1.7.10 naming-convention heuristics
      'none'                 — all stages failed
    """
    norm_name = registry_name.lower()

    # Stage 1: hardcoded overrides (exceptional cases conventions can't derive)
    override = _OVERRIDES.get(norm_name)
    if override and override in db.texture_colors:
        return override, "override"

    # Stage 2: Forge icon dump — exact IIcon names from running Minecraft
    dump = get_dump_resolver()
    if dump.is_loaded:
        dr = dump.resolve(registry_name, meta)
        if dr.resolved and dr.texture_key:
            # Normalise the raw IIcon name to a texture-DB key (vanilla prefix,
            # IC2 sub-index strip, case).
            tex_key = resolve_db_key(dr.texture_key, db.texture_colors)
            if tex_key is not None:
                method = "forge_dump_ambiguous" if dr.is_ambiguous else "forge_dump"
                return tex_key, method

    # Stage 3: modern blockstate → model → texture pipeline
    modern = resolve_block_texture(registry_name, meta, db)
    if modern.resolved:
        return modern.texture_key, "modern"

    # Stage 4: legacy 1.7.10 naming-convention resolver
    legacy = resolve_legacy_texture(registry_name, db.texture_colors, meta)
    if legacy.resolved:
        return legacy.texture_key, legacy.method_tag

    return None, "none"


def _build_color_map(
    id_map: dict[int, str],
    db: AssetDatabase,
) -> dict[int, list[int]]:
    result: dict[int, list[int]] = {}
    for block_id, registry_name in id_map.items():
        key, _ = _resolve_unified(registry_name, 0, db)
        if key:
            r, g, b = db.texture_colors[key]
            result[block_id] = [r, g, b]
    return result


def _build_texture_key_map(
    id_map: dict[int, str],
    db: AssetDatabase,
) -> dict[int, str]:
    """Same resolution as _build_color_map but returns the texture key string."""
    result: dict[int, str] = {}
    for block_id, registry_name in id_map.items():
        key, _ = _resolve_unified(registry_name, 0, db)
        if key:
            result[block_id] = key
    return result


# ── Meta-variant texture key tables ───────────────────────────────────────────
# Maps meta value → texture-key suffix for vanilla blocks that differ per meta.


def _build_meta_texture_map_for_world(id_map: dict[int, str]) -> dict[str, str]:
    """Return '{block_id}:{meta}' → texture-key for all known meta-variant blocks."""
    name_to_id: dict[str, int] = {v: k for k, v in id_map.items()}
    result: dict[str, str] = {}

    def add(reg_name: str, meta: int, tex_key: str) -> None:
        bid = name_to_id.get(reg_name)
        if bid is not None:
            result[f"{bid}:{meta}"] = tex_key

    # Wool (meta 0-15)
    for m, color in enumerate(_WOOL_COLORS):
        add("minecraft:wool", m, f"minecraft:wool_colored_{color}")

    # Carpet — same textures as wool
    for m, color in enumerate(_WOOL_COLORS):
        add("minecraft:carpet", m, f"minecraft:wool_colored_{color}")

    # Stained Glass (meta 0-15)
    for m, color in enumerate(_WOOL_COLORS):
        add("minecraft:stained_glass", m, f"minecraft:glass_{color}")

    # Stained Glass Pane — same face texture as stained glass
    for m, color in enumerate(_WOOL_COLORS):
        add("minecraft:stained_glass_pane", m, f"minecraft:glass_{color}")

    # Stained Hardened Clay (meta 0-15)
    for m, color in enumerate(_WOOL_COLORS):
        add("minecraft:stained_hardened_clay", m, f"minecraft:hardened_clay_stained_{color}")

    # Planks (meta 0-5: oak, spruce, birch, jungle, acacia, dark-oak)
    for m, wood in enumerate(_PLANK_WOODS):
        add("minecraft:planks", m, f"minecraft:planks_{wood}")

    # Oak-family logs (bits 0-1 = wood type, bits 2-3 = orientation; meta 0-15)
    for m in range(16):
        add("minecraft:log", m, f"minecraft:log_{_LOG_WOODS[m & 3]}")

    # Acacia/dark-oak logs (bit 0 = type; meta 0-15)
    for m in range(16):
        add("minecraft:log2", m, f"minecraft:log_{_ACACIA_WOODS[m & 1]}")

    # Oak-family leaves (bits 0-1 = type, bits 2-3 = flags; meta 0-15)
    for m in range(16):
        add("minecraft:leaves", m, f"minecraft:leaves_{_LOG_WOODS[m & 3]}")

    # Acacia/dark-oak leaves (bit 0 = type; meta 0-15)
    for m in range(16):
        add("minecraft:leaves2", m, f"minecraft:leaves_{_ACACIA_WOODS[m & 1]}")

    # ── Modded meta-variant blocks ─────────────────────────────────────────
    # Ztones glaxx: no dedicated texture in the JAR, all 16 metas use vanilla glass.
    for m in range(16):
        add("Ztones:tile.glaxx", m, "minecraft:glass")

    # ProjectRed Exploration — not in the Forge dump (Scala/CCL); meta order from
    # the mod's decorative-stone / ore enums. Verify against a world export.
    _PR_STONE = [
        "marble",
        "marble_brick",
        "basalt",
        "basalt_cobble",
        "basalt_brick",
        "ruby_block",
        "sapphire_block",
        "peridot_block",
    ]
    _PR_ORE = [
        "ruby_ore",
        "sapphire_ore",
        "peridot_ore",
        "copper_ore",
        "tin_ore",
        "silver_ore",
        "electrotine_ore",
    ]
    for m, tex in enumerate(_PR_STONE):
        add("ProjRed|Exploration:projectred.exploration.stone", m, f"projectred:{tex}")
        add("ProjRed|Exploration:projectred.exploration.stonewalls", m, f"projectred:{tex}")
    for m, tex in enumerate(_PR_ORE):
        add("ProjRed|Exploration:projectred.exploration.ore", m, f"projectred:{tex}")

    return result


def _augment_meta_map_from_dump(
    id_map: dict[int, str],
    db: AssetDatabase,
    result: dict[str, str],
) -> None:
    """Fill per-meta texture overrides from the Forge icon dump (in place).

    For every block present in the dump, map each meta (>0) whose top-face icon
    resolves to a texture *different* from meta 0 → '{block_id}:{meta}' → key.
    Meta 0 is owned by the base texture map, so it is skipped here. Curated
    entries already in *result* take priority and are never overwritten.

    This is what gives GregTech machines/casings/ores, Chisel variants, and
    other modded meta-variant blocks their correct per-meta texture instead of
    repeating the meta-0 texture for every value.
    """
    dump = get_dump_resolver()
    if not dump.is_loaded:
        return

    for block_id, registry_name in id_map.items():
        meta_icons = dump.get_all_meta_icons(registry_name)
        if not meta_icons:
            continue
        base_key, _ = _resolve_unified(registry_name, 0, db)
        for meta, raw_icon in meta_icons.items():
            if meta == 0:
                continue
            mk = f"{block_id}:{meta}"
            if mk in result:
                continue  # curated vanilla mapping wins
            key = resolve_db_key(raw_icon, db.texture_colors)
            if key is None or key == base_key:
                continue
            result[mk] = key


# ── Forge dump auto-discovery ─────────────────────────────────────────────────
# The dump is generated by the AtlasDumper Forge mod and written to
# {mc_dir}/config/atlas/icon_dump.json.  Resolution order:
#   1. ATLAS_ICON_DUMP_PATH environment variable
#   2. {mc_dir}/config/atlas/icon_dump.json   (when the world sits in an instance)
#   3. ~/.atlas_gtnh/icon_dump.json           (global drop-in — works for any map,
#      including standalone server-world folders with no instance around them)
# This is a pure texture-debugging aid, so we keep it forgiving: if no dump is
# found we don't record the attempt, letting a later-dropped file be picked up
# on the next world access without a restart.

_dump_attempted_dirs: set[str] = set()
# Serialises the auto-load: the check-then-add guard below and the resulting
# try_load_dump() must not interleave across threads (the dump singleton is not
# safe to rebuild concurrently).
_dump_attempt_lock = threading.Lock()


def _try_auto_load_dump(mc_dir: Path | None) -> None:
    """Try to load the Forge icon dump if not already loaded."""
    dump = get_dump_resolver()

    # Already loaded — nothing to do (lock-free fast path).
    if dump.is_loaded:
        return

    with _dump_attempt_lock:
        if dump.is_loaded:  # re-check: another thread may have just loaded it
            return

        # Env-var override (highest priority)
        env_path = os.environ.get("ATLAS_ICON_DUMP_PATH", "").strip()
        if env_path:
            try_load_dump(env_path)
            return

        # Instance-relative first (most specific), then the global drop-in spot.
        candidates: list[Path] = []
        if mc_dir is not None:
            candidates.append(mc_dir / "config" / "atlas" / "icon_dump.json")
        candidates.append(Path.home() / ".atlas_gtnh" / "icon_dump.json")

        # Attempt-once guard avoids re-parsing a file that exists but fails to load.
        dir_key = str(mc_dir) if mc_dir is not None else "<global>"
        if dir_key in _dump_attempted_dirs:
            return

        for candidate in candidates:
            if candidate.exists():
                _dump_attempted_dirs.add(dir_key)  # only mark once we actually try a file
                try_load_dump(candidate)
                return


# ── Asset database loader ─────────────────────────────────────────────────────


def _load_asset_db(world_path: str) -> AssetDatabase:
    """Scan every mod JAR into an AssetDatabase and load the Forge icon dump.

    Builds texture colors, blockstate JSONs and block-model JSONs (each cached in
    SQLite so subsequent server restarts are fast).  No in-process caching — the
    caller (BlockColorService) owns that.  The icon dump is loaded as the final
    step so a caller holding this DB is guaranteed the dump is available.
    """
    mc_dir = find_minecraft_dir(Path(world_path))
    if mc_dir is None:
        return AssetDatabase()

    jars = _collect_jars(mc_dir)
    all_colors: dict[str, tuple[int, int, int]] = {}
    all_blockstates: dict[str, Any] = {}
    all_models: dict[str, Any] = {}

    progress = get_scan_progress_tracker()
    progress.start(world_path, len(jars))
    try:
        for i, jar in enumerate(jars):
            progress.advance(world_path, jar.stem, i)
            try:
                # ── Texture colors ────────────────────────────────────────────
                cached_colors = load_jar_colors(jar)
                if cached_colors is not None:
                    all_colors.update(cached_colors)
                else:
                    fresh = scan_jar(jar)
                    save_jar_colors(jar, fresh)
                    for name, (avg, dom) in fresh.items():
                        all_colors[name] = dom if dom is not None else avg

                # ── JSON assets (blockstates + models) ────────────────────────
                cached_json = load_jar_json_assets(jar)
                if cached_json is not None:
                    bs, mods = cached_json
                else:
                    bs, mods = scan_jar_assets(jar)
                    save_jar_json_assets(jar, bs, mods)
                all_blockstates.update(bs)
                all_models.update(mods)
                time.sleep(0)
            except Exception:
                log.warning("Failed to scan JAR %s", jar, exc_info=True)
    finally:
        progress.finish(world_path)

    db = AssetDatabase(
        blockstates=all_blockstates,
        models=all_models,
        texture_colors=all_colors,
    )
    # No-op if already loaded; ensures the dump is ready before the DB is used.
    _try_auto_load_dump(mc_dir)
    return db
