import type { ResolvedDefinition } from './blockRenderRegistry'

export type FoliageMode = 'hidden' | 'simplified' | 'full'
export type WaterMode = 'simple' | 'textured'
export type ElevationMode = 'off' | 'subtle' | 'strong' | 'debug-heightmap'
export type ContourMode = 'off' | 'subtle' | 'normal' | 'strong'
export type TextureFilter = 'pixel' | 'smooth' | 'journeymap'

/**
 * User-facing preset that configures the entire rendering pipeline.
 * Presets control visibility and presentation; the renderer pipeline itself
 * never changes — only these inputs change.
 */
export interface RenderPreset {
  id: string
  name: string
  description: string

  // Overlay category visibility
  showOverlays: boolean
  showTorches: boolean
  showFlowers: boolean // includes crops, mushrooms, saplings, deadbush
  showTallgrass: boolean // includes tallgrass, ferns, vines, lily pads
  showRails: boolean
  showRedstone: boolean
  showMachines: boolean
  showPipes: boolean
  showCables: boolean
  showFire?: boolean // transient fire blocks; hidden by default so terrain shows

  // Rendering style
  foliageMode: FoliageMode
  waterMode: WaterMode
  elevationMode: ElevationMode
  elevationStrength: number // multiplier on height differences; 1.0 = neutral
  contourMode: ContourMode
  colorSaturation: number // 0 = greyscale, 1 = full color
  terrainTextures: boolean
  biomeTint: boolean
  textureFilter: TextureFilter
}

/**
 * Renderer-facing configuration computed from a preset plus session overrides.
 * Everything the render pipeline needs — no preset logic inside the renderer.
 */
export interface RenderConfig {
  // Overlay filtering
  showOverlays: boolean
  showDebugBlocks: boolean // show mapVisibility:'debug' blocks
  hiddenTags: ReadonlySet<string>

  // Solid foliage behaviour
  foliageMode: FoliageMode // 'hidden' = skip leaf blocks

  // Water rendering
  waterMode: WaterMode // 'textured' = draw water texture over depth fill

  // Pipeline flags
  terrainTextures: boolean // false = no drawImage (flat colour only)
  elevationMode: ElevationMode
  elevationStrength: number
  contourMode: ContourMode
  colorSaturation: number
  biomeTint: boolean
  useMarkers: boolean // blocks with mapRenderMode:'marker' render as tiny dots
  // When true the zoomed-out overview keeps plants (a future toggle will render
  // them as a highlight); when false plants are dropped so the ground shows.
  highlightPlants: boolean
  // Infrastructure View: draw pipe/cable runs as a connected network (centre
  // nodes + arms) over the revealed terrain, instead of isolated blocks. Detailed
  // (chunk-tile) view only; the overview is unaffected. (Stage 5.)
  infraView: boolean
  // Infrastructure-View systems (friendly mod names, see pipeSystems.ts) toggled
  // OFF; empty = show every pipe/cable system. Only consulted when infraView.
  hiddenPipeSystems: ReadonlySet<string>
  // Include power/data cables in the network. Off by default — cabling is the
  // noisiest infrastructure, so the view shows item/fluid pipes first.
  showCables: boolean
  showFallbackMagenta: boolean
  textureFilter: TextureFilter
}

// ── Data-driven built-in presets (Stage 3.4) ─────────────────────────────────

interface OrderedPreset {
  order: number
  preset: RenderPreset
}

const PRESET_KEYS = new Set([
  'id',
  'name',
  'description',
  'showOverlays',
  'showTorches',
  'showFlowers',
  'showTallgrass',
  'showRails',
  'showRedstone',
  'showMachines',
  'showPipes',
  'showCables',
  'showFire',
  'foliageMode',
  'waterMode',
  'elevationMode',
  'elevationStrength',
  'contourMode',
  'colorSaturation',
  'terrainTextures',
  'biomeTint',
  'textureFilter',
])

function asRecord(value: unknown, location: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${location} must be an object`)
  }
  return value as Record<string, unknown>
}

function assertOnlyKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  location: string
): void {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key))
  if (unknown.length > 0) {
    throw new Error(`${location} has unknown field(s): ${unknown.join(', ')}`)
  }
}

function readString(
  value: Record<string, unknown>,
  key: string,
  location: string
): string {
  const result = value[key]
  if (typeof result !== 'string' || result.trim() === '') {
    throw new Error(`${location}.${key} must be a non-empty string`)
  }
  return result
}

function readBoolean(
  value: Record<string, unknown>,
  key: string,
  location: string
): boolean {
  const result = value[key]
  if (typeof result !== 'boolean') {
    throw new Error(`${location}.${key} must be a boolean`)
  }
  return result
}

function readOptionalBoolean(
  value: Record<string, unknown>,
  key: string,
  location: string
): boolean | undefined {
  if (!(key in value)) return undefined
  return readBoolean(value, key, location)
}

function readNumber(
  value: Record<string, unknown>,
  key: string,
  location: string
): number {
  const result = value[key]
  if (typeof result !== 'number' || !Number.isFinite(result)) {
    throw new Error(`${location}.${key} must be a finite number`)
  }
  return result
}

function readEnum<T extends string>(
  value: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
  location: string
): T {
  const result = value[key]
  if (typeof result !== 'string' || !allowed.includes(result as T)) {
    throw new Error(`${location}.${key} must be one of: ${allowed.join(', ')}`)
  }
  return result as T
}

function parsePresetModule(path: string, value: unknown): OrderedPreset {
  const root = asRecord(value, path)
  assertOnlyKeys(root, new Set(['schemaVersion', 'order', 'preset']), path)
  if (root.schemaVersion !== 1) {
    throw new Error(`${path}.schemaVersion must be 1`)
  }
  const order = root.order
  if (typeof order !== 'number' || !Number.isInteger(order)) {
    throw new Error(`${path}.order must be an integer`)
  }

  const location = `${path}.preset`
  const raw = asRecord(root.preset, location)
  assertOnlyKeys(raw, PRESET_KEYS, location)
  const id = readString(raw, 'id', location)
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) {
    throw new Error(
      `${location}.id must use lowercase letters, numbers or dashes`
    )
  }
  const elevationStrength = readNumber(raw, 'elevationStrength', location)
  if (elevationStrength < 0) {
    throw new Error(`${location}.elevationStrength must be at least 0`)
  }
  const colorSaturation = readNumber(raw, 'colorSaturation', location)
  if (colorSaturation < 0 || colorSaturation > 1) {
    throw new Error(`${location}.colorSaturation must be between 0 and 1`)
  }
  const showFire = readOptionalBoolean(raw, 'showFire', location)

  return {
    order,
    preset: {
      id,
      name: readString(raw, 'name', location),
      description: readString(raw, 'description', location),
      showOverlays: readBoolean(raw, 'showOverlays', location),
      showTorches: readBoolean(raw, 'showTorches', location),
      showFlowers: readBoolean(raw, 'showFlowers', location),
      showTallgrass: readBoolean(raw, 'showTallgrass', location),
      showRails: readBoolean(raw, 'showRails', location),
      showRedstone: readBoolean(raw, 'showRedstone', location),
      showMachines: readBoolean(raw, 'showMachines', location),
      showPipes: readBoolean(raw, 'showPipes', location),
      showCables: readBoolean(raw, 'showCables', location),
      ...(showFire === undefined ? {} : { showFire }),
      foliageMode: readEnum(
        raw,
        'foliageMode',
        ['hidden', 'simplified', 'full'],
        location
      ),
      waterMode: readEnum(raw, 'waterMode', ['simple', 'textured'], location),
      elevationMode: readEnum(
        raw,
        'elevationMode',
        ['off', 'subtle', 'strong', 'debug-heightmap'],
        location
      ),
      elevationStrength,
      contourMode: readEnum(
        raw,
        'contourMode',
        ['off', 'subtle', 'normal', 'strong'],
        location
      ),
      colorSaturation,
      terrainTextures: readBoolean(raw, 'terrainTextures', location),
      biomeTint: readBoolean(raw, 'biomeTint', location),
      textureFilter: readEnum(
        raw,
        'textureFilter',
        ['pixel', 'smooth', 'journeymap'],
        location
      ),
    },
  }
}

/** Validate and combine every bundled `render-presets/*.json` module. */
export function loadRenderPresets(
  modules: Readonly<Record<string, unknown>>
): readonly RenderPreset[] {
  const ordered = Object.entries(modules).map(([path, value]) =>
    parsePresetModule(path, value)
  )
  ordered.sort(
    (a, b) => a.order - b.order || a.preset.id.localeCompare(b.preset.id)
  )
  if (ordered.length === 0) throw new Error('No render presets were bundled')

  const ids = new Set<string>()
  for (const { preset } of ordered) {
    if (ids.has(preset.id))
      throw new Error(`Duplicate render preset id: ${preset.id}`)
    ids.add(preset.id)
  }
  if (ordered[0].preset.id !== 'journeymap') {
    throw new Error(
      'JourneyMap must remain the first render preset (the fallback view)'
    )
  }
  return ordered.map(({ preset }) => preset)
}

const presetModules = import.meta.glob('./render-presets/*.json', {
  eager: true,
  import: 'default',
}) as Record<string, unknown>

export const BUILT_IN_PRESETS = loadRenderPresets(presetModules)

// ── Conversion ────────────────────────────────────────────────────────────────

function buildHiddenTags(p: RenderPreset): ReadonlySet<string> {
  const t = new Set<string>()
  if (!p.showTorches) t.add('torch')
  if (!p.showFlowers) t.add('flower')
  if (!p.showTallgrass) t.add('tallgrass')
  if (!p.showRails) t.add('rail')
  if (!p.showRedstone) t.add('redstone')
  if (!p.showMachines) t.add('machine')
  if (!p.showPipes) t.add('pipe')
  if (!p.showCables) t.add('cable')
  if (!p.showFire) t.add('fire') // default: hide fire (showFire is opt-in)
  return t
}

// ── User layer overrides (Stage 3.1) ────────────────────────────────────────
// The overlay categories a user can independently show/hide on top of the active
// preset — the same tag strings buildHiddenTags emits. A LayerOverrides entry is
// the user's desired *visibility* (true = force-show, false = force-hide); a tag
// absent from the record defers to the preset, so toggles layer on top of it and
// switching presets stays meaningful.
export type LayerTag =
  | 'torch'
  | 'flower'
  | 'tallgrass'
  | 'machine'
  | 'pipe'
  | 'cable'
  | 'fire'
  | 'unknown'
  | 'chunk-borders'

export type LayerOverrides = Partial<Record<LayerTag, boolean>>

// Display order + labels for the Layers menu.
export const LAYER_TAGS: readonly { tag: LayerTag; label: string }[] = [
  { tag: 'machine', label: 'Machines' },
  { tag: 'pipe', label: 'Pipes' },
  { tag: 'cable', label: 'Cables' },
  { tag: 'flower', label: 'Flowers / crops' },
  { tag: 'tallgrass', label: 'Tall grass / ferns' },
  { tag: 'torch', label: 'Torches / lights' },
  { tag: 'fire', label: 'Fire' },
  { tag: 'unknown', label: 'Unknown blocks' },
  { tag: 'chunk-borders', label: 'Chunk borders' },
]

/** Apply user show/hide overrides on top of the preset's hidden-tag set. */
export function applyLayerOverrides(
  base: ReadonlySet<string>,
  overrides?: LayerOverrides
): ReadonlySet<string> {
  if (!overrides || Object.keys(overrides).length === 0) return base
  const out = new Set(base)
  for (const [tag, show] of Object.entries(overrides)) {
    if (show)
      out.delete(tag) // force-show: drop from hidden
    else out.add(tag) // force-hide: add to hidden
  }
  return out
}

/** Whether a preset shows the given overlay category (before user overrides). */
export function presetShowsTag(preset: RenderPreset, tag: LayerTag): boolean {
  return !buildHiddenTags(preset).has(tag)
}

/**
 * Convert a preset to the flat RenderConfig the renderer consumes.
 * `biomeTint` is preset-driven; pass `overrides` for the per-session toggles.
 * The two texture diagnostics (`showDebugBlocks`, `showFallbackMagenta`) are
 * override-only — they used to ride on the `debug` preset and are now driven by
 * the Debug menu's "Diagnostic rendering" toggle, independent of the preset.
 */
export function presetToConfig(
  preset: RenderPreset,
  overrides: Partial<
    Pick<
      RenderConfig,
      | 'textureFilter'
      | 'highlightPlants'
      | 'showDebugBlocks'
      | 'showFallbackMagenta'
    >
  > = {}
): RenderConfig {
  return {
    hiddenTags: buildHiddenTags(preset),
    showOverlays: preset.showOverlays,
    showDebugBlocks: overrides.showDebugBlocks ?? false,
    foliageMode: preset.foliageMode,
    waterMode: preset.waterMode,
    terrainTextures: preset.terrainTextures,
    elevationMode: preset.elevationMode,
    elevationStrength: preset.elevationStrength,
    contourMode: preset.contourMode,
    colorSaturation: preset.colorSaturation,
    biomeTint: preset.biomeTint,
    // Marker dots for textureless multiparts (AE2 cable bus) and marked
    // blocks — enabled wherever the preset shows cable infrastructure.
    useMarkers: preset.showCables,
    // Default off: plants are dropped from the overview so the ground shows.
    highlightPlants: overrides.highlightPlants ?? false,
    // Off by default; toggled per-session from the menu bar (see App).
    infraView: false,
    hiddenPipeSystems: new Set(),
    showCables: false,
    showFallbackMagenta: overrides.showFallbackMagenta ?? false,
    textureFilter: overrides.textureFilter ?? preset.textureFilter,
  }
}

// ── Renderer helpers ──────────────────────────────────────────────────────────

/**
 * True when any of the block's tags is in the config's hidden set. Drives the
 * layer toggles for *solid* infrastructure (pipes/cables/machines): a hidden
 * tagged solid is skipped by the renderer so the terrain beneath shows through.
 * (Overlays use the same tag check via shouldShowOverlay.)
 */
export function isTagHidden(
  def: Pick<ResolvedDefinition, 'blockTags'>,
  cfg: Pick<RenderConfig, 'hiddenTags'>
): boolean {
  const tags = def.blockTags
  if (!tags) return false
  for (const tag of tags) {
    if (cfg.hiddenTags.has(tag)) return true
  }
  return false
}

/** True when an overlay block should be rendered given the current config. */
export function shouldShowOverlay(
  def: ResolvedDefinition,
  cfg: RenderConfig
): boolean {
  if (!cfg.showOverlays) return false

  // Debug-only blocks (levers, signs, pressure plates) require showDebugBlocks
  if ((def.mapVisibility ?? 'clean') === 'debug' && !cfg.showDebugBlocks)
    return false

  // Tag-based filtering (primary preset control)
  return !isTagHidden(def, cfg)
}
