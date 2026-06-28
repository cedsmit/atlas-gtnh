import os
import re
import time
from pathlib import Path
from typing import Any

from app.services.blockstate_resolver import (
    AssetDatabase,
    resolve_block_texture,
)
from app.services.color_cache import (
    load_jar_colors,
    load_jar_json_assets,
    save_jar_colors,
    save_jar_json_assets,
)
from app.services.dump_resolver import (
    get_dump_resolver,
    resolve_db_key,
    try_load_dump,
)
from app.services.legacy_resolver import resolve_legacy_texture
from app.world.block_registry import read_block_id_map, read_world_modlist
from app.world.texture_colors import scan_jar, scan_jar_assets

# Prefixes stripped from block names before texture lookup.
# Order matters — try most specific first.
_BLOCK_NAME_PREFIXES = ["gt.block", "block", "tile.block", "block."]

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
    "minecraft:oak_stairs": "minecraft:planks_oak",
    "minecraft:stone_stairs": "minecraft:stone",
    "minecraft:stone_brick_stairs": "minecraft:stonebrick",
    "minecraft:birch_stairs": "minecraft:planks_birch",
    "minecraft:spruce_stairs": "minecraft:planks_spruce",
    "minecraft:jungle_stairs": "minecraft:planks_jungle",
    "minecraft:acacia_stairs": "minecraft:planks_acacia",
    "minecraft:dark_oak_stairs": "minecraft:planks_big_oak",
    "minecraft:brick_stairs": "minecraft:brick",
    "minecraft:nether_brick_stairs": "minecraft:nether_brick",
    "minecraft:cobblestone_stairs": "minecraft:cobblestone",
    "minecraft:wheat": "minecraft:wheat_stage_7",
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
    # ── Modded transparent blocks ──────────────────────────────────────────
    # Ztones glaxx: no dedicated texture in the JAR — use vanilla glass diamond pattern
    "ztones:tile.glaxx":                           "minecraft:glass",
    # AE2: FluixGlass texture file is BlockFluix.png, not BlockFluixGlass.png
    "appliedenergistics2:tile.blockfluixglass":    "appliedenergistics2:blockfluix",
    # EnderIO: texture files drop the "block" prefix
    "enderio:blockfusedquartz":                    "enderio:fusedquartz",
    "enderio:blockfusedquartzframed":              "enderio:fusedquartzframe",
    # ── Blocks whose texture key uses a path suffix the auto-scanner can't infer ──
    # Chisel: meta-variant blocks stored under subdirectory paths (cubit/0, hempcrete/concrete/white)
    "chisel:cubit":                                "chisel:cubit/0",
    "chisel:hempcrete":                            "chisel:hempcrete/concrete/white",
    # Railcraft:cube is meta-variant (cube.steel, cube.copper, etc.); steel is the representative
    "railcraft:cube":                              "railcraft:cube.steel",
    # HarvestCraft garden plots: textures appended with digit suffix, not underscore-digit
    "harvestcraft:textilegarden":                  "harvestcraft:textilegarden0",
    "harvestcraft:berrygarden":                    "harvestcraft:berrygarden0",
    "harvestcraft:grassgarden":                    "harvestcraft:grassgarden0",
    "harvestcraft:gourdgarden":                    "harvestcraft:gourdgarden0",
    "harvestcraft:leafygarden":                    "harvestcraft:leafygarden0",
    "harvestcraft:groundgarden":                   "harvestcraft:groundgarden0",
    "harvestcraft:herbgarden":                     "harvestcraft:herbgarden0",
    "harvestcraft:mushroomgarden":                 "harvestcraft:mushroomgarden0",
    "harvestcraft:stalkgarden":                    "harvestcraft:stalkgarden0",
    "harvestcraft:tropicalgarden":                 "harvestcraft:tropicalgarden0",
    "harvestcraft:desertgarden":                   "harvestcraft:desertgarden0",
    "harvestcraft:watergarden":                    "harvestcraft:watergarden0",
    # Thaumcraft:blockCosmeticSolid — meta-variant decorative block; arcane_stone (meta 7) as representative
    "thaumcraft:blockcosmeticsolid":               "thaumcraft:arcane_stone",
    # GregTech natural stone replacements — FML name uses dot-separated path not matched by snake_case
    "gregtech:gt.blockstones":                     "gregtech:basalt_stone",
    "gregtech:gt.blockgranites":                   "gregtech:granite_black_stone",
    "gregtech:gt.blockconcretes":                  "gregtech:concrete_dark_stone",
    # GregTech ore blocks — all variants map to basalt_stone (stone-like appearance from above)
    # gt.blockores through gt.blockores5 cover the ore meta-variant range in GTNH
    "gregtech:gt.blockores":                       "gregtech:basalt_stone",
    "gregtech:gt.blockores1":                      "gregtech:basalt_stone",
    "gregtech:gt.blockores2":                      "gregtech:basalt_stone",
    "gregtech:gt.blockores3":                      "gregtech:basalt_stone",
    "gregtech:gt.blockores4":                      "gregtech:basalt_stone",
    "gregtech:gt.blockores5":                      "gregtech:basalt_stone",
    # GregTech machine block — meta-variant; meta=0 is LV hull. LV top face is most map-readable.
    # Machine top texture from gregtech JAR (iconsets/machine_lv_top and plain machine_lv_top).
    "gregtech:gt.blockmachines":                   "gregtech:machine_lv_top",
    # GregTech casings — meta-variant; blockcasing is the default steel machine casing.
    "gregtech:gt.blockcasings":                    "gregtech:blockcasing",
    "gregtech:gt.blockcasings2":                   "gregtech:blockcasing",
    "gregtech:gt.blockcasings3":                   "gregtech:blockcasing",
    "gregtech:gt.blockcasings4":                   "gregtech:blockcasing",
    "gregtech:gt.blockcasings5":                   "gregtech:blockcasing",

    # ── IC2 — registry "blockXxx" → texture "xxx" or "xxx_top" ──────────────
    # The block-prefix stripping in _resolve_texture_key handles most IC2 blocks
    # automatically; these entries cover the few that need an explicit redirect.
    "ic2:blockrublog":                             "ic2:rubber_wood",
    "ic2:blockrubleaves":                          "ic2:rubber_leaves",
    "ic2:blockrubsapling":                         "ic2:rubber_sapling",

    # ── BuildCraft — pipe-namespace is "buildcraft|*", assets are under buildcraft{module} ─
    # Fluid blocks use a distinct registered name but share the oil texture.
    "buildcraft|energy:blockoil":                  "buildcraft:oil_still",
    "buildcraft|energy:blockfuel":                 "buildcraft:fuel_still",
    # BC6/7 Factory machines: textures live under buildcraftfactory / buildcraftbuilders
    # using "{name}block/{face}" subpath format that the auto-resolver can't derive.
    "buildcraft|factory:blockquarry":              "buildcraftbuilders:machineblock/top",
    "buildcraft|factory:blockminingwell":          "buildcraftfactory:miningwellblock/top",
    "buildcraft|factory:blockpump":               "buildcraftfactory:pumpblock/top",
    "buildcraft|factory:blockrefinery":           "buildcraftfactory:refineryblock/refinery",
    "buildcraft|factory:blockautoworkbench":      "buildcraftfactory:autoworkbenchblock/top",
    "buildcraft|factory:blockfloodgate":          "buildcraftfactory:floodgateblock/top",
    "buildcraft|factory:blockhopperbase":         "buildcraftfactory:hopperblock/top",
    "buildcraft|builders:blockfiller":            "buildcraftbuilders:fillerblock/top",
    "buildcraft|builders:blockbuilder":           "buildcraftbuilders:builderblock/top",
    "buildcraft|builders:blockarchitect":         "buildcraftbuilders:architectblock/top",

    # ── Railcraft extra named blocks ──────────────────────────────────────────
    "railcraft:brick":                             "railcraft:brick.abyssal",
    # Standard track (tile.railcraft.track) — no "track.standard" PNG in the JAR;
    # reinforced track is the most common Railcraft track in GTNH worlds.
    "railcraft:tile.railcraft.track":              "railcraft:track.reinforced",
    # Coke oven, blast furnace, boiler — multiblock structures; use side texture
    "railcraft:tile.railcraft.machine.alpha":      "railcraft:coke.oven",
    "railcraft:tile.railcraft.machine.gamma":      "railcraft:blast.furnace",
    "railcraft:tile.railcraft.boiler.firebox.solid": "railcraft:boiler.firebox.solid",
    "railcraft:tile.railcraft.boiler.firebox.fluid": "railcraft:boiler.firebox.liquid",
    "railcraft:tile.railcraft.boiler.tank":        "railcraft:boiler.tank.pressure.high",
    # railcraft:glass resolves automatically; "glass.infused" does not exist in the DB.

    # ── EnderIO ───────────────────────────────────────────────────────────────
    # Most EnderIO blocks resolve via block-prefix stripping; these need redirects.
    # Texture keys are lowercase in the DB.
    "enderio:blockconduitbundle":                  "enderio:conduitbundle",
    "enderio:blockdarksteel":                      "enderio:darksteelblock",
    # AlloyFurnace in registry is "AlloySmelter" in assets (naming inconsistency in EnderIO)
    "enderio:blockalloyfurnace":                   "enderio:alloysmelterfront",

    # ── Applied Energistics 2 ─────────────────────────────────────────────────
    # AE2 uses "tile." prefix in registry; tile-stripping handles most but these
    # need an explicit remap where the texture name differs structurally.
    # Quartz ore: JAR texture is "orequartz.png" (ore-prefix form), not blockquartzore.
    "appliedenergistics2:tile.blockquartzore":     "appliedenergistics2:orequartz",
    # Charger: JAR texture is "blockcharger.png" (full block name).
    "appliedenergistics2:tile.blockcharger":       "appliedenergistics2:blockcharger",
    # Sky stone: JAR texture is "blockskystone.png".
    "appliedenergistics2:tile.blockskystone":      "appliedenergistics2:blockskystone",
    "appliedenergistics2:tile.blockskycompass":    "appliedenergistics2:blockskystone",

    # ── Thaumcraft ────────────────────────────────────────────────────────────
    "thaumcraft:blockarcane_log":                  "thaumcraft:blockArcaneLog",
    "thaumcraft:blockmagicallog":                  "thaumcraft:blockMagicalLog",
    "thaumcraft:blockcosmeticopaque":              "thaumcraft:arcane_stone",
    # Taint blocks use underscore-separated names
    "thaumcraft:blocktaint":                       "thaumcraft:taint_crust",

    # ── Botania ───────────────────────────────────────────────────────────────
    # Botania stores textures with digit appended directly (no underscore):
    # "livingrock0.png" not "livingrock_0.png". Auto-resolver generates underscore form.
    "botania:livingrock":                          "botania:livingrock0",
    "botania:livingwood":                          "botania:livingwood0",

    # ── Chisel extra blocks ───────────────────────────────────────────────────
    "chisel:marble":                               "chisel:marble/raw",
    "chisel:limestone":                            "chisel:limestone/raw",
    "chisel:basalt":                               "chisel:basalt/raw",
    "chisel:obsidian":                             "chisel:obsidian/0",

    # ── Natura ───────────────────────────────────────────────────────────────
    "natura:natura.overworld.treeroots":           "natura:planks_eucalyptus",
    "natura:natura.overworld.saguaro":             "natura:cactus.saguaro.body",
    "natura:natura.nether.glowshroom":             "natura:mushroom.glow",

    # ── ProjectRed Exploration ─────────────────────────────────────────────
    # Scala/CCL blocks that never appear in the Forge icon dump; their textures
    # exist in the JAR, so map base (meta 0) here and full meta tables below.
    "projred|exploration:projectred.exploration.stone":      "projectred:marble",
    "projred|exploration:projectred.exploration.stonewalls": "projectred:marble",
    "projred|exploration:projectred.exploration.ore":        "projectred:ruby_ore",
    "projred|exploration:projectred.exploration.barrel":     "projectred:world/barrel/top",
}

# Suffixes tried in order when no direct match is found.
_FALLBACK_SUFFIXES = [
    "_top", "_side", "_front", "_back", "_bottom", "_normal",
    "_0", "_1", "_2", "_3", "_4", "_5",
    "_6", "_7", "_8", "_9", "_10", "_11", "_12", "_13", "_14", "_15",
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

    raw_domain = norm_name.split(":", 1)[0]
    orig_name  = registry_name.split(":", 1)[1]
    lower_name = orig_name.lower()

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
            tail = lower_name[len(prefix):]
            tail_orig = orig_name[len(prefix):]
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

_WOOL_COLORS = [
    "white", "orange", "magenta", "light_blue", "yellow", "lime",
    "pink", "gray", "silver", "cyan", "purple", "blue", "brown",
    "green", "red", "black",
]

_LOG_WOODS    = ["oak", "spruce", "birch", "jungle"]
_ACACIA_WOODS = ["acacia", "big_oak"]
_PLANK_WOODS  = ["oak", "spruce", "birch", "jungle", "acacia", "big_oak"]


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
        "marble", "marble_brick", "basalt", "basalt_cobble", "basalt_brick",
        "ruby_block", "sapphire_block", "peridot_block",
    ]
    _PR_ORE = [
        "ruby_ore", "sapphire_ore", "peridot_ore", "copper_ore",
        "tin_ore", "silver_ore", "electrotine_ore",
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


def _try_auto_load_dump(mc_dir: Path | None) -> None:
    """Try to load the Forge icon dump if not already loaded."""
    dump = get_dump_resolver()

    # Already loaded — nothing to do
    if dump.is_loaded:
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


# ── In-process caches ─────────────────────────────────────────────────────────

_texture_colors_cache: dict[str, dict[str, tuple[int, int, int]]] = {}
_color_cache: dict[str, dict[int, list[int]]] = {}
_texture_key_cache: dict[str, dict[int, str]] = {}
_meta_texture_key_cache: dict[str, dict[str, str]] = {}
_asset_db_cache: dict[str, AssetDatabase] = {}


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


def _ensure_asset_db(world_path: str) -> AssetDatabase:
    """
    Load (or return cached) the full AssetDatabase for a world.

    Scans every mod JAR for:
      - Texture colors      (PNG average/dominant color per texture key)
      - Blockstate JSONs    (assets/{domain}/blockstates/*.json)
      - Block model JSONs   (assets/{domain}/models/block/**/*.json)

    Results are cached in SQLite so subsequent server restarts are fast.
    """
    if world_path in _asset_db_cache:
        return _asset_db_cache[world_path]

    mc_dir = find_minecraft_dir(Path(world_path))
    if mc_dir is None:
        db = AssetDatabase()
        _asset_db_cache[world_path] = db
        return db

    jars = _collect_jars(mc_dir)
    all_colors: dict[str, tuple[int, int, int]] = {}
    all_blockstates: dict[str, Any] = {}
    all_models: dict[str, Any] = {}

    for jar in jars:
        try:
            # ── Texture colors ────────────────────────────────────────────────
            cached_colors = load_jar_colors(jar)
            if cached_colors is not None:
                all_colors.update(cached_colors)
            else:
                fresh = scan_jar(jar)
                save_jar_colors(jar, fresh)
                for name, (avg, dom) in fresh.items():
                    all_colors[name] = dom if dom is not None else avg

            # ── JSON assets (blockstates + models) ────────────────────────────
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
            pass

    db = AssetDatabase(
        blockstates=all_blockstates,
        models=all_models,
        texture_colors=all_colors,
    )
    _asset_db_cache[world_path] = db

    # Auto-discover the Forge icon dump for this mc_dir (no-op if already loaded)
    _try_auto_load_dump(mc_dir)

    return db


def debug_pipeline_report(world_path: str) -> dict[str, object]:
    """
    Run the full three-stage resolution pipeline (override → modern → legacy)
    for every block in this world and return a categorised report.

    Legacy blocks are tagged with confidence/ambiguity in block_methods:
      "legacy_high", "legacy_medium", "legacy_low",
      "legacy_high_ambiguous", "legacy_medium_ambiguous", "legacy_low_ambiguous"

    The 'categories' dict shows the modern pipeline failure reason for blocks
    that STILL couldn't be resolved after the legacy resolver also ran.
    """
    from collections import Counter, defaultdict

    path = Path(world_path)
    id_map = read_block_id_map(path)
    if not id_map:
        return {"error": "No block ID map found in world"}

    db = _ensure_asset_db(world_path)

    override_count = 0
    forge_dump_count = 0
    forge_dump_ambiguous_count = 0
    modern_count = 0
    legacy_high_count = 0
    legacy_medium_count = 0
    legacy_low_count = 0
    legacy_ambiguous_count = 0
    none_count = 0
    failure_counts: Counter[str] = Counter()
    failure_examples: dict[str, list[str]] = defaultdict(list)
    legacy_examples: dict[str, list[str]] = defaultdict(list)
    block_methods: dict[str, str] = {}  # JSON-serialised block_id → method tag

    dump = get_dump_resolver()

    for block_id, registry_name in sorted(id_map.items()):
        norm_name = registry_name.lower()

        # Stage 1: override
        override = _OVERRIDES.get(norm_name)
        if override and override in db.texture_colors:
            override_count += 1
            block_methods[str(block_id)] = "override"
            continue

        # Stage 2: Forge icon dump
        if dump.is_loaded:
            dr = dump.resolve(registry_name, 0)
            if dr.resolved and dr.texture_key:
                tex_key = resolve_db_key(dr.texture_key, db.texture_colors)
                if tex_key is not None:
                    tag = "forge_dump_ambiguous" if dr.is_ambiguous else "forge_dump"
                    block_methods[str(block_id)] = tag
                    if dr.is_ambiguous:
                        forge_dump_ambiguous_count += 1
                    else:
                        forge_dump_count += 1
                    continue

        # Stage 3: modern blockstate pipeline
        modern = resolve_block_texture(registry_name, 0, db)
        if modern.resolved:
            modern_count += 1
            block_methods[str(block_id)] = "modern"
            continue

        # Stage 4: legacy naming-convention resolver
        legacy = resolve_legacy_texture(registry_name, db.texture_colors, 0)
        if legacy.resolved:
            tag = legacy.method_tag  # e.g. "legacy_high", "legacy_low_ambiguous"
            block_methods[str(block_id)] = tag
            if legacy.is_ambiguous:
                legacy_ambiguous_count += 1
            if legacy.confidence == "high":
                legacy_high_count += 1
            elif legacy.confidence == "medium":
                legacy_medium_count += 1
            else:
                legacy_low_count += 1
            if len(legacy_examples[tag]) < 6:
                key_note = f" → {legacy.texture_key}"
                legacy_examples[tag].append(f"[{block_id}] {registry_name}{key_note}")
            continue

        none_count += 1
        block_methods[str(block_id)] = "none"
        cat = modern.failure_reason or "unknown"
        failure_counts[cat] += 1
        if len(failure_examples[cat]) < 8:
            failure_examples[cat].append(f"[{block_id}] {registry_name}")

    total = len(id_map)
    legacy_count = legacy_high_count + legacy_medium_count + legacy_low_count
    forge_dump_total = forge_dump_count + forge_dump_ambiguous_count
    resolved = override_count + forge_dump_total + modern_count + legacy_count
    return {
        "total": total,
        "pipeline_resolved": resolved,
        "pipeline_unresolved": none_count,
        "override_resolved": override_count,
        "forge_dump_resolved": forge_dump_count,
        "forge_dump_ambiguous": forge_dump_ambiguous_count,
        "forge_dump_loaded": dump.is_loaded,
        "forge_dump_path": dump.path,
        "forge_dump_block_count": dump.block_count,
        "modern_resolved": modern_count,
        "legacy_resolved": legacy_count,
        "legacy_high": legacy_high_count,
        "legacy_medium": legacy_medium_count,
        "legacy_low": legacy_low_count,
        "legacy_ambiguous": legacy_ambiguous_count,
        "blockstate_count": len(db.blockstates),
        "model_count": len(db.models),
        "texture_color_count": len(db.texture_colors),
        "categories": dict(failure_counts.most_common()),
        "examples": dict(failure_examples),
        "legacy_examples": dict(legacy_examples),
        "block_methods": block_methods,
    }


def trace_block_pipeline(world_path: str, registry_name: str, meta: int) -> dict[str, object]:
    """
    Trace all three pipeline stages for a single block.

    Returns step-by-step audit trail showing exactly which stage resolved the block
    (or why all three stages failed).  The 'method' field is one of:
    'override', 'modern', 'legacy', or 'none'.
    """
    db = _ensure_asset_db(world_path)
    trace: list[dict[str, object]] = []

    norm_name = registry_name.lower()

    # Stage 1: override
    override = _OVERRIDES.get(norm_name)
    if override:
        in_db = override in db.texture_colors
        status_note = "found" if in_db else "key not in texture DB"
        step = f"Override table: {norm_name!r} → {override!r} ({status_note})"
        trace.append({"ok": in_db, "step": step})
        if in_db:
            return {
                "registry_name": registry_name,
                "meta": meta,
                "resolved": True,
                "method": "override",
                "texture_key": override,
                "failure_reason": "",
                "trace": trace,
            }
    else:
        trace.append({"ok": True, "step": f"Override table: no entry for {norm_name!r}"})

    # Stage 2: Forge icon dump
    dump = get_dump_resolver()
    if dump.is_loaded:
        dr = dump.resolve(registry_name, meta)
        for msg in dr.trace:
            trace.append({"ok": dr.resolved, "step": f"Forge dump: {msg}"})
        if dr.resolved and dr.texture_key:
            tex_key = resolve_db_key(dr.texture_key, db.texture_colors)
            if tex_key is not None:
                method = "forge_dump_ambiguous" if dr.is_ambiguous else "forge_dump"
                trace.append({"ok": True, "step": (
                    f"Forge dump: icon {dr.texture_key!r} → {tex_key!r} "
                    f"found in texture DB (side {dr.side_used})"
                )})
                return {
                    "registry_name": registry_name,
                    "meta": meta,
                    "resolved": True,
                    "method": method,
                    "texture_key": tex_key,
                    "failure_reason": "",
                    "is_ambiguous": dr.is_ambiguous,
                    "side_used": dr.side_used,
                    "meta_exact": dr.meta_exact,
                    "trace": trace,
                }
            else:
                trace.append({"ok": False, "step": f"Forge dump: icon {dr.texture_key!r} not in texture DB — falling through"})
    else:
        trace.append({"ok": True, "step": "Forge dump: not loaded (install AtlasDumper mod and run GTNH once)"})

    # Stage 3: modern blockstate pipeline
    modern = resolve_block_texture(registry_name, meta, db)
    for t in modern.trace:
        trace.append({"ok": t.ok, "step": t.step})
    if modern.resolved:
        return {
            "registry_name": registry_name,
            "meta": meta,
            "resolved": True,
            "method": "modern",
            "texture_key": modern.texture_key,
            "failure_reason": "",
            "trace": trace,
        }

    # Stage 4: legacy naming-convention resolver
    legacy = resolve_legacy_texture(registry_name, db.texture_colors, meta)
    for msg in legacy.trace:
        trace.append({"ok": legacy.resolved, "step": f"Legacy resolver: {msg}"})

    if legacy.resolved:
        return {
            "registry_name": registry_name,
            "meta": meta,
            "resolved": True,
            "method": legacy.method_tag,
            "texture_key": legacy.texture_key,
            "failure_reason": "",
            "confidence": legacy.confidence,
            "is_ambiguous": legacy.is_ambiguous,
            "top_candidates": legacy.top_candidates,
            "trace": trace,
        }

    return {
        "registry_name": registry_name,
        "meta": meta,
        "resolved": False,
        "method": "none",
        "texture_key": None,
        "failure_reason": modern.failure_reason,
        "confidence": None,
        "is_ambiguous": False,
        "top_candidates": [],
        "trace": trace,
    }


def build_block_color_map(world_path: str) -> dict[int, list[int]]:
    """Build (or return cached) block-id → RGB color map."""
    if world_path in _color_cache:
        return _color_cache[world_path]

    path = Path(world_path)
    id_map = read_block_id_map(path)
    if not id_map:
        _color_cache[world_path] = {}
        return {}

    db = _ensure_asset_db(world_path)
    result = _build_color_map(id_map, db)

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

    db = _ensure_asset_db(world_path)
    result = _build_texture_key_map(id_map, db)

    # Fill vanilla blocks whose JAR textures weren't scanned.
    for block_id, registry_name in id_map.items():
        if block_id not in result:
            fallback = _VANILLA_TEXTURE_KEYS.get(registry_name.lower())
            if fallback:
                result[block_id] = fallback

    _texture_key_cache[world_path] = result
    return result


def build_block_meta_texture_map(world_path: str) -> dict[str, str]:
    """Build (or return cached) '{block_id}:{meta}' → texture-key for meta-variant blocks.

    Combines two sources, curated-first:
      1. Hardcoded vanilla meta tables (wool, stained glass/clay/pane, carpet,
         planks, logs, leaves) — reliable, always present.
      2. Forge icon-dump per-meta icons for every other block in the world
         (GregTech machines/casings/ores, Chisel variants, …) when a dump is
         loaded. Only metas whose texture differs from meta 0 are emitted.
    Keys are string-encoded so JSON serialisation works without conversion.
    """
    if world_path in _meta_texture_key_cache:
        return _meta_texture_key_cache[world_path]

    path = Path(world_path)
    id_map = read_block_id_map(path)
    if not id_map:
        _meta_texture_key_cache[world_path] = {}
        return {}

    db = _ensure_asset_db(world_path)  # also auto-loads the Forge icon dump
    result = _build_meta_texture_map_for_world(id_map)
    _augment_meta_map_from_dump(id_map, db, result)
    _meta_texture_key_cache[world_path] = result
    return result


def compute_dump_mismatch(world_path: str) -> dict[str, object]:
    """Compare a world's FML mod list against the loaded icon dump.

    Surfaces instance/version mismatches that cause "no mapping" blocks:
      - mods present in the world but absent from the dump (with how many
        blocks each contributes — those are the ones that won't resolve)
      - mods whose version differs between world and dump
      - differing total mod counts

    Returns ``{"dump_loaded": False}`` when no dump is loaded.
    """
    from collections import Counter

    path = Path(world_path)

    # Make sure the dump is loaded (no-op if already loaded).
    _try_auto_load_dump(find_minecraft_dir(path))
    dump = get_dump_resolver()
    if not dump.is_loaded:
        return {"dump_loaded": False}

    world_mods = read_world_modlist(path)
    dump_mods = dump.mods_map

    # Block count per mod domain (registry name prefix before ':').
    id_map = read_block_id_map(path)
    block_counts: Counter[str] = Counter(
        name.split(":", 1)[0] for name in id_map.values() if ":" in name
    )

    raw_missing: list[tuple[str, str, int]] = []  # (mod_id, world_version, block_count)
    version_mismatches: list[dict[str, object]] = []
    for mod_id, world_ver in world_mods.items():
        if mod_id not in dump_mods:
            raw_missing.append((mod_id, world_ver, int(block_counts.get(mod_id, 0))))
        elif dump_mods[mod_id] and world_ver and dump_mods[mod_id] != world_ver:
            version_mismatches.append({
                "mod_id": mod_id,
                "world_version": world_ver,
                "dump_version": dump_mods[mod_id],
            })

    # Most impactful first: mods that actually contribute blocks.
    raw_missing.sort(key=lambda t: -t[2])
    missing_with_blocks = sum(1 for t in raw_missing if t[2] > 0)
    missing_from_dump: list[dict[str, object]] = [
        {"mod_id": mid, "world_version": wv, "block_count": bc}
        for mid, wv, bc in raw_missing
    ]

    # ── Block-name-level check ─────────────────────────────────────────────
    # Compare every world block registry name against the dump's block keys.
    # A block missing while its mod *is* in the dump is "registration drift" —
    # the cause of un-textured blocks even when the mod lists otherwise agree
    # (e.g. ProjectRed: mod loaded, but its decorative block never dumped).
    raw_mblocks: list[tuple[int, str, str, bool]] = []  # (id, name, domain, mod_in_dump)
    drift_block_count = 0
    for block_id, reg_name in id_map.items():
        if ":" not in reg_name or dump.has_block(reg_name):
            continue
        domain = reg_name.split(":", 1)[0]
        mod_in_dump = domain in dump_mods
        if mod_in_dump:
            drift_block_count += 1
        raw_mblocks.append((block_id, reg_name, domain, mod_in_dump))

    missing_block_total = len(raw_mblocks)
    # Drift first (mod present but block absent — the surprising ones), then domain.
    # The client ranks these by on-map occurrence, so keep a generous cap.
    raw_mblocks.sort(key=lambda t: (not t[3], t[2], t[1]))
    block_cap = 1000
    missing_blocks: list[dict[str, object]] = [
        {"registry_name": rn, "block_id": bid, "domain": dom,
         "mod_in_dump": mid, "drift": mid}
        for bid, rn, dom, mid in raw_mblocks[:block_cap]
    ]

    count_differs = len(world_mods) != len(dump_mods)
    has_mismatch = bool(
        missing_from_dump or version_mismatches or count_differs or missing_block_total
    )

    # Mod-level severity. Block-level drift stays at "info" here because many
    # missing blocks are technical/TESR blocks that never appear on a top-down
    # map — the client escalates to "error" only when a missing block is actually
    # visible (has on-map occurrences), which avoids false alarms.
    #   error — a whole mod with blocks is absent from the dump
    #   warn  — mod versions differ (textures may be subtly wrong)
    #   info  — benign mod differences, or block drift within present mods
    #   ok    — world and dump agree
    if missing_with_blocks > 0:
        severity = "error"
    elif version_mismatches:
        severity = "warn"
    elif missing_from_dump or count_differs or missing_block_total:
        severity = "info"
    else:
        severity = "ok"

    return {
        "dump_loaded": True,
        "has_mismatch": has_mismatch,
        "severity": severity,
        "world_mod_count": len(world_mods),
        "dump_mod_count": len(dump_mods),
        "count_differs": count_differs,
        "missing_with_blocks": missing_with_blocks,
        "missing_from_dump": missing_from_dump,
        "version_mismatches": version_mismatches,
        "missing_block_total": missing_block_total,
        "drift_block_count": drift_block_count,
        "missing_blocks": missing_blocks,
    }


def build_missing_block_report(
    world_path: str,
    occurrences: dict[int, int] | None = None,
    metas: dict[int, list[int]] | None = None,
) -> dict[str, object]:
    """Build a diagnostic report of every world block absent from the icon dump.

    Each row joins the cheap backend facts (id, domain, mod versions, resolver
    result, fallback reason) with optional client-supplied on-map data
    (``occurrences`` = columns rendered, ``metas`` = metadata values seen).
    The block list is complete; occurrence/metas are 0/empty for blocks the
    client hasn't rendered yet.
    """
    from datetime import UTC, datetime

    occurrences = occurrences or {}
    metas = metas or {}

    path = Path(world_path)
    _try_auto_load_dump(find_minecraft_dir(path))
    dump = get_dump_resolver()
    world_mods = read_world_modlist(path)
    dump_mods = dump.mods_map
    id_map = read_block_id_map(path)
    db = _ensure_asset_db(world_path)

    rows: list[dict[str, object]] = []
    for block_id, reg_name in id_map.items():
        if ":" not in reg_name or (dump.is_loaded and dump.has_block(reg_name)):
            continue
        domain = reg_name.split(":", 1)[0]
        key, method = _resolve_unified(reg_name, 0, db)
        fallback_reason = ""
        if key is None:
            modern = resolve_block_texture(reg_name, 0, db)
            fallback_reason = modern.failure_reason or "no resolver matched"
        rows.append({
            "registry_name": reg_name,
            "block_id": block_id,
            "domain": domain,
            "metas_seen": sorted(metas.get(block_id, [])),
            "occurrence_columns": int(occurrences.get(block_id, 0)),
            "mod_in_dump": domain in dump_mods,
            "world_mod_version": world_mods.get(domain, ""),
            "dump_mod_version": dump_mods.get(domain, ""),
            "resolver_method": method,
            "resolver_texture_key": key,
            "fallback_reason": fallback_reason,
        })

    # Most impactful first: blocks actually covering the map.
    def _sort_key(r: dict[str, object]) -> tuple[int, str, str]:
        return (-int(r["occurrence_columns"]), str(r["domain"]), str(r["registry_name"]))  # type: ignore[call-overload]
    rows.sort(key=_sort_key)

    return {
        "format": "atlas-missing-block-report-v1",
        "generated_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "world_path": world_path,
        "dump_loaded": dump.is_loaded,
        "dump_path": dump.path,
        "summary": {
            "missing_block_count": len(rows),
            "drift_block_count": sum(1 for r in rows if r["mod_in_dump"]),
            "on_map_block_count": sum(1 for r in rows if int(r["occurrence_columns"]) > 0),  # type: ignore[call-overload]
        },
        "blocks": rows,
    }


def missing_block_report_csv(report: dict[str, object]) -> str:
    """Serialise a missing-block report (from build_missing_block_report) to CSV."""
    import csv
    import io

    fields = [
        "registry_name", "block_id", "domain", "metas_seen", "occurrence_columns",
        "mod_in_dump", "world_mod_version", "dump_mod_version",
        "resolver_method", "resolver_texture_key", "fallback_reason",
    ]
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=fields, extrasaction="ignore")
    writer.writeheader()
    for row in report.get("blocks", []):  # type: ignore[union-attr]
        out = dict(row)
        metas = out.get("metas_seen")
        if isinstance(metas, list):
            out["metas_seen"] = ";".join(str(m) for m in metas)
        writer.writerow(out)
    return buf.getvalue()


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
