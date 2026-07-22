import type { LayerOverrides } from './renderPresets'

/**
 * The user's current render view — the selected preset plus the session overrides
 * layered on top (per-category layer toggles). Persisted so reopening a
 * world restores the exact view (Stage 3.3), mirroring how the last world path is
 * persisted.
 *
 * Texture filtering is deliberately NOT here: it is preset-owned (see
 * RenderPreset.textureFilter) with no user override. Any `textureFilter` left in
 * older stored prefs is simply ignored.
 */
export interface RenderPrefs {
  presetId: string
  layerOverrides: LayerOverrides
}

const KEY = 'atlas:renderPrefs'

const DEFAULTS: RenderPrefs = {
  presetId: 'journeymap',
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
