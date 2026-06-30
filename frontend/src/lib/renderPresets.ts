import type { ResolvedDefinition } from './blockRenderRegistry'

export type FoliageMode   = 'hidden' | 'simplified' | 'full'
export type WaterMode     = 'simple' | 'textured'
export type ElevationMode = 'off' | 'subtle' | 'strong' | 'debug-heightmap'
export type ContourMode   = 'off' | 'subtle' | 'normal' | 'strong'
export type TextureFilter = 'pixel' | 'smooth' | 'journeymap'

/**
 * User-facing preset that configures the entire rendering pipeline.
 * Presets control visibility and presentation; the renderer pipeline itself
 * never changes — only these inputs change.
 */
export interface RenderPreset {
  id:          string
  name:        string
  description: string

  // Overlay category visibility
  showOverlays:  boolean
  showTorches:   boolean
  showFlowers:   boolean   // includes crops, mushrooms, saplings, deadbush
  showTallgrass: boolean   // includes tallgrass, ferns, vines, lily pads
  showRails:     boolean
  showRedstone:  boolean
  showMachines:  boolean
  showPipes:     boolean
  showCables:    boolean
  showFire?:     boolean   // transient fire blocks; hidden by default so terrain shows

  // Rendering style
  foliageMode:       FoliageMode
  waterMode:         WaterMode
  elevationMode:     ElevationMode
  elevationStrength: number       // multiplier on height differences; 1.0 = neutral
  contourMode:       ContourMode
  colorSaturation:   number       // 0 = greyscale, 1 = full color
  terrainTextures:     boolean
  biomeTint:           boolean
  showFallbackMagenta: boolean
  textureFilter:       TextureFilter
}

/**
 * Renderer-facing configuration computed from a preset plus session overrides.
 * Everything the render pipeline needs — no preset logic inside the renderer.
 */
export interface RenderConfig {
  // Overlay filtering
  showOverlays:    boolean
  showDebugBlocks: boolean          // show mapVisibility:'debug' blocks
  hiddenTags:      ReadonlySet<string>

  // Solid foliage behaviour
  foliageMode:     FoliageMode      // 'hidden' = skip leaf blocks

  // Water rendering
  waterMode:       WaterMode        // 'textured' = draw water texture over depth fill

  // Pipeline flags
  terrainTextures:     boolean      // false = no drawImage (flat colour only)
  elevationMode:       ElevationMode
  elevationStrength:   number
  contourMode:         ContourMode
  colorSaturation:     number
  biomeTint:           boolean
  useMarkers:          boolean      // blocks with mapRenderMode:'marker' render as tiny dots
  showFallbackMagenta: boolean
  textureFilter:       TextureFilter
}

// ── Built-in presets ──────────────────────────────────────────────────────────

export const BUILT_IN_PRESETS: readonly RenderPreset[] = [
  {
    id:          'journeymap',
    name:        'JourneyMap',
    description: 'Familiar minimap — terrain, structures, water. Hides visual noise.',
    showOverlays:  true,
    showTorches:   false,
    showFlowers:   false,
    showTallgrass: false,
    showRails:     false,
    showRedstone:  false,
    showMachines:  true,
    showPipes:     true,
    showCables:    true,
    foliageMode:       'full',
    waterMode:         'simple',
    elevationMode:     'subtle',
    elevationStrength: 0.8,
    contourMode:       'off',
    colorSaturation:   1.0,
    terrainTextures:     true,
    biomeTint:           true,
    showFallbackMagenta: false,
    textureFilter:       'journeymap',
  },
  {
    id:          'vanilla',
    name:        'Vanilla',
    description: 'World as close to Minecraft as possible — all overlays, full tint.',
    showOverlays:  true,
    showFire:      true,
    showTorches:   true,
    showFlowers:   true,
    showTallgrass: true,
    showRails:     true,
    showRedstone:  true,
    showMachines:  true,
    showPipes:     true,
    showCables:    true,
    foliageMode:       'full',
    waterMode:         'textured',
    elevationMode:     'subtle',
    elevationStrength: 1.0,
    contourMode:       'off',
    colorSaturation:   1.0,
    terrainTextures:     true,
    biomeTint:           true,
    showFallbackMagenta: false,
    textureFilter:       'smooth',
  },
  {
    id:          'builder',
    name:        'Builder',
    description: 'Base inspection — hides foliage to reveal structures underneath.',
    showOverlays:  true,
    showTorches:   false,
    showFlowers:   false,
    showTallgrass: false,
    showRails:     true,
    showRedstone:  true,
    showMachines:  true,
    showPipes:     true,
    showCables:    true,
    foliageMode:       'hidden',
    waterMode:         'simple',
    elevationMode:     'subtle',
    elevationStrength: 1.0,
    contourMode:       'off',
    colorSaturation:   1.0,
    terrainTextures:     true,
    biomeTint:           true,
    showFallbackMagenta: false,
    textureFilter:       'smooth',
  },
  {
    id:          'technical',
    name:        'Technical',
    description: 'GTNH infrastructure — GregTech, pipes, cables, AE2, rails. Hides decorative flora.',
    showOverlays:  true,
    showTorches:   false,
    showFlowers:   false,
    showTallgrass: false,
    showRails:     true,
    showRedstone:  true,
    showMachines:  true,
    showPipes:     true,
    showCables:    true,
    foliageMode:       'hidden',
    waterMode:         'simple',
    elevationMode:     'subtle',
    elevationStrength: 0.6,
    contourMode:       'off',
    colorSaturation:   1.0,
    terrainTextures:     true,
    biomeTint:           true,
    showFallbackMagenta: false,
    textureFilter:       'pixel',
  },
  {
    id:          'explorer',
    name:        'Explorer',
    description: 'Navigation — terrain, rivers, biomes, coastlines, mountains, roads.',
    showOverlays:  true,
    showTorches:   false,
    showFlowers:   false,
    showTallgrass: false,
    showRails:     true,
    showRedstone:  false,
    showMachines:  false,
    showPipes:     false,
    showCables:    false,
    foliageMode:       'full',
    waterMode:         'simple',
    elevationMode:     'strong',
    elevationStrength: 1.5,
    contourMode:       'subtle',
    colorSaturation:   1.0,
    terrainTextures:     true,
    biomeTint:           true,
    showFallbackMagenta: false,
    textureFilter:       'journeymap',
  },
  {
    id:          'relief',
    name:        'Relief',
    description: 'Terrain-focused — strong hillshade, contour lines, simplified vegetation.',
    showOverlays:  true,
    showTorches:   false,
    showFlowers:   false,
    showTallgrass: false,
    showRails:     true,
    showRedstone:  false,
    showMachines:  true,
    showPipes:     true,
    showCables:    true,
    foliageMode:       'simplified',
    waterMode:         'simple',
    elevationMode:     'strong',
    elevationStrength: 1.5,
    contourMode:       'normal',
    colorSaturation:   1.0,
    terrainTextures:     true,
    biomeTint:           true,
    showFallbackMagenta: false,
    textureFilter:       'smooth',
  },
  {
    id:          'topo',
    name:        'Topo',
    description: 'Topographic — maximum relief shading, dense contours, muted colors.',
    showOverlays:  true,
    showTorches:   false,
    showFlowers:   false,
    showTallgrass: false,
    showRails:     true,
    showRedstone:  false,
    showMachines:  true,
    showPipes:     false,
    showCables:    false,
    foliageMode:       'hidden',
    waterMode:         'simple',
    elevationMode:     'strong',
    elevationStrength: 2.5,
    contourMode:       'strong',
    colorSaturation:   0.25,
    terrainTextures:     true,
    biomeTint:           true,
    showFallbackMagenta: false,
    textureFilter:       'smooth',
  },
  {
    id:          'debug',
    name:        'Debug',
    description: 'Everything visible — overlays, fallback highlighting, texture diagnostics.',
    showOverlays:  true,
    showFire:      true,
    showTorches:   true,
    showFlowers:   true,
    showTallgrass: true,
    showRails:     true,
    showRedstone:  true,
    showMachines:  true,
    showPipes:     true,
    showCables:    true,
    foliageMode:       'full',
    waterMode:         'textured',
    elevationMode:     'debug-heightmap',
    elevationStrength: 2.0,
    contourMode:       'normal',
    colorSaturation:   1.0,
    terrainTextures:     true,
    biomeTint:           true,
    showFallbackMagenta: true,
    textureFilter:       'pixel',
  },
]

// ── Conversion ────────────────────────────────────────────────────────────────

function buildHiddenTags(p: RenderPreset): ReadonlySet<string> {
  const t = new Set<string>()
  if (!p.showTorches)   t.add('torch')
  if (!p.showFlowers)   t.add('flower')
  if (!p.showTallgrass) t.add('tallgrass')
  if (!p.showRails)     t.add('rail')
  if (!p.showRedstone)  t.add('redstone')
  if (!p.showMachines)  t.add('machine')
  if (!p.showPipes)     t.add('pipe')
  if (!p.showCables)    t.add('cable')
  if (!p.showFire)      t.add('fire')  // default: hide fire (showFire is opt-in)
  return t
}

/**
 * Convert a preset to the flat RenderConfig the renderer consumes.
 * Pass `overrides` for per-session toggles (RAW button, FB button).
 */
export function presetToConfig(
  preset: RenderPreset,
  overrides: Partial<Pick<RenderConfig, 'biomeTint' | 'showFallbackMagenta' | 'textureFilter'>> = {},
): RenderConfig {
  return {
    hiddenTags:          buildHiddenTags(preset),
    showOverlays:        preset.showOverlays,
    showDebugBlocks:     preset.id === 'debug',
    foliageMode:         preset.foliageMode,
    waterMode:           preset.waterMode,
    terrainTextures:     preset.terrainTextures,
    elevationMode:       preset.elevationMode,
    elevationStrength:   preset.elevationStrength,
    contourMode:         preset.contourMode,
    colorSaturation:     preset.colorSaturation,
    biomeTint:           overrides.biomeTint        ?? preset.biomeTint,
    useMarkers:          false,
    showFallbackMagenta: overrides.showFallbackMagenta ?? preset.showFallbackMagenta,
    textureFilter:       overrides.textureFilter ?? preset.textureFilter,
  }
}

// ── Renderer helpers ──────────────────────────────────────────────────────────

/** True when an overlay block should be rendered given the current config. */
export function shouldShowOverlay(def: ResolvedDefinition, cfg: RenderConfig): boolean {
  if (!cfg.showOverlays) return false

  // Debug-only blocks (levers, signs, pressure plates) require showDebugBlocks
  if ((def.mapVisibility ?? 'clean') === 'debug' && !cfg.showDebugBlocks) return false

  // Tag-based filtering (primary preset control)
  const tags = def.blockTags
  if (tags) {
    for (const tag of tags) {
      if (cfg.hiddenTags.has(tag)) return false
    }
  }

  return true
}
