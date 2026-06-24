from pathlib import Path

from app.world.block_registry import read_block_id_map
from app.world.texture_colors import collect_texture_colors

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

# Suffixes to try when the registry name doesn't directly match a texture filename
_FALLBACK_SUFFIXES = ["_top", "_side", "_0", "_front", "_normal"]


def find_minecraft_dir(world_path: Path) -> Path | None:
    """Walk up from the world path to find the directory containing mods/ or versions/."""
    for candidate in [world_path.parent.parent, world_path.parent.parent.parent]:
        if (candidate / "mods").is_dir() or (candidate / "versions").is_dir():
            return candidate
    return None


def build_block_color_map(world_path: str) -> dict[int, list[int]]:
    """
    Returns {block_id: [r, g, b]} by combining the world's Forge block registry
    with average colors sampled from block texture PNGs in the game's JAR files.
    """
    path = Path(world_path)
    id_map = read_block_id_map(path)
    if not id_map:
        return {}

    mc_dir = find_minecraft_dir(path)
    if mc_dir is None:
        return {}

    texture_colors = collect_texture_colors(mc_dir)
    if not texture_colors:
        return {}

    result: dict[int, list[int]] = {}
    for block_id, registry_name in id_map.items():
        resolved = _OVERRIDES.get(registry_name, registry_name)
        if resolved in texture_colors:
            r, g, b = texture_colors[resolved]
            result[block_id] = [r, g, b]
            continue

        domain, name = registry_name.split(":", 1)
        candidates = [name, *(name + s for s in _FALLBACK_SUFFIXES)]
        for variant in candidates:
            key = f"{domain}:{variant}"
            if key in texture_colors:
                r, g, b = texture_colors[key]
                result[block_id] = [r, g, b]
                break

    return result
