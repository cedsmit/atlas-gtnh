import { beforeEach, describe, expect, it } from 'vitest'

import {
  deleteUserPreset,
  loadUserPresets,
  saveUserPreset,
} from './userPresets'

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

const view = () => ({
  presetId: 'journeymap',
  elevOverride: 'preset' as const,
  textureFilter: 'preset' as const,
  layerOverrides: {},
})

describe('user presets (Stage 3.3)', () => {
  it('is empty by default', () => {
    expect(loadUserPresets()).toEqual([])
  })

  it('saves a named view with a generated id and reloads it', () => {
    const list = saveUserPreset({ name: 'Base', ...view() })
    expect(list).toHaveLength(1)
    expect(list[0].name).toBe('Base')
    expect(list[0].id).toBeTruthy()
    expect(loadUserPresets()[0].name).toBe('Base')
  })

  it('re-saving the same name replaces it (dedupe)', () => {
    saveUserPreset({ name: 'Base', ...view() })
    const list = saveUserPreset({ name: 'Base', ...view(), presetId: 'topo' })
    expect(list).toHaveLength(1)
    expect(list[0].presetId).toBe('topo')
  })

  it('deletes by id', () => {
    const list = saveUserPreset({ name: 'Base', ...view() })
    expect(deleteUserPreset(list[0].id)).toEqual([])
  })

  it('returns empty on corrupt storage', () => {
    localStorage.setItem('atlas:userPresets', 'not json')
    expect(loadUserPresets()).toEqual([])
  })
})
