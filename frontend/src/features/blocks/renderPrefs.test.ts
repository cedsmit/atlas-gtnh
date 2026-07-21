import { beforeEach, describe, expect, it } from 'vitest'

import { loadRenderPrefs, saveRenderPrefs } from './renderPrefs'

// node test env has no localStorage — back it with an in-memory Map.
beforeEach(() => {
  const store = new Map<string, string>()
  globalThis.localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  } as Storage
})

describe('render prefs persistence (Stage 3.3)', () => {
  it('returns defaults when nothing is stored', () => {
    const p = loadRenderPrefs()
    expect(p.presetId).toBe('journeymap')
    expect(p.elevOverride).toBe('preset')
    expect(p.layerOverrides).toEqual({})
  })

  it('round-trips a saved view', () => {
    saveRenderPrefs({
      presetId: 'vanilla',
      elevOverride: 'relief',
      layerOverrides: { machine: false, pipe: true },
    })
    const p = loadRenderPrefs()
    expect(p.presetId).toBe('vanilla')
    expect(p.elevOverride).toBe('relief')
    expect(p.layerOverrides).toEqual({ machine: false, pipe: true })
  })

  it('fills defaults for partial data and falls back on corrupt JSON', () => {
    localStorage.setItem('atlas:renderPrefs', '{"presetId":"topo"}')
    const partial = loadRenderPrefs()
    expect(partial.presetId).toBe('topo')
    expect(partial.elevOverride).toBe('preset') // default filled in

    localStorage.setItem('atlas:renderPrefs', 'not json')
    expect(loadRenderPrefs().presetId).toBe('journeymap') // corrupt → defaults
  })

  it('ignores a textureFilter left behind by older builds', () => {
    // The filter is preset-owned now; a stale stored key must not resurface.
    localStorage.setItem(
      'atlas:renderPrefs',
      '{"presetId":"journeymap","textureFilter":"journeymap"}'
    )
    expect('textureFilter' in loadRenderPrefs()).toBe(false)
  })
})
