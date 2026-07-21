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
    expect(p.layerOverrides).toEqual({})
  })

  it('round-trips a saved view', () => {
    saveRenderPrefs({
      presetId: 'vanilla',
      layerOverrides: { machine: false, pipe: true },
    })
    const p = loadRenderPrefs()
    expect(p.presetId).toBe('vanilla')
    expect(p.layerOverrides).toEqual({ machine: false, pipe: true })
  })

  it('fills defaults for partial data and falls back on corrupt JSON', () => {
    localStorage.setItem('atlas:renderPrefs', '{"presetId":"topo"}')
    const partial = loadRenderPrefs()
    expect(partial.presetId).toBe('topo')
    expect(partial.layerOverrides).toEqual({}) // default filled in

    localStorage.setItem('atlas:renderPrefs', 'not json')
    expect(loadRenderPrefs().presetId).toBe('journeymap') // corrupt → defaults
  })

  it('ignores keys left behind by older builds', () => {
    // Both are preset-owned now; stale stored keys must not resurface.
    localStorage.setItem(
      'atlas:renderPrefs',
      '{"presetId":"journeymap","textureFilter":"journeymap","elevOverride":"relief"}'
    )
    const p = loadRenderPrefs()
    expect('textureFilter' in p).toBe(false)
    expect('elevOverride' in p).toBe(false)
  })
})
