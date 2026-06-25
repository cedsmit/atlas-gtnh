import type { ResolvedDefinition } from './blockRenderRegistry'

export type FoliageMode = 'hidden' | 'simplified' | 'full'
export type WaterMode   = 'simple' | 'textured'

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

  // Rendering style
  foliageMode:   FoliageMode
  waterMode:     WaterMode
  terrainTextures:     boolean
  slopeShading:        boolean
  biomeTint:           boolean
  showFallbackMagenta: boolean
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
  slopeShading:        boolean
  biomeTint:           boolean
  useMarkers:          boolean      // blocks with mapRenderMode:'marker' render as tiny dots
  showFallbackMagenta: boolean
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
    foliageMode:   'full',
    waterMode:     'simple',
    terrainTextures:     true,
    slopeShading:        true,
    biomeTint:           true,
    showFallbackMagenta: false,
  },
  {
    id:          'vanilla',
    name:        'Vanilla',
    description: 'World as close to Minecraft as possible — all overlays, full tint.',
    showOverlays:  true,
    showTorches:   true,
    showFlowers:   true,
    showTallgrass: true,
    showRails:     true,
    showRedstone:  true,
    showMachines:  true,
    showPipes:     true,
    showCables:    true,
    foliageMode:   'full',
    waterMode:     'textured',
    terrainTextures:     true,
    slopeShading:        true,
    biomeTint:           true,
    showFallbackMagenta: false,
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
    foliageMode:   'hidden',
    waterMode:     'simple',
    terrainTextures:     true,
    slopeShading:        true,
    biomeTint:           true,
    showFallbackMagenta: false,
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
    foliageMode:   'hidden',
    waterMode:     'simple',
    terrainTextures:     true,
    slopeShading:        true,
    biomeTint:           true,
    showFallbackMagenta: false,
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
    foliageMode:   'full',
    waterMode:     'simple',
    terrainTextures:     true,
    slopeShading:        true,
    biomeTint:           true,
    showFallbackMagenta: false,
  },
  {
    id:          'debug',
    name:        'Debug',
    description: 'Everything visible — overlays, fallback highlighting, texture diagnostics.',
    showOverlays:  true,
    showTorches:   true,
    showFlowers:   true,
    showTallgrass: true,
    showRails:     true,
    showRedstone:  true,
    showMachines:  true,
    showPipes:     true,
    showCables:    true,
    foliageMode:   'full',
    waterMode:     'textured',
    terrainTextures:     true,
    slopeShading:        true,
    biomeTint:           true,
    showFallbackMagenta: true,
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
  return t
}

/**
 * Convert a preset to the flat RenderConfig the renderer consumes.
 * Pass `overrides` for per-session toggles (RAW button, FB button).
 */
export function presetToConfig(
  preset: RenderPreset,
  overrides: Partial<Pick<RenderConfig, 'biomeTint' | 'showFallbackMagenta'>> = {},
): RenderConfig {
  return {
    hiddenTags:          buildHiddenTags(preset),
    showOverlays:        preset.showOverlays,
    showDebugBlocks:     preset.id === 'debug',
    foliageMode:         preset.foliageMode,
    waterMode:           preset.waterMode,
    terrainTextures:     preset.terrainTextures,
    slopeShading:        preset.slopeShading,
    biomeTint:           overrides.biomeTint        ?? preset.biomeTint,
    useMarkers:          false,   // no current preset uses markers; reserved for future
    showFallbackMagenta: overrides.showFallbackMagenta ?? preset.showFallbackMagenta,
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
