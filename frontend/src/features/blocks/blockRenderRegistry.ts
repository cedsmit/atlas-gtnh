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

  // ── Per-meta texture tinting ───────────────────────────────────────────
  // For blocks whose textures aren't scannable, so a per-meta colour is applied
  // at render time (e.g. Ztones glaxx: a texture-sheet block Atlas can't scan,
  // coloured from textureTintColors below).
  textureTint?: 'none' | 'metadata16' | 'custom' // how to derive the block's color tint
  textureTintColors?: readonly string[] // hex colors indexed by metadata (for 'custom')
  preserveAlpha?: boolean // keep texture alpha through tint compositing
}

export interface ResolvedDefinition extends BlockRenderDefinition {
  resolverSource: string // 'builtin' | 'vanilla.json' | 'thaumcraft.json' | …
}

/**
 * True when a block is plant/vegetation — grass/foliage-tinted flora, or
 * anything tagged as a flower/tallgrass (covers modded plants resolved from the
 * render rules, e.g. Pam's crops tagged `flower`). Deliberately excludes the
 * non-plant overlays that merely share the `overlay` category (rails, torches,
 * redstone, signs, pressure plates). Used to drop plants from the zoomed-out
 * overview so it shows the ground beneath them, and as the classification a
 * future "highlight plants" toggle will reuse.
 */
export function isPlantBlock(def: ResolvedDefinition): boolean {
  const tags = def.blockTags
  if (tags && (tags.includes('flower') || tags.includes('tallgrass')))
    return true
  return (
    def.category === 'overlay' &&
    (def.tint === 'grass' || def.tint === 'foliage')
  )
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
export interface RegistryJson {
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
  // Wildcard entries — JSON keys containing a single '*', e.g.
  // "harvestcraft:pam*Crop" matches all 60 Pam's crop blocks. Exact names win.
  private readonly byPattern: {
    prefix: string
    suffix: string
    def: BlockRenderDefinition
    source: string
  }[] = []

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
      const star = name.indexOf('*')
      if (star >= 0) {
        this.byPattern.push({
          prefix: name.slice(0, star),
          suffix: name.slice(star + 1),
          def: partial as BlockRenderDefinition,
          source,
        })
      } else {
        this.byName.set(name, { def: partial as BlockRenderDefinition, source })
      }
    }
  }

  /**
   * Resolve name-keyed entries into numeric IDs using the world's FML block
   * name registry.  JSON entries override built-in numeric entries; exact
   * names win over wildcard patterns.
   * Call once per world load after all loadJson() calls.
   */
  resolveNames(blockNames: Record<number, string>): void {
    for (const [rawId, name] of Object.entries(blockNames)) {
      let entry = this.byName.get(name)
      if (!entry) {
        const p = this.byPattern.find(
          (p) =>
            name.length >= p.prefix.length + p.suffix.length &&
            name.startsWith(p.prefix) &&
            name.endsWith(p.suffix)
        )
        if (p) entry = { def: p.def, source: p.source }
      }
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

  /**
   * Numeric ids of every resolved plant/vegetation block (see isPlantBlock).
   * Covers vanilla built-ins plus any modded plants matched by the render rules.
   * Sent to the region-surface fetch so the overview drops plants and shows the
   * ground beneath them.
   */
  plantIds(): number[] {
    const out: number[] = []
    for (const [id, def] of this.byId) {
      if (isPlantBlock(def)) out.push(id)
    }
    return out
  }

  /**
   * Numeric ids of blocks the map omits entirely (category 'ignore') — invisible
   * air-like blocks such as Thaumcraft:blockAiry or Galacticraft breathable air.
   * The detailed renderer skips these and shows the terrain beneath; the overview
   * must skip them too, else it paints their (textureless) fallback colour as a
   * stray dot. Always dropped from the overview, regardless of any plant toggle.
   */
  ignoredIds(): number[] {
    const out: number[] = []
    for (const [id, def] of this.byId) {
      if (id !== 0 && def.category === 'ignore') out.push(id)
    }
    return out
  }

  /**
   * Numeric ids of overlay blocks the current preset hides — their blockTags are
   * in *hiddenTags* (e.g. torch/rail/redstone in JourneyMap). The detailed
   * renderer omits these overlays, so the overview skips them too and shows the
   * terrain beneath instead of a stray dot. Untagged overlays that visually cover
   * the block (snow, carpet) have no matching tag and are kept.
   */
  hiddenOverlayIds(hiddenTags: ReadonlySet<string>): number[] {
    const out: number[] = []
    for (const [id, def] of this.byId) {
      if (def.category !== 'overlay') continue
      const tags = def.blockTags
      if (tags && tags.some((t) => hiddenTags.has(t))) out.push(id)
    }
    return out
  }
}

/**
 * Build a fully resolved registry for the given world.
 *
 * Loads all src/render-rules/*.json files (bundled by Vite at build time) — which
 * includes the maintainer-authored `authored.json` — then re-applies the live-fetched
 * authored overrides (Stage 2.3) last so an in-dev "Save" wins immediately, then
 * resolves name-keyed entries to numeric IDs via blockNames.
 * Call once when a world is loaded and store the result in a ref.
 */
export function createResolvedRegistry(
  blockNames?: Record<number, string>,
  userOverrides?: RegistryJson | null
): BlockRenderRegistry {
  const reg = new BlockRenderRegistry()

  const modules = import.meta.glob('./render-rules/*.json', {
    eager: true,
  }) as Record<string, unknown>

  for (const mod of Object.values(modules)) {
    reg.loadJson(mod as RegistryJson)
  }

  // Authored overrides load LAST so they take precedence (byName.set overwrites;
  // exact names beat wildcard patterns). In dev this is the live-fetched
  // authored.json for an instant post-Save preview; the same file is also bundled
  // via the glob above, so shipped builds get it without the fetch — loading it
  // twice is idempotent.
  if (userOverrides?.blocks) reg.loadJson(userOverrides)

  if (blockNames) reg.resolveNames(blockNames)
  return reg
}
