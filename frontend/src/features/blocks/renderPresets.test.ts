import { describe, expect, it } from 'vitest'

import {
  BUILT_IN_PRESETS,
  applyLayerOverrides,
  isTagHidden,
  presetShowsTag,
  presetToConfig,
} from './renderPresets'

const journeymap =
  BUILT_IN_PRESETS.find((p) => p.id === 'journeymap') ?? BUILT_IN_PRESETS[0]

describe('layer overrides (Stage 3.1)', () => {
  it('empty / undefined overrides return the base set unchanged', () => {
    const base = new Set(['torch', 'rail'])
    expect(applyLayerOverrides(base, {})).toBe(base)
    expect(applyLayerOverrides(base, undefined)).toBe(base)
  })

  it('force-show removes the tag from hidden; force-hide adds it', () => {
    const base = new Set(['torch', 'rail'])
    const shown = applyLayerOverrides(base, { torch: true })
    expect(shown.has('torch')).toBe(false)
    expect(shown.has('rail')).toBe(true) // untouched
    const hidden = applyLayerOverrides(base, { machine: false })
    expect(hidden.has('machine')).toBe(true)
  })

  it('force-showing a preset-hidden category unhides it (detail path)', () => {
    const cfg = presetToConfig(journeymap)
    expect(cfg.hiddenTags.has('torch')).toBe(true) // JM hides torches
    const merged = applyLayerOverrides(cfg.hiddenTags, { torch: true })
    expect(merged.has('torch')).toBe(false)
    expect(merged.has('rail')).toBe(true) // other JM-hidden tags untouched
  })

  it('force-hiding a preset-shown category hides it', () => {
    const cfg = presetToConfig(journeymap)
    expect(cfg.hiddenTags.has('machine')).toBe(false) // JM shows machines
    const merged = applyLayerOverrides(cfg.hiddenTags, { machine: false })
    expect(merged.has('machine')).toBe(true)
  })

  it('presetShowsTag agrees with the preset hidden set (checkbox default is correct)', () => {
    const hidden = presetToConfig(journeymap).hiddenTags
    for (const tag of ['torch', 'machine', 'pipe', 'fire'] as const) {
      expect(presetShowsTag(journeymap, tag)).toBe(!hidden.has(tag))
    }
  })

  it('the same override layers on top of every preset', () => {
    for (const preset of BUILT_IN_PRESETS) {
      const merged = applyLayerOverrides(presetToConfig(preset).hiddenTags, {
        machine: false,
      })
      expect(merged.has('machine')).toBe(true)
    }
  })
})

describe('built-in preset list', () => {
  it('offers journeymap, vanilla and topo only', () => {
    expect(BUILT_IN_PRESETS.map((p) => p.id)).toEqual([
      'journeymap',
      'vanilla',
      'topo',
    ])
  })

  it('leads with journeymap — callers fall back to [0] for an unknown id', () => {
    // A view saved under a since-removed preset (e.g. 'technical') resolves to
    // this entry, so the default has to stay first.
    expect(BUILT_IN_PRESETS[0].id).toBe('journeymap')
    const stale = BUILT_IN_PRESETS.find((p) => p.id === 'technical')
    expect(stale ?? BUILT_IN_PRESETS[0]).toBe(BUILT_IN_PRESETS[0])
  })
})

describe('texture diagnostics (formerly the debug preset)', () => {
  it('are off for every preset by default', () => {
    for (const preset of BUILT_IN_PRESETS) {
      const cfg = presetToConfig(preset)
      expect(cfg.showDebugBlocks).toBe(false)
      expect(cfg.showFallbackMagenta).toBe(false)
    }
  })

  it('compose with any preset when overridden', () => {
    for (const preset of BUILT_IN_PRESETS) {
      const cfg = presetToConfig(preset, {
        showDebugBlocks: true,
        showFallbackMagenta: true,
      })
      expect(cfg.showDebugBlocks).toBe(true)
      expect(cfg.showFallbackMagenta).toBe(true)
      // the rest of the preset is untouched by the diagnostics
      expect(cfg.hiddenTags).toEqual(presetToConfig(preset).hiddenTags)
    }
  })
})

describe('isTagHidden (solid layer hiding)', () => {
  const hidden = { hiddenTags: new Set(['pipe', 'cable']) }

  it('is false for an untagged block', () => {
    expect(isTagHidden({ blockTags: undefined }, hidden)).toBe(false)
    expect(isTagHidden({ blockTags: ['machine'] }, hidden)).toBe(false)
  })

  it('is true when any tag is in the hidden set', () => {
    expect(isTagHidden({ blockTags: ['pipe'] }, hidden)).toBe(true)
    expect(isTagHidden({ blockTags: ['solid', 'cable'] }, hidden)).toBe(true)
  })

  it('a hidden pipe shows again once the tag is force-shown', () => {
    const shown = applyLayerOverrides(hidden.hiddenTags, { pipe: true })
    expect(isTagHidden({ blockTags: ['pipe'] }, { hiddenTags: shown })).toBe(
      false
    )
  })
})
