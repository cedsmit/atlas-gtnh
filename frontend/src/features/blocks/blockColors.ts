const COLORS: Record<number, readonly [number, number, number]> = {
  // ── Terrain ────────────────────────────────────────────────────────────
  1: [122, 122, 122], // stone
  2: [74, 124, 63], // grass
  3: [139, 105, 20], // dirt
  4: [110, 110, 110], // cobblestone
  5: [196, 165, 90], // planks
  7: [51, 51, 51], // bedrock
  8: [42, 106, 173], // water flowing
  9: [42, 106, 173], // water still
  10: [226, 88, 34], // lava flowing
  11: [226, 88, 34], // lava still
  12: [232, 213, 163], // sand
  13: [136, 136, 136], // gravel
  14: [201, 177, 55], // gold ore
  15: [160, 112, 112], // iron ore
  16: [51, 51, 51], // coal ore
  17: [107, 76, 17], // log
  18: [45, 125, 39], // leaves
  19: [195, 180, 75], // sponge
  20: [173, 200, 216], // glass
  21: [59, 107, 140], // lapis ore
  22: [64, 96, 176], // lapis block
  23: [110, 110, 110], // dispenser
  24: [217, 199, 132], // sandstone
  25: [107, 76, 17], // note block
  // ── Plants & small blocks ──────────────────────────────────────────────
  6: [56, 107, 34], // sapling
  26: [190, 70, 70], // bed
  27: [136, 136, 136], // powered rail
  28: [110, 110, 110], // detector rail
  29: [122, 122, 122], // sticky piston
  30: [200, 200, 200], // cobweb
  31: [74, 124, 63], // tallgrass / fern
  32: [119, 85, 32], // dead bush
  33: [122, 122, 122], // piston
  34: [122, 122, 122], // piston head
  35: [208, 208, 208], // wool
  37: [210, 200, 30], // dandelion
  38: [200, 60, 60], // rose / poppy / flower
  39: [119, 85, 32], // brown mushroom
  40: [180, 40, 40], // red mushroom
  41: [255, 215, 0], // gold block
  42: [189, 189, 189], // iron block
  43: [136, 136, 136], // double stone slab
  44: [136, 136, 136], // stone slab
  45: [156, 69, 53], // brick
  46: [176, 80, 50], // tnt
  47: [107, 76, 17], // bookshelf
  48: [68, 85, 51], // mossy cobblestone
  49: [26, 10, 46], // obsidian
  50: [240, 192, 96], // torch
  51: [240, 140, 30], // fire
  52: [40, 70, 60], // mob spawner
  53: [196, 165, 90], // oak stairs
  54: [106, 84, 27], // chest
  55: [120, 0, 0], // redstone wire
  56: [79, 205, 196], // diamond ore
  57: [127, 255, 244], // diamond block
  58: [107, 76, 17], // crafting table
  59: [140, 170, 40], // wheat crops
  60: [100, 65, 15], // farmland
  61: [117, 117, 117], // furnace
  62: [117, 117, 117], // burning furnace
  63: [196, 165, 90], // sign post
  64: [107, 76, 17], // oak door
  65: [107, 76, 17], // ladder
  66: [136, 136, 136], // rail
  67: [110, 110, 110], // cobblestone stairs
  68: [196, 165, 90], // wall sign
  69: [122, 122, 122], // lever
  70: [110, 110, 110], // stone pressure plate
  71: [160, 160, 160], // iron door
  72: [196, 165, 90], // wood pressure plate
  73: [140, 51, 51], // redstone ore
  74: [140, 51, 51], // lit redstone ore
  75: [80, 0, 0], // redstone torch off
  76: [200, 30, 30], // redstone torch on
  77: [122, 122, 122], // stone button
  78: [232, 240, 240], // snow layer
  79: [160, 200, 224], // ice
  80: [232, 240, 240], // snow block
  81: [40, 100, 30], // cactus
  82: [144, 144, 160], // clay
  83: [102, 179, 77], // sugar cane
  84: [107, 76, 17], // jukebox
  85: [107, 76, 17], // fence
  86: [210, 110, 20], // pumpkin
  87: [126, 34, 34], // netherrack
  88: [78, 58, 42], // soul sand
  89: [240, 192, 96], // glowstone
  90: [100, 30, 160], // portal
  91: [210, 110, 20], // jack o lantern
  92: [220, 180, 160], // cake
  93: [122, 122, 122], // repeater off
  94: [122, 122, 122], // repeater on
  95: [173, 200, 216], // stained glass
  96: [107, 76, 17], // trapdoor
  97: [122, 122, 122], // monster egg / silverfish block
  98: [119, 119, 119], // stone bricks
  99: [119, 85, 32], // brown mushroom block
  100: [180, 40, 40], // red mushroom block
  101: [160, 160, 160], // iron bars
  102: [173, 200, 216], // glass pane
  103: [110, 165, 50], // melon block
  104: [75, 115, 30], // pumpkin stem
  105: [75, 115, 30], // melon stem
  106: [45, 125, 39], // vine
  107: [107, 76, 17], // fence gate
  108: [156, 69, 53], // brick stairs
  109: [119, 119, 119], // stone brick stairs
  110: [110, 70, 110], // mycelium
  111: [30, 100, 30], // lily pad
  112: [59, 28, 33], // nether brick
  113: [59, 28, 33], // nether brick fence
  114: [59, 28, 33], // nether brick stairs
  115: [120, 30, 30], // nether wart
  116: [75, 40, 90], // enchanting table
  117: [100, 80, 50], // brewing stand
  118: [100, 80, 50], // cauldron
  119: [20, 10, 40], // end portal
  120: [217, 215, 160], // end portal frame
  121: [217, 215, 160], // end stone
  122: [17, 17, 17], // dragon egg
  123: [220, 160, 60], // redstone lamp off
  124: [250, 230, 120], // redstone lamp on
  125: [196, 165, 90], // double wood slab
  126: [196, 165, 90], // wood slab
  127: [130, 80, 30], // cocoa
  128: [217, 199, 132], // sandstone stairs
  129: [79, 205, 196], // emerald ore
  130: [26, 10, 46], // ender chest
  131: [107, 76, 17], // tripwire hook
  132: [200, 200, 200], // tripwire
  133: [76, 217, 100], // emerald block
  134: [107, 76, 17], // spruce stairs
  135: [196, 183, 119], // birch stairs
  136: [107, 76, 17], // jungle stairs
  137: [110, 110, 110], // command block
  138: [120, 170, 200], // beacon
  139: [110, 110, 110], // cobblestone wall
  140: [107, 76, 17], // flower pot
  141: [170, 100, 30], // carrots
  142: [150, 120, 40], // potatoes
  143: [196, 165, 90], // wood button
  144: [200, 200, 180], // skull
  145: [136, 136, 136], // anvil
  146: [106, 84, 27], // trapped chest
  147: [200, 170, 50], // heavy weighted pressure plate
  148: [160, 160, 160], // light weighted pressure plate
  149: [122, 122, 122], // comparator off
  150: [122, 122, 122], // comparator on
  151: [200, 180, 90], // daylight detector
  152: [180, 20, 20], // redstone block
  153: [126, 34, 34], // nether quartz ore
  154: [110, 110, 110], // hopper
  155: [224, 221, 216], // quartz block
  156: [224, 221, 216], // quartz stairs
  157: [136, 136, 136], // activator rail
  158: [110, 110, 110], // dropper
  159: [139, 105, 20], // stained hardened clay
  160: [173, 200, 216], // stained glass pane
  161: [45, 125, 39], // acacia/dark oak leaves
  162: [125, 90, 42], // acacia/dark oak log
  163: [107, 76, 17], // acacia stairs
  164: [60, 40, 10], // dark oak stairs
  165: [80, 160, 80], // slime block
  166: [0, 0, 0], // barrier (invisible)
  167: [160, 160, 160], // iron trapdoor
  168: [110, 160, 160], // prismarine
  169: [200, 230, 200], // sea lantern
  170: [185, 165, 35], // hay block
  171: [208, 208, 208], // carpet
  172: [139, 105, 20], // hardened clay
  173: [17, 17, 17], // coal block
  174: [160, 200, 224], // packed ice
  175: [74, 124, 63], // double plants (sunflower top → yellow, rest → green)
  176: [200, 160, 80], // freestanding banner
  177: [200, 160, 80], // wall banner
  178: [200, 180, 90], // inverted daylight detector
  179: [190, 100, 60], // red sandstone
  180: [190, 100, 60], // red sandstone stairs
  181: [190, 100, 60], // double red sandstone slab
  182: [190, 100, 60], // red sandstone slab
}

// Modded block color overrides keyed by numeric block ID.
// Add entries here when a block's color is identified via debug-top-blocks.
// Modded block color overrides for blocks that have no texture scan result
// and are NOT biome-tinted. Add entries here when debug-top-blocks identifies
// an unknown block that should have a stable color.
const MODDED_COLORS: Record<number, readonly [number, number, number]> = {
  // (BiomesOPlenty colorizedLeaves 1375/1376 are now in FOLIAGE_TINTED_IDS
  //  so they pick up the correct biome foliage color automatically.)
}

// ── Biome tint tables ──────────────────────────────────────────────────────
// Grass and foliage colors per biome ID, as [R,G,B].
// Derived from Minecraft 1.7.10's temperature/humidity colormap.
// Swamp is a special case: the grass colormap result is then averaged with 0x4E4E10.
// BOP biome IDs sourced from E:\GT - New Horizons 2.8\config\biomesoplenty\ids.cfg.
type RGB = readonly [number, number, number]

const BIOME_GRASS: Record<number, RGB> = {
  //  ID  Name
  0: [142, 185, 113], // Ocean
  1: [145, 189, 89], // Plains
  2: [191, 183, 85], // Desert
  3: [138, 182, 137], // Extreme Hills
  4: [121, 192, 90], // Forest
  5: [134, 183, 131], // Taiga
  6: [106, 112, 57], // Swampland (post-blend with 0x4E4E10)
  7: [142, 185, 113], // River
  8: [191, 59, 59], // Hell (Nether)
  9: [142, 185, 113], // Sky (End)
  10: [128, 180, 151], // FrozenOcean
  11: [128, 180, 151], // FrozenRiver
  12: [128, 180, 151], // IcePlains
  13: [128, 180, 151], // IceMountains
  14: [85, 201, 63], // MushroomIsland
  15: [85, 201, 63], // MushroomIslandShore
  16: [145, 189, 89], // Beach
  17: [191, 183, 85], // DesertHills
  18: [121, 192, 90], // ForestHills
  19: [134, 183, 131], // TaigaHills
  20: [138, 182, 137], // ExtremeHillsEdge
  21: [89, 201, 60], // Jungle
  22: [89, 201, 60], // JungleHills
  23: [100, 199, 63], // JungleEdge
  24: [142, 185, 113], // DeepOcean
  25: [157, 168, 68], // StoneBeach
  26: [128, 180, 151], // ColdBeach
  27: [136, 187, 103], // BirchForest
  28: [136, 187, 103], // BirchForestHills
  29: [80, 122, 50], // RoofedForest
  30: [128, 180, 151], // ColdTaiga
  31: [128, 180, 151], // ColdTaigaHills
  32: [134, 184, 127], // MegaTaiga
  33: [134, 184, 127], // MegaTaigaHills
  34: [138, 182, 137], // ExtremeHillsPlus
  35: [191, 183, 85], // Savanna
  36: [191, 183, 85], // SavannaPlateau
  37: [144, 129, 77], // Mesa
  38: [144, 129, 77], // MesaPlateauF
  39: [144, 129, 77], // MesaPlateauFForest
  // BOP biomes (from ids.cfg + approximate colors)
  55: [118, 200, 86], // BOP Tropical Rainforest
  56: [75, 178, 75], // BOP Lush Swamp
  57: [145, 192, 97], // BOP Meadow
  60: [85, 165, 75], // BOP Woodland
  65: [120, 155, 75], // BOP Fungi Forest
  66: [139, 189, 100], // BOP Prairie
  67: [145, 191, 89], // BOP Orchard
  68: [110, 178, 90], // BOP Shrubland
  70: [95, 175, 80], // BOP Temperate Rainforest
  71: [133, 175, 117], // BOP Highland (temp=0.5, rain=0.6)
  87: [130, 100, 180], // BOP Mystic Grove   ← deep violet grass
  89: [68, 72, 50], // BOP Ominous Woods  ← dark murky
  90: [115, 185, 105], // BOP Boreal Forest
}

const BIOME_FOLIAGE: Record<number, RGB> = {
  0: [113, 167, 77], // Ocean
  1: [119, 171, 47], // Plains
  2: [174, 164, 42], // Desert
  3: [109, 163, 107], // Extreme Hills
  4: [89, 174, 48], // Forest
  5: [104, 165, 90], // Taiga
  6: [106, 112, 57], // Swampland
  7: [113, 167, 77], // River
  8: [159, 68, 68], // Hell
  9: [113, 167, 77], // Sky
  10: [96, 161, 123], // FrozenOcean
  11: [96, 161, 123], // FrozenRiver
  12: [96, 161, 123], // IcePlains
  13: [96, 161, 123], // IceMountains
  14: [43, 187, 15], // MushroomIsland
  15: [43, 187, 15], // MushroomIslandShore
  16: [119, 171, 47], // Beach
  17: [174, 164, 42], // DesertHills
  18: [89, 174, 48], // ForestHills
  19: [104, 165, 90], // TaigaHills
  20: [109, 163, 107], // ExtremeHillsEdge
  21: [48, 187, 11], // Jungle
  22: [48, 187, 11], // JungleHills
  23: [62, 184, 15], // JungleEdge
  24: [113, 167, 77], // DeepOcean
  25: [109, 163, 107], // StoneBeach
  26: [96, 161, 123], // ColdBeach
  27: [107, 169, 65], // BirchForest
  28: [107, 169, 65], // BirchForestHills
  29: [90, 137, 57], // RoofedForest
  30: [96, 161, 123], // ColdTaiga
  31: [96, 161, 123], // ColdTaigaHills
  32: [104, 165, 90], // MegaTaiga
  33: [104, 165, 90], // MegaTaigaHills
  34: [109, 163, 107], // ExtremeHillsPlus
  35: [174, 164, 42], // Savanna
  36: [174, 164, 42], // SavannaPlateau
  37: [158, 129, 77], // Mesa
  38: [158, 129, 77], // MesaPlateauF
  39: [158, 129, 77], // MesaPlateauFForest
  // BOP
  55: [60, 180, 40], // BOP Tropical Rainforest
  56: [60, 150, 60], // BOP Lush Swamp
  65: [90, 135, 65], // BOP Fungi Forest
  71: [105, 158, 95], // BOP Highland foliage (temp=0.5, rain=0.6)
  87: [110, 75, 170], // BOP Mystic Grove foliage ← deep violet
  89: [55, 68, 40], // BOP Ominous Woods foliage
}

const DEFAULT_GRASS: RGB = [145, 189, 89] // plains-like default
const DEFAULT_FOLIAGE: RGB = [119, 171, 47]

// Blocks whose color is replaced by the biome GRASS tint
export const GRASS_TINTED_IDS = new Set([2, 31, 175])

// Blocks whose color is replaced by the biome FOLIAGE tint.
// Includes modded leaf blocks that follow the same biome-tint convention.
export const FOLIAGE_TINTED_IDS = new Set([
  18,
  106,
  111,
  161, // vanilla leaves, vine, lily pad, acacia/dark oak leaves
  1375,
  1376, // BiomesOPlenty:colorizedLeaves1/2 — biome-tinted canopy
])

export function biomeTints(biomeId: number): { grass: RGB; foliage: RGB } {
  // Prefer an exact entry for this id (covers custom BOP/GTNH biomes), then the
  // vanilla "mutated" convention where a mutated biome (base + 128) reuses its
  // base variant's tint, then the default. Checking the raw id first stops a
  // custom biome with id >= 128 from being silently remapped to a vanilla tint.
  const mutatedBase = biomeId >= 128 ? biomeId - 128 : -1
  return {
    grass: BIOME_GRASS[biomeId] ?? BIOME_GRASS[mutatedBase] ?? DEFAULT_GRASS,
    foliage:
      BIOME_FOLIAGE[biomeId] ?? BIOME_FOLIAGE[mutatedBase] ?? DEFAULT_FOLIAGE,
  }
}

function hslToRgb(
  h: number,
  s: number,
  l: number
): readonly [number, number, number] {
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => {
    const k = (n + h / 30) % 12
    return Math.round((l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))) * 255)
  }
  return [f(0), f(8), f(4)]
}

// ── Meta-variant fallback colors ───────────────────────────────────────────────
// Used when a meta-specific texture hasn't loaded yet. Avoids showing the
// generic single-meta color (e.g. white wool) for all variants.

const WOOL_META: readonly (readonly [number, number, number])[] = [
  [233, 236, 236], // 0  white
  [240, 118, 19], // 1  orange
  [189, 68, 179], // 2  magenta
  [107, 138, 201], // 3  light blue
  [248, 197, 39], // 4  yellow
  [112, 185, 25], // 5  lime
  [237, 141, 172], // 6  pink
  [62, 68, 71], // 7  gray
  [142, 142, 134], // 8  light gray
  [21, 137, 145], // 9  cyan
  [121, 42, 172], // 10 purple
  [53, 57, 157], // 11 blue
  [114, 71, 40], // 12 brown
  [84, 109, 27], // 13 green
  [161, 39, 34], // 14 red
  [20, 21, 25], // 15 black
]

const GLASS_META: readonly (readonly [number, number, number])[] = [
  [214, 224, 228], // 0  white
  [235, 160, 75], // 1  orange
  [210, 139, 200], // 2  magenta
  [163, 186, 220], // 3  light blue
  [237, 228, 76], // 4  yellow
  [165, 212, 136], // 5  lime
  [236, 172, 186], // 6  pink
  [126, 133, 135], // 7  gray
  [189, 194, 188], // 8  light gray
  [133, 193, 199], // 9  cyan
  [170, 130, 198], // 10 purple
  [130, 135, 201], // 11 blue
  [165, 133, 115], // 12 brown
  [153, 178, 119], // 13 green
  [196, 130, 127], // 14 red
  [104, 107, 112], // 15 black
]

const CLAY_META: readonly (readonly [number, number, number])[] = [
  [209, 177, 161], // 0  white
  [162, 84, 38], // 1  orange
  [149, 88, 108], // 2  magenta
  [113, 108, 138], // 3  light blue
  [186, 133, 36], // 4  yellow
  [103, 117, 53], // 5  lime
  [162, 78, 79], // 6  pink
  [58, 58, 58], // 7  gray
  [136, 127, 120], // 8  light gray
  [86, 91, 91], // 9  cyan
  [118, 70, 86], // 10 purple
  [74, 60, 91], // 11 blue
  [77, 51, 35], // 12 brown
  [76, 83, 42], // 13 green
  [143, 61, 46], // 14 red
  [37, 22, 16], // 15 black
]

const PLANK_META: readonly (readonly [number, number, number])[] = [
  [196, 165, 90], // 0 oak
  [116, 82, 52], // 1 spruce
  [199, 186, 125], // 2 birch
  [155, 122, 73], // 3 jungle
  [168, 90, 50], // 4 acacia
  [75, 45, 15], // 5 dark oak
]

const LOG_META: readonly (readonly [number, number, number])[] = [
  [107, 76, 17], // oak
  [80, 70, 50], // spruce
  [175, 165, 120], // birch
  [97, 82, 28], // jungle
]

const LOG2_META: readonly (readonly [number, number, number])[] = [
  [125, 90, 42], // acacia
  [60, 40, 10], // dark oak
]

// Standard Minecraft dye colors in meta 0–15 order (wool, stained glass, dyed blocks, etc.)
export const STANDARD_DYE_COLORS: readonly (readonly [
  number,
  number,
  number,
])[] = [
  [240, 240, 240], // 0  white
  [242, 130, 26], // 1  orange
  [199, 78, 189], // 2  magenta
  [58, 175, 217], // 3  light blue
  [247, 227, 66], // 4  yellow
  [112, 185, 25], // 5  lime
  [237, 141, 172], // 6  pink
  [62, 68, 71], // 7  gray
  [142, 142, 134], // 8  light gray
  [21, 137, 145], // 9  cyan
  [121, 42, 172], // 10 purple
  [53, 57, 157], // 11 blue
  [114, 71, 40], // 12 brown
  [84, 109, 27], // 13 green
  [161, 39, 34], // 14 red
  [20, 21, 25], // 15 black
]

/**
 * Resolve a per-metadata tint color.
 * 1. Uses tintColors[meta & 15] if provided (hex string, e.g. "#4eb234")
 * 2. Falls back to STANDARD_DYE_COLORS[meta & 15]
 * 3. Returns white if neither is available
 */
export function resolveMetadataTint(
  meta: number,
  tintColors?: readonly string[]
): readonly [number, number, number] {
  const idx = meta & 15
  if (tintColors) {
    const hex = tintColors[idx]
    if (hex) {
      const c = parseInt(hex.replace('#', ''), 16)
      // Fall through to the dye defaults when the hex is malformed (NaN would
      // otherwise render as black).
      if (!Number.isNaN(c)) return [(c >> 16) & 255, (c >> 8) & 255, c & 255]
    }
  }
  return STANDARD_DYE_COLORS[idx] ?? [255, 255, 255]
}

/**
 * Return a hardcoded per-meta color for blocks whose appearance varies by
 * metadata (wool, stained glass/clay, planks, logs, leaves).
 * Returns null for blocks where meta doesn't affect color.
 */
export function metaBlockColorRGB(
  id: number,
  meta: number
): readonly [number, number, number] | null {
  switch (id) {
    case 35:
      return WOOL_META[meta & 15] ?? null // wool
    case 171:
      return WOOL_META[meta & 15] ?? null // carpet
    case 95:
      return GLASS_META[meta & 15] ?? null // stained glass
    case 160:
      return GLASS_META[meta & 15] ?? null // stained glass pane
    case 159:
      return CLAY_META[meta & 15] ?? null // stained hardened clay
    case 5:
      return PLANK_META[meta & 7] ?? PLANK_META[0] // planks (meta 6/7 → oak)
    case 17:
      return LOG_META[meta & 3] ?? null // log
    case 162:
      return LOG2_META[meta & 1] ?? null // log2 (acacia/dark oak)
    default:
      return null
  }
}

export function hardcodedBlockColor(
  id: number
): readonly [number, number, number] | null {
  return COLORS[id] ?? MODDED_COLORS[id] ?? null
}

export function blockColorRGB(
  id: number,
  meta: number
): readonly [number, number, number] {
  const c = COLORS[id] ?? MODDED_COLORS[id]
  if (c) return c
  // Golden-angle hue distribution ensures adjacent block IDs get distinct colors.
  // L=0.45 / S=0.55 guarantees the brightest channel is ~178/255 — always visible.
  const hue = (((id * 137 + meta * 23) % 360) + 360) % 360
  return hslToRgb(hue, 0.55, 0.45)
}
