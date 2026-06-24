import time
from pathlib import Path

from app.services.color_cache import load_jar_colors, save_jar_colors
from app.world.block_registry import read_block_id_map
from app.world.texture_colors import scan_jar

# Vanilla blocks where the registry name doesn't match the texture filename
_OVERRIDES: dict[str, str] = {
    "minecraft:grass": "minecraft:grass_top",
    "minecraft:log": "minecraft:log_oak",
    "minecraft:log2": "minecraft:log_acacia",
    "minecraft:leaves": "minecraft:leaves_oak",
    "minecraft:leaves2": "minecraft:leaves_acacia",
    "minecraft:planks": "minecraft:planks_oak",
    "minecraft:stone_slab": "minecraft:stone_slab_top",
    "minecraft:double_stone_slab": "minecraft:stone_slab_top",
    "minecraft:snow_layer": "minecraft:snow",
    "minecraft:water": "minecraft:water_still",
    "minecraft:flowing_water": "minecraft:water_flow",
    "minecraft:lava": "minecraft:lava_still",
    "minecraft:flowing_lava": "minecraft:lava_flow",
    "minecraft:wool": "minecraft:wool_colored_white",
    "minecraft:stained_hardened_clay": "minecraft:hardened_clay_stained_white",
    "minecraft:piston": "minecraft:piston_top_normal",
    "minecraft:sticky_piston": "minecraft:piston_top_sticky",
    "minecraft:tallgrass": "minecraft:tallgrass",
}

_FALLBACK_SUFFIXES = ["_top", "_side", "_0", "_front", "_normal"]


def find_minecraft_dir(world_path: Path) -> Path | None:
    for candidate in [world_path.parent, world_path.parent.parent, world_path.parent.parent.parent]:
        if (candidate / "mods").is_dir() or (candidate / "versions").is_dir():
            return candidate
    return None


def _collect_jars(mc_dir: Path) -> list[Path]:
    jars: list[Path] = []
    mods_dir = mc_dir / "mods"
    if mods_dir.is_dir():
        jars.extend(mods_dir.glob("**/*.jar"))
    versions_dir = mc_dir / "versions"
    if versions_dir.is_dir():
        jars.extend(versions_dir.glob("**/*.jar"))
    return jars


def _build_color_map(
    id_map: dict[int, str],
    texture_colors: dict[str, tuple[int, int, int]],
) -> dict[int, list[int]]:
    result: dict[int, list[int]] = {}
    for block_id, registry_name in id_map.items():
        norm_name = registry_name.lower()
        resolved = _OVERRIDES.get(norm_name, norm_name)
        if resolved in texture_colors:
            r, g, b = texture_colors[resolved]
            result[block_id] = [r, g, b]
            continue
        if ":" not in norm_name:
            continue
        domain, name = norm_name.split(":", 1)
        candidates = [name, *(name + s for s in _FALLBACK_SUFFIXES)]
        for variant in candidates:
            key = f"{domain}:{variant}"
            if key in texture_colors:
                r, g, b = texture_colors[key]
                result[block_id] = [r, g, b]
                break
    return result


# In-process cache: populated on first call, fast on every subsequent call.
_color_cache: dict[str, dict[int, list[int]]] = {}

_MAX_JAR_BYTES = 150 * 1024 * 1024


def build_block_color_map(world_path: str) -> dict[int, list[int]]:
    """
    Build (or return cached) block-id → RGB color map.

    On first call: scans JARs for textures, caching results to SQLite so
    subsequent startups skip the scan entirely.
    """
    if world_path in _color_cache:
        return _color_cache[world_path]

    path = Path(world_path)
    id_map = read_block_id_map(path)
    mc_dir = find_minecraft_dir(path)

    if not id_map or mc_dir is None:
        _color_cache[world_path] = {}
        return {}

    jars = _collect_jars(mc_dir)
    all_texture_colors: dict[str, tuple[int, int, int]] = {}

    for jar in jars:
        try:
            if jar.stat().st_size > _MAX_JAR_BYTES:
                continue

            # Try SQLite cache first
            cached = load_jar_colors(jar)
            if cached is not None:
                all_texture_colors.update(cached)
                continue

            # Cache miss — scan the JAR
            fresh = scan_jar(jar)
            save_jar_colors(jar, fresh)
            for name, (avg, _dom) in fresh.items():
                all_texture_colors[name] = avg

            time.sleep(0)  # yield OS scheduler between JAR scans
        except Exception:
            pass

    result = _build_color_map(id_map, all_texture_colors)
    _color_cache[world_path] = result
    return result
