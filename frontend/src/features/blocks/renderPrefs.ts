import type { LayerOverrides } from './renderPresets'

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
 * layered on top (elevation, per-category layer toggles). Persisted so reopening a
 * world restores the exact view (Stage 3.3), mirroring how the last world path is
 * persisted.
 *
 * Texture filtering is deliberately NOT here: it is preset-owned (see
 * RenderPreset.textureFilter) with no user override. Any `textureFilter` left in
 * older stored prefs is simply ignored.
 */
export interface RenderPrefs {
  presetId: string
  elevOverride: ElevOverride
  layerOverrides: LayerOverrides
}

const KEY = 'atlas:renderPrefs'

const DEFAULTS: RenderPrefs = {
  presetId: 'journeymap',
  elevOverride: 'preset',
  layerOverrides: {},
}

/** The persisted render view, or defaults when absent/corrupt. */
export function loadRenderPrefs(): RenderPrefs {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return DEFAULTS
    const parsed = JSON.parse(raw) as Partial<RenderPrefs>
    // Pick known fields only: older builds persisted extras (e.g. textureFilter,
    // now preset-owned) that must not leak back out as part of the view.
    return {
      presetId: parsed.presetId ?? DEFAULTS.presetId,
      elevOverride: parsed.elevOverride ?? DEFAULTS.elevOverride,
      layerOverrides: parsed.layerOverrides ?? DEFAULTS.layerOverrides,
    }
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
