import type { LayerOverrides, TextureFilter } from './renderPresets'

// The elevation-override options offered in the menu bar (superset of a preset's
// own elevationMode; 'preset' = defer to the preset).
export type ElevOverride =
  | 'preset'
  | 'off'
  | 'subtle'
  | 'strong'
  | 'relief'
  | 'heightmap'
  | 'contours'

/**
 * The user's current render view — the selected preset plus the session overrides
 * layered on top (elevation, texture filter, per-category layer toggles). Persisted
 * so reopening a world restores the exact view (Stage 3.3), mirroring how the last
 * world path is persisted.
 */
export interface RenderPrefs {
  presetId: string
  elevOverride: ElevOverride
  textureFilter: 'preset' | TextureFilter
  layerOverrides: LayerOverrides
}

const KEY = 'atlas:renderPrefs'

const DEFAULTS: RenderPrefs = {
  presetId: 'journeymap',
  elevOverride: 'preset',
  textureFilter: 'preset',
  layerOverrides: {},
}

/** The persisted render view, or defaults when absent/corrupt. */
export function loadRenderPrefs(): RenderPrefs {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return DEFAULTS
    const parsed = JSON.parse(raw) as Partial<RenderPrefs>
    return { ...DEFAULTS, ...parsed }
  } catch {
    return DEFAULTS
  }
}

export function saveRenderPrefs(prefs: RenderPrefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs))
  } catch {
    // ignore quota / unavailable storage
  }
}
