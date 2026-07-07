import { describe, expect, it } from 'vitest'

import {
  BUILT_IN_PRESETS,
  applyLayerOverrides,
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
