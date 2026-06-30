"""Static vanilla / override lookup tables for block colour & texture resolution.

Pure data extracted from block_color_resolution so the resolver module is logic,
not hundreds of lines of dict literals.
"""

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
    "gregtech:gt.blockcasings6":                   "gregtech:blockcasing",
    "gregtech:gt.blockcasings8":                   "gregtech:blockcasing",
    "gregtech:gt.blockcasings9":                   "gregtech:blockcasing",
    "gregtech:gt.blockcasings10":                  "gregtech:blockcasing",
    "gregtech:gt.blockcasings11":                  "gregtech:blockcasing",
    "gregtech:gt.blockcasings12":                  "gregtech:blockcasing",
    "gregtech:gt.blockcasings13":                  "gregtech:blockcasing",
    "gregtech:gt.blockcasingsnh":                  "gregtech:blockcasing",
    "gregtech:gt.blockcasings.cyclotron_coils":    "gregtech:blockcasing",
    # GT solid utility blocks (not TESR machines) — map to their JAR textures.
    "gregtech:gt.blockglass1":                     "gregtech:glass_ph_resistant",
    "gregtech:gt.blocktintedglass":                "gregtech:glass_tinted_industrial_gray",
    "gregtech:gt.laserplate":                      "gregtech:iconsets/laser_plate",
    "gregtech:gt.block.longdistancepipe":          "gregtech:em_pipe",

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

    # ── Chisel blocks the dump missed (CTM/meta-variant; representative texture) ─
    "chisel:amber":           "chisel:amberblock",
    "chisel:bloodbrick":      "chisel:bloodmagic/bloodrunebricks",
    "chisel:futuracircuit":   "chisel:futura/circuitplate-v9",
    "chisel:hexlargeplating": "chisel:hexplating/hexbase",
    "chisel:technical3":      "chisel:technical/industrialrelic",

    # ── FloodLights ────────────────────────────────────────────────────────
    # (tilePhantomLight is an invisible light source — intentionally unmapped.)
    "floodlights:smallelectricfloodlightmetablock": "floodlights:electricfloodlight_top",

    # ── Cooking for Blockheads ─────────────────────────────────────────────
    "cookingforblockheads:cookingtable": "cookingforblockheads:cooking_table_top",
}

# Suffixes tried in order when no direct match is found.
_FALLBACK_SUFFIXES = [
    "_top", "_side", "_front", "_back", "_bottom", "_normal",
    "_0", "_1", "_2", "_3", "_4", "_5",
    "_6", "_7", "_8", "_9", "_10", "_11", "_12", "_13", "_14", "_15",
    "_on", "_off", "_active", "_inactive",
]

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

_WOOL_COLORS = [
    "white", "orange", "magenta", "light_blue", "yellow", "lime",
    "pink", "gray", "silver", "cyan", "purple", "blue", "brown",
    "green", "red", "black",
]

_LOG_WOODS    = ["oak", "spruce", "birch", "jungle"]

_ACACIA_WOODS = ["acacia", "big_oak"]

_PLANK_WOODS  = ["oak", "spruce", "birch", "jungle", "acacia", "big_oak"]
