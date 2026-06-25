import os
import re
import time
from pathlib import Path

from app.services.color_cache import load_jar_colors, save_jar_colors
from app.world.block_registry import read_block_id_map
from app.world.texture_colors import scan_jar

# Vanilla blocks where the registry name doesn't match the texture filename.
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
    "minecraft:stained_glass": "minecraft:glass_white",
    "minecraft:stained_glass_pane": "minecraft:glass_pane_top",
    "minecraft:piston": "minecraft:piston_top_normal",
    "minecraft:sticky_piston": "minecraft:piston_top_sticky",
    "minecraft:tallgrass": "minecraft:tallgrass",
    "minecraft:stone_brick": "minecraft:stonebrick",
    "minecraft:double_stone_brick": "minecraft:stonebrick",
    "minecraft:carpet": "minecraft:wool_colored_white",
    "minecraft:quartz_block": "minecraft:quartz_block_side",
    "minecraft:quartz_stairs": "minecraft:quartz_block_side",
    "minecraft:sandstone": "minecraft:sandstone_top",
    "minecraft:sandstone_stairs": "minecraft:sandstone_top",
    "minecraft:red_sandstone": "minecraft:red_sandstone_top",
    "minecraft:red_sandstone_stairs": "minecraft:red_sandstone_top",
    "minecraft:hay_block": "minecraft:hay_block_top",
    "minecraft:double_plant": "minecraft:double_plant_grass_bottom",
    "minecraft:yellow_flower": "minecraft:flower_dandelion",
    "minecraft:red_flower": "minecraft:flower_rose",
    "minecraft:farmland": "minecraft:farmland_wet",
    "minecraft:mycelium": "minecraft:mycelium_top",
    "minecraft:podzol": "minecraft:dirt_podzol_top",
    "minecraft:crafting_table": "minecraft:crafting_table_top",
    "minecraft:furnace": "minecraft:furnace_top",
    "minecraft:lit_furnace": "minecraft:furnace_top",
    "minecraft:pumpkin": "minecraft:pumpkin_top",
    "minecraft:lit_pumpkin": "minecraft:pumpkin_top",
    "minecraft:melon_block": "minecraft:melon_side",
    "minecraft:cactus": "minecraft:cactus_side",
    "minecraft:lit_redstone_ore": "minecraft:redstone_ore",
    "minecraft:lit_redstone_lamp": "minecraft:redstone_lamp_on",
    "minecraft:redstone_lamp": "minecraft:redstone_lamp_off",
    "minecraft:fence": "minecraft:planks_oak",
    "minecraft:fence_gate": "minecraft:planks_oak",
    "minecraft:nether_brick_fence": "minecraft:nether_brick",
    "minecraft:packed_ice": "minecraft:ice_packed",
}

# Suffixes tried in order when no direct match is found.
_FALLBACK_SUFFIXES = [
    "_top", "_side", "_front", "_back", "_bottom", "_normal",
    "_0", "_1", "_2", "_3", "_4", "_5",
    "_on", "_off", "_active", "_inactive",
]


def _camel_to_snake(s: str) -> str:
    """Convert camelCase portion of a registry name to snake_case.
    'colorizedLeaves2' → 'colorized_leaves2'
    """
    return re.sub(r'([a-z0-9])([A-Z])', r'\1_\2', s).lower()


# Hardcoded vanilla block colours (block_id → [r,g,b]).
# Used as a baseline when the Minecraft JAR isn't scanned, so vanilla blocks
# always have a sensible colour in the API response (shown as "texture" in the
# Inspect panel rather than "fallback").
_VANILLA_COLORS: dict[int, list[int]] = {
    1: [122, 122, 122],   # stone
    3: [139, 105, 20],    # dirt
    4: [110, 110, 110],   # cobblestone
    5: [196, 165, 90],    # planks
    7: [51, 51, 51],      # bedrock
    8: [42, 106, 173],    # flowing water
    9: [42, 106, 173],    # still water
    10: [226, 88, 34],    # flowing lava
    11: [226, 88, 34],    # still lava
    12: [232, 213, 163],  # sand
    13: [136, 136, 136],  # gravel
    14: [201, 177, 55],   # gold ore
    15: [160, 112, 112],  # iron ore
    16: [51, 51, 51],     # coal ore
    17: [107, 76, 17],    # log
    19: [195, 180, 75],   # sponge
    20: [173, 200, 216],  # glass
    21: [59, 107, 140],   # lapis ore
    22: [64, 96, 176],    # lapis block
    24: [217, 199, 132],  # sandstone
    35: [208, 208, 208],  # wool
    41: [255, 215, 0],    # gold block
    42: [189, 189, 189],  # iron block
    43: [136, 136, 136],  # double stone slab
    44: [136, 136, 136],  # stone slab
    45: [156, 69, 53],    # brick
    47: [107, 76, 17],    # bookshelf
    48: [68, 85, 51],     # mossy cobblestone
    49: [26, 10, 46],     # obsidian
    54: [106, 84, 27],    # chest
    56: [79, 205, 196],   # diamond ore
    57: [127, 255, 244],  # diamond block
    60: [100, 65, 15],    # farmland
    61: [117, 117, 117],  # furnace
    73: [140, 51, 51],    # redstone ore
    74: [140, 51, 51],    # lit redstone ore
    79: [160, 200, 224],  # ice
    80: [232, 240, 240],  # snow block
    81: [40, 100, 30],    # cactus
    82: [144, 144, 160],  # clay
    86: [210, 110, 20],   # pumpkin
    87: [126, 34, 34],    # netherrack
    88: [78, 58, 42],     # soul sand
    89: [240, 192, 96],   # glowstone
    98: [119, 119, 119],  # stone bricks
    103: [110, 165, 50],  # melon
    110: [110, 70, 110],  # mycelium
    112: [59, 28, 33],    # nether brick
    121: [217, 215, 160], # end stone
    123: [220, 160, 60],  # redstone lamp off
    124: [250, 230, 120], # redstone lamp on
    129: [79, 205, 196],  # emerald ore
    133: [76, 217, 100],  # emerald block
    145: [136, 136, 136], # anvil
    152: [180, 20, 20],   # redstone block
    153: [126, 34, 34],   # nether quartz ore
    155: [224, 221, 216], # quartz block
    159: [139, 105, 20],  # stained hardened clay
    162: [125, 90, 42],   # acacia/dark oak log
    168: [110, 160, 160], # prismarine
    169: [200, 230, 200], # sea lantern
    170: [185, 165, 35],  # hay block
    172: [139, 105, 20],  # hardened clay
    173: [17, 17, 17],    # coal block
    174: [160, 200, 224], # packed ice
    179: [190, 100, 60],  # red sandstone
}


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
    # Maven path used by all modern launchers: com/mojang/minecraft/1.7.10/minecraft-1.7.10-client.jar
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


# Vanilla 1.7.10 block registry name → expected texture key, used as a last-resort
# fallback when the Minecraft JAR is not found during scanning.  Having a key in
# textureKeys allows the frontend to *try* loading the image (it may get a 404 if
# the JAR is still missing, but shows "failed" rather than "no-mapping") and will
# render correctly once the JAR is found.
_VANILLA_TEXTURE_KEYS: dict[str, str] = {
    # Direct matches: registry_name.split(":")[1] == texture filename
    "minecraft:stone":             "minecraft:stone",
    "minecraft:dirt":              "minecraft:dirt",
    "minecraft:cobblestone":       "minecraft:cobblestone",
    "minecraft:bedrock":           "minecraft:bedrock",
    "minecraft:sand":              "minecraft:sand",
    "minecraft:gravel":            "minecraft:gravel",
    "minecraft:gold_ore":          "minecraft:gold_ore",
    "minecraft:iron_ore":          "minecraft:iron_ore",
    "minecraft:coal_ore":          "minecraft:coal_ore",
    "minecraft:sponge":            "minecraft:sponge",
    "minecraft:glass":             "minecraft:glass",
    "minecraft:lapis_ore":         "minecraft:lapis_ore",
    "minecraft:lapis_block":       "minecraft:lapis_block",
    "minecraft:gold_block":        "minecraft:gold_block",
    "minecraft:iron_block":        "minecraft:iron_block",
    "minecraft:tnt":               "minecraft:tnt_top",
    "minecraft:bookshelf":         "minecraft:bookshelf",
    "minecraft:mossy_cobblestone": "minecraft:cobblestone_mossy",
    "minecraft:obsidian":          "minecraft:obsidian",
    "minecraft:diamond_ore":       "minecraft:diamond_ore",
    "minecraft:diamond_block":     "minecraft:diamond_block",
    "minecraft:ice":               "minecraft:ice",
    "minecraft:snow":              "minecraft:snow",
    "minecraft:clay":              "minecraft:clay",
    "minecraft:netherrack":        "minecraft:netherrack",
    "minecraft:soul_sand":         "minecraft:soul_sand",
    "minecraft:glowstone":         "minecraft:glowstone",
    "minecraft:waterlily":         "minecraft:waterlily",
    "minecraft:nether_brick":      "minecraft:nether_brick",
    "minecraft:end_stone":         "minecraft:end_stone",
    "minecraft:redstone_ore":      "minecraft:redstone_ore",
    "minecraft:coal_block":        "minecraft:coal_block",
    "minecraft:emerald_ore":       "minecraft:emerald_ore",
    "minecraft:emerald_block":     "minecraft:emerald_block",
    "minecraft:hardened_clay":     "minecraft:hardened_clay",
    "minecraft:prismarine":        "minecraft:prismarine_rough",
    "minecraft:sea_lantern":       "minecraft:sea_lantern",
    "minecraft:reeds":             "minecraft:reeds",
    "minecraft:brown_mushroom":    "minecraft:mushroom_brown",
    "minecraft:red_mushroom":      "minecraft:mushroom_red",
    "minecraft:deadbush":          "minecraft:deadbush",
    "minecraft:redstone_block":    "minecraft:redstone_block",
    "minecraft:nether_quartz_ore": "minecraft:quartz_ore",
    "minecraft:brick_block":       "minecraft:brick",
    "minecraft:torch":             "minecraft:torch_on",
    # Blocks whose registry name differs from texture filename (same as _OVERRIDES)
    **_OVERRIDES,
}


def _resolve_texture_key(
    registry_name: str,
    texture_colors: dict[str, tuple[int, int, int]],
) -> str | None:
    """Return the resolved texture key for *registry_name*, or None."""
    norm_name = registry_name.lower()

    override = _OVERRIDES.get(norm_name)
    if override and override in texture_colors:
        return override

    if ":" not in registry_name:
        return None

    domain = norm_name.split(":", 1)[0]
    orig_name = registry_name.split(":", 1)[1]
    lower_name = orig_name.lower()
    snake_name = _camel_to_snake(orig_name)

    bases = [lower_name]
    if snake_name != lower_name:
        bases.append(snake_name)

    for base in bases:
        for suffix in ("", *_FALLBACK_SUFFIXES):
            key = f"{domain}:{base}{suffix}"
            if key in texture_colors:
                return key

    # Some mods (AE2, etc.) prefix registry names with "tile." but the texture
    # file is named without that prefix (e.g. "tile.OreQuartz" → "orequartz.png").
    if lower_name.startswith("tile."):
        stripped = lower_name[5:]
        snake_stripped = _camel_to_snake(orig_name[5:]) if len(orig_name) > 5 else ""
        stripped_bases = [stripped]
        if snake_stripped and snake_stripped != stripped:
            stripped_bases.append(snake_stripped)
        for base in stripped_bases:
            for suffix in ("", *_FALLBACK_SUFFIXES):
                key = f"{domain}:{base}{suffix}"
                if key in texture_colors:
                    return key

    return None


def _build_color_map(
    id_map: dict[int, str],
    texture_colors: dict[str, tuple[int, int, int]],
) -> dict[int, list[int]]:
    result: dict[int, list[int]] = {}
    for block_id, registry_name in id_map.items():
        key = _resolve_texture_key(registry_name, texture_colors)
        if key:
            r, g, b = texture_colors[key]
            result[block_id] = [r, g, b]
    return result


def _build_texture_key_map(
    id_map: dict[int, str],
    texture_colors: dict[str, tuple[int, int, int]],
) -> dict[int, str]:
    """Same resolution as _build_color_map but returns the texture key string."""
    result: dict[int, str] = {}
    for block_id, registry_name in id_map.items():
        key = _resolve_texture_key(registry_name, texture_colors)
        if key:
            result[block_id] = key
    return result


# ── In-process caches ─────────────────────────────────────────────────────────

_texture_colors_cache: dict[str, dict[str, tuple[int, int, int]]] = {}
_color_cache: dict[str, dict[int, list[int]]] = {}
_texture_key_cache: dict[str, dict[int, str]] = {}


def _ensure_texture_colors(world_path: str) -> dict[str, tuple[int, int, int]]:
    """Scan all mod JARs and return every extracted texture color, cached per world."""
    if world_path in _texture_colors_cache:
        return _texture_colors_cache[world_path]

    mc_dir = find_minecraft_dir(Path(world_path))
    if mc_dir is None:
        _texture_colors_cache[world_path] = {}
        return {}

    jars = _collect_jars(mc_dir)
    all_colors: dict[str, tuple[int, int, int]] = {}

    for jar in jars:
        try:
            cached = load_jar_colors(jar)
            if cached is not None:
                all_colors.update(cached)
                continue
            fresh = scan_jar(jar)
            save_jar_colors(jar, fresh)
            for name, (avg, dom) in fresh.items():
                all_colors[name] = dom if dom is not None else avg
            time.sleep(0)
        except Exception:
            pass

    _texture_colors_cache[world_path] = all_colors
    return all_colors


def build_block_color_map(world_path: str) -> dict[int, list[int]]:
    """Build (or return cached) block-id → RGB color map."""
    if world_path in _color_cache:
        return _color_cache[world_path]

    path = Path(world_path)
    id_map = read_block_id_map(path)
    if not id_map:
        _color_cache[world_path] = {}
        return {}

    all_colors = _ensure_texture_colors(world_path)
    result = _build_color_map(id_map, all_colors)

    # Fill in vanilla blocks when the Minecraft JAR wasn't scanned.
    for block_id, color in _VANILLA_COLORS.items():
        if block_id not in result:
            result[block_id] = color

    _color_cache[world_path] = result
    return result


def build_block_texture_map(world_path: str) -> dict[int, str]:
    """Build (or return cached) block-id → texture-key map.

    The texture key is the same 'domain:name' string used to serve PNG bytes
    from the texture endpoint, e.g. 'minecraft:stone' or 'gregtech:ore_stone'.
    Vanilla blocks that couldn't be resolved from scanned JARs fall back to
    _VANILLA_TEXTURE_KEYS so the frontend can attempt to load their images.
    """
    if world_path in _texture_key_cache:
        return _texture_key_cache[world_path]

    path = Path(world_path)
    id_map = read_block_id_map(path)
    if not id_map:
        _texture_key_cache[world_path] = {}
        return {}

    all_colors = _ensure_texture_colors(world_path)
    result = _build_texture_key_map(id_map, all_colors)

    # Fill vanilla blocks whose JAR textures weren't scanned.
    for block_id, registry_name in id_map.items():
        if block_id not in result:
            fallback = _VANILLA_TEXTURE_KEYS.get(registry_name.lower())
            if fallback:
                result[block_id] = fallback

    _texture_key_cache[world_path] = result
    return result


def debug_texture_resolution(world_path: str) -> dict[str, object]:
    """Return diagnostic data for the full texture-resolution chain.

    Covers: mc_dir, JARs found, texture_colors count, vanilla key presence,
    and per-block resolution trace.  Does NOT use the in-process caches so
    results always reflect the current file-system state.
    """
    path = Path(world_path)
    mc_dir = find_minecraft_dir(path)
    jars = _collect_jars(mc_dir) if mc_dir else []

    # Rescan (may hit SQLite cache but not the in-process dict cache)
    all_colors: dict[str, tuple[int, int, int]] = {}
    jar_info: list[dict] = []
    for jar in jars:
        cached = load_jar_colors(jar)
        if cached is not None:
            all_colors.update(cached)
            jar_info.append({"jar": jar.name, "status": "cached", "keys": len(cached)})
        else:
            try:
                fresh = scan_jar(jar)
                save_jar_colors(jar, fresh)
                for name, (avg, dom) in fresh.items():
                    all_colors[name] = dom if dom is not None else avg
                jar_info.append({"jar": jar.name, "status": "scanned", "keys": len(fresh)})
            except Exception as exc:
                jar_info.append({"jar": jar.name, "status": f"error: {exc}", "keys": 0})

    id_map = read_block_id_map(path)

    vanilla_check = {
        k: k in all_colors
        for k in ("minecraft:stone", "minecraft:grass_top", "minecraft:cobblestone",
                   "minecraft:dirt", "minecraft:water_still", "minecraft:leaves_oak")
    }

    blocks = []
    for block_id, registry_name in sorted(id_map.items()):
        resolved = _resolve_texture_key(registry_name, all_colors)
        fallback = None if resolved else _VANILLA_TEXTURE_KEYS.get(registry_name.lower())
        blocks.append({
            "id": block_id,
            "name": registry_name,
            "resolved_key": resolved,
            "fallback_key": fallback,
            "source": "jar" if resolved else ("fallback" if fallback else "none"),
        })

    return {
        "mc_dir": str(mc_dir) if mc_dir else None,
        "jars": jar_info,
        "texture_color_count": len(all_colors),
        "vanilla_keys_in_colors": vanilla_check,
        "blocks": blocks,
    }
