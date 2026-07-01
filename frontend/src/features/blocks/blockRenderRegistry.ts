/**
 * Data-driven render registry for block classification.
 *
 * Definitions are loaded from two sources and merged:
 *   1. Built-in TypeScript entries (VANILLA_BY_ID): vanilla blocks keyed by
 *      stable numeric ID — guaranteed to work even before blockNames resolves.
 *   2. JSON definition files (src/render-rules/*.json): keyed by FML registry
 *      name, resolved to numeric IDs via the world's blockNames map.
 *
 * Use createResolvedRegistry(blockNames?) to get a ready-to-use instance.
 * Call registry.lookup(id) during rendering for O(1) definition access.
 */

export type TintType = 'grass' | 'foliage' | 'water'
export type AlphaMode = 'opaque' | 'cutout' | 'blend'
export type RenderCategory =
  | 'solid'
  | 'overlay'
  | 'fluid'
  | 'transparent'
  | 'partial'
  | 'ignore'

/**
 * Controls how the block is rendered on the 2-D top-down map.
 *   texture  – draw the block's top-face texture (default)
 *   flat     – fill with mapColor only (no texture)
 *   overlay  – composite texture over the terrain below at reduced impact
 *   marker   – draw a tiny solid-color square (e.g. torches in Detailed mode)
 *   ignore   – omit from the map entirely in this mode
 */
export type MapRenderMode = 'texture' | 'flat' | 'overlay' | 'marker' | 'ignore'

/**
 * Minimum detail level at which this block appears on the map.
 *   clean    – visible in all modes (default for terrain/structures)
 *   detailed – hidden in Clean mode; shown in Detailed and Debug
 *   debug    – only shown in Debug mode
 */
export type MapVisibility = 'clean' | 'detailed' | 'debug'

/** The three map detail levels selectable in the UI. */
export type MapMode = 'clean' | 'detailed' | 'debug'

export interface BlockRenderDefinition {
  category: RenderCategory
  tint?: TintType
  topTexture?: string
  sideTexture?: string
  bottomTexture?: string
  alphaMode?: AlphaMode
  overlayPriority?: number
  renderHeight?: number // 0.0–1.0; 1.0 = full-block height

  // ── 2-D map hints ──────────────────────────────────────────────────────
  mapRenderMode?: MapRenderMode // how to draw on the map (default: "texture")
  mapVisibility?: MapVisibility // minimum mode to appear (default: "clean")
  mapOpacity?: number // 0.0–1.0; alpha for flat/transparent rendering (default: 0.40)
  mapIcon?: string // future: small SVG/PNG icon path
  mapColor?: string // CSS color for flat/marker rendering

  // ── Preset tags ────────────────────────────────────────────────────────
  // Strings matched against RenderConfig.hiddenTags to control preset visibility.
  // Well-known tags: torch, flower, tallgrass, rail, redstone, machine, pipe, cable
  blockTags?: readonly string[]

  // ── Texture alias + tinting ────────────────────────────────────────────
  // For blocks that inherit another block's texture and/or apply a per-meta
  // color tint at render time (e.g. Ztones glaxx uses vanilla glass + dye tint).
  textureAlias?: string // use this texture key instead of the block's own
  textureTint?: 'none' | 'metadata16' | 'custom' // how to derive the block's color tint
  textureTintColors?: readonly string[] // hex colors indexed by metadata (for 'custom')
  preserveAlpha?: boolean // keep texture alpha through tint compositing
}

export interface ResolvedDefinition extends BlockRenderDefinition {
  resolverSource: string // 'builtin' | 'vanilla.json' | 'thaumcraft.json' | …
}

/** True when def should be rendered in the given map mode. */
export function isVisibleInMode(
  def: ResolvedDefinition,
  mode: MapMode
): boolean {
  const vis = def.mapVisibility ?? 'clean'
  if (mode === 'debug') return true
  if (mode === 'detailed') return vis === 'clean' || vis === 'detailed'
  return vis === 'clean'
}

const DEFAULT_DEF: ResolvedDefinition = {
  category: 'solid',
  alphaMode: 'opaque',
  resolverSource: 'default',
}

// ── Built-in vanilla definitions keyed by stable numeric ID ──────────────────
// These act as the guaranteed baseline regardless of JSON file availability.
// JSON files can override any of these via name-based resolution.
const VANILLA_BY_ID: Record<number, BlockRenderDefinition> = {
  // ── Ignore ──────────────────────────────────────────────────────────────
  0: { category: 'ignore' },
  166: { category: 'ignore' },

  // ── Fluid ───────────────────────────────────────────────────────────────
  8: { category: 'fluid', tint: 'water' }, // flowing water
  9: { category: 'fluid', tint: 'water' }, // still water
  10: { category: 'fluid' }, // flowing lava
  11: { category: 'fluid' }, // still lava

  // ── Grass-tinted ────────────────────────────────────────────────────────
  2: { category: 'solid', tint: 'grass' }, // grass block
  31: { category: 'overlay', tint: 'grass' }, // tallgrass / fern
  175: { category: 'overlay', tint: 'grass' }, // double plant (sunflower, double tallgrass…)

  // ── Foliage-tinted ──────────────────────────────────────────────────────
  18: { category: 'solid', tint: 'foliage', alphaMode: 'cutout' }, // leaves
  161: { category: 'solid', tint: 'foliage', alphaMode: 'cutout' }, // acacia/dark oak leaves
  106: { category: 'overlay', tint: 'foliage' }, // vine
  111: { category: 'overlay', tint: 'foliage' }, // lily pad

  // ── Overlay: plants / flora ─────────────────────────────────────────────
  6: { category: 'overlay' }, // sapling
  32: { category: 'overlay' }, // dead bush
  37: { category: 'overlay' }, // dandelion
  38: { category: 'overlay' }, // rose / poppy / flower
  39: { category: 'overlay' }, // brown mushroom
  40: { category: 'overlay' }, // red mushroom
  83: { category: 'overlay' }, // sugar cane
  104: { category: 'overlay' }, // pumpkin stem
  105: { category: 'overlay' }, // melon stem
  115: { category: 'overlay' }, // nether wart
  127: { category: 'overlay' }, // cocoa bean
  141: { category: 'overlay' }, // carrots
  142: { category: 'overlay' }, // potatoes

  // ── Overlay: rails ──────────────────────────────────────────────────────
  27: { category: 'overlay' }, // powered rail
  28: { category: 'overlay' }, // detector rail
  66: { category: 'overlay' }, // rail
  157: { category: 'overlay' }, // activator rail

  // ── Overlay: redstone ───────────────────────────────────────────────────
  55: { category: 'overlay' }, // redstone wire
  75: { category: 'overlay' }, // redstone torch (off)
  76: { category: 'overlay' }, // redstone torch (on)
  93: { category: 'overlay' }, // repeater (off)
  94: { category: 'overlay' }, // repeater (on)

  // ── Overlay: light sources / fire ───────────────────────────────────────
  50: { category: 'overlay' }, // torch
  51: { category: 'overlay', blockTags: ['fire'] }, // fire (hidden by default)

  // ── Overlay: surface items / furniture ──────────────────────────────────
  26: { category: 'overlay' }, // bed
  63: { category: 'overlay' }, // sign (standing)
  65: { category: 'overlay' }, // ladder
  68: { category: 'overlay' }, // sign (wall)
  69: { category: 'overlay' }, // lever
  70: { category: 'overlay' }, // stone pressure plate
  72: { category: 'overlay' }, // wood pressure plate
  77: { category: 'overlay' }, // stone button
  78: { category: 'overlay' }, // snow layer
  131: { category: 'overlay' }, // tripwire hook
  132: { category: 'overlay' }, // tripwire
  143: { category: 'overlay' }, // wood button
  147: { category: 'overlay' }, // heavy weighted pressure plate
  148: { category: 'overlay' }, // light weighted pressure plate
  171: { category: 'overlay' }, // carpet

  // ── Overlay: thin / mesh blocks ─────────────────────────────────────────
  30: { category: 'overlay', alphaMode: 'cutout' }, // cobweb
  101: { category: 'overlay', alphaMode: 'cutout' }, // iron bars
  102: { category: 'overlay', alphaMode: 'blend' }, // glass pane
  160: { category: 'overlay', alphaMode: 'blend' }, // stained glass pane

  // ── Transparent solids ───────────────────────────────────────────────────
  // These define terrain height (like solid) but render with alpha blending.
  20: { category: 'transparent', alphaMode: 'blend' }, // glass
  79: { category: 'transparent', alphaMode: 'blend' }, // ice
  95: { category: 'transparent', alphaMode: 'blend' }, // stained glass
}

// ── JSON file format ─────────────────────────────────────────────────────────
interface RegistryJson {
  format?: number
  source?: string
  blocks: Record<string, Partial<BlockRenderDefinition>>
}

// ── Registry class ────────────────────────────────────────────────────────────
export class BlockRenderRegistry {
  private readonly byId = new Map<number, ResolvedDefinition>()
  private readonly byName = new Map<
    string,
    { def: BlockRenderDefinition; source: string }
  >()

  constructor() {
    for (const [rawId, def] of Object.entries(VANILLA_BY_ID)) {
      this.byId.set(Number(rawId), { ...def, resolverSource: 'builtin' })
    }
  }

  /** Merge block definitions from a JSON file. Call before resolveNames(). */
  loadJson(json: RegistryJson): void {
    const source = json.source ?? 'json'
    for (const [name, partial] of Object.entries(json.blocks)) {
      if (!partial.category) continue
      this.byName.set(name, { def: partial as BlockRenderDefinition, source })
    }
  }

  /**
   * Resolve name-keyed entries into numeric IDs using the world's FML block
   * name registry.  JSON entries override built-in numeric entries.
   * Call once per world load after all loadJson() calls.
   */
  resolveNames(blockNames: Record<number, string>): void {
    for (const [rawId, name] of Object.entries(blockNames)) {
      const entry = this.byName.get(name)
      if (entry) {
        this.byId.set(Number(rawId), {
          ...entry.def,
          resolverSource: entry.source,
        })
      }
    }
  }

  /** O(1) lookup by numeric block ID. Returns default (solid) if not registered. */
  lookup(id: number): ResolvedDefinition {
    return this.byId.get(id) ?? DEFAULT_DEF
  }
}

/**
 * Build a fully resolved registry for the given world.
 *
 * Loads all src/render-rules/*.json files (bundled by Vite at build time),
 * then resolves name-keyed entries to numeric IDs via blockNames.
 * Call once when a world is loaded and store the result in a ref.
 */
export function createResolvedRegistry(
  blockNames?: Record<number, string>
): BlockRenderRegistry {
  const reg = new BlockRenderRegistry()

  const modules = import.meta.glob('./render-rules/*.json', {
    eager: true,
  }) as Record<string, unknown>

  for (const mod of Object.values(modules)) {
    reg.loadJson(mod as RegistryJson)
  }

  if (blockNames) reg.resolveNames(blockNames)
  return reg
}
