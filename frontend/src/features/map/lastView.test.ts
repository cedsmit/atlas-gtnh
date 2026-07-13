import { beforeEach, describe, expect, it } from 'vitest'

import { loadLastView, saveLastView } from './lastView'

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

describe('lastView (resume camera)', () => {
  it('is null when nothing was saved', () => {
    expect(loadLastView('/dimA')).toBeNull()
  })

  it('round-trips a camera for a dimension', () => {
    saveLastView('/dimA', { cx: 100, cz: -50, scale: 3.5 })
    expect(loadLastView('/dimA')).toEqual({ cx: 100, cz: -50, scale: 3.5 })
  })

  it('keeps a separate camera per dimension', () => {
    saveLastView('/dimA', { cx: 1, cz: 2, scale: 2 })
    saveLastView('/dimB', { cx: 9, cz: 9, scale: 8 })
    expect(loadLastView('/dimA')).toEqual({ cx: 1, cz: 2, scale: 2 })
    expect(loadLastView('/dimB')).toEqual({ cx: 9, cz: 9, scale: 8 })
  })

  it('ignores the uninitialised default (0,0 @ x1)', () => {
    saveLastView('/dimA', { cx: 0, cz: 0, scale: 1 })
    expect(loadLastView('/dimA')).toBeNull()
  })

  it('returns null on corrupt storage', () => {
    localStorage.setItem('atlas:lastView', 'not json')
    expect(loadLastView('/dimA')).toBeNull()
  })
})
