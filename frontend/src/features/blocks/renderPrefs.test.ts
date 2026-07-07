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
    expect(p.textureFilter).toBe('preset')
    expect(p.layerOverrides).toEqual({})
  })

  it('round-trips a saved view', () => {
    saveRenderPrefs({
      presetId: 'technical',
      elevOverride: 'relief',
      textureFilter: 'pixel',
      layerOverrides: { machine: false, pipe: true },
    })
    const p = loadRenderPrefs()
    expect(p.presetId).toBe('technical')
    expect(p.elevOverride).toBe('relief')
    expect(p.textureFilter).toBe('pixel')
    expect(p.layerOverrides).toEqual({ machine: false, pipe: true })
  })

  it('fills defaults for partial data and falls back on corrupt JSON', () => {
    localStorage.setItem('atlas:renderPrefs', '{"presetId":"topo"}')
    const partial = loadRenderPrefs()
    expect(partial.presetId).toBe('topo')
    expect(partial.textureFilter).toBe('preset') // default filled in

    localStorage.setItem('atlas:renderPrefs', 'not json')
    expect(loadRenderPrefs().presetId).toBe('journeymap') // corrupt → defaults
  })
})
