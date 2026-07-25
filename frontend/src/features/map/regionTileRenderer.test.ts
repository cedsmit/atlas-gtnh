import { describe, expect, it, vi } from 'vitest'

import {
  boxBlur,
  columnStyleCache,
  FLAT,
  FOLIAGE,
  GRASS,
  WATER,
} from './regionTileRenderer'
import type { BlockColorMap } from '../blocks/api/blockColors'
import type { BlockRenderRegistry } from '../blocks/blockRenderRegistry'
import {
  hardcodedBlockColor,
  metaBlockColorRGB,
  resolveMetadataTint,
  UNKNOWN_COLOR,
} from '../blocks/blockColors'
import {
  BUILT_IN_PRESETS,
  presetToConfig,
  type RenderConfig,
} from '../blocks/renderPresets'

/**
 * The straightforward re-summing blur the optimised one replaced. Kept here as
 * the oracle: the running-window version must agree with it exactly, or biome
 * borders on the overview would shift.
 */
function naiveBoxBlur(
  buf: Uint8Array,
  tmp: Uint8Array,
  N: number,
  R: number
): void {
  for (let z = 0; z < N; z++) {
    const row = z * N
    for (let x = 0; x < N; x++) {
      const lo = x - R < 0 ? 0 : x - R
      const hi = x + R >= N ? N - 1 : x + R
      let sum = 0
      for (let j = lo; j <= hi; j++) sum += buf[row + j]
      tmp[row + x] = (sum / (hi - lo + 1)) | 0
    }
  }
  for (let x = 0; x < N; x++) {
    for (let z = 0; z < N; z++) {
      const lo = z - R < 0 ? 0 : z - R
      const hi = z + R >= N ? N - 1 : z + R
      let sum = 0
      for (let j = lo; j <= hi; j++) sum += tmp[j * N + x]
      buf[z * N + x] = (sum / (hi - lo + 1)) | 0
    }
  }
}

/** Deterministic LCG so a failure is reproducible. */
function seeded(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 0x100000000
  }
}

function run(N: number, R: number, seed: number) {
  const rand = seeded(seed)
  const src = new Uint8Array(N * N)
  for (let i = 0; i < src.length; i++) src[i] = (rand() * 256) | 0

  const fast = Uint8Array.from(src)
  const slow = Uint8Array.from(src)
  boxBlur(fast, new Uint8Array(N * N), N, R)
  naiveBoxBlur(slow, new Uint8Array(N * N), N, R)
  return { fast, slow }
}

describe('boxBlur (running-window)', () => {
  // The radius the renderer actually uses, at a realistic-ish tile size.
  it('matches the naive blur at the production radius', () => {
    const { fast, slow } = run(64, 3, 12345)
    expect(fast).toEqual(slow)
  })

  it.each([
    [1, 3],
    [2, 3],
    [7, 0],
    [7, 1],
    [8, 7],
    [8, 64],
    [33, 5],
  ])('matches for N=%i R=%i (edge clamping)', (N, R) => {
    const { fast, slow } = run(N, R, 987 + N * 31 + R)
    expect(fast).toEqual(slow)
  })

  it('is flat for uniform input (window average is the value itself)', () => {
    const N = 16
    const buf = new Uint8Array(N * N).fill(200)
    boxBlur(buf, new Uint8Array(N * N), N, 3)
    expect([...new Set(buf)]).toEqual([200])
  })

  it('spreads an isolated spike into its neighbourhood', () => {
    const N = 16
    const buf = new Uint8Array(N * N)
    buf[8 * N + 8] = 255
    boxBlur(buf, new Uint8Array(N * N), N, 2)
    // Centre keeps the most weight; a pixel inside the radius picks some up;
    // one well outside stays untouched.
    expect(buf[8 * N + 8]).toBeGreaterThan(0)
    expect(buf[8 * N + 9]).toBeGreaterThan(0)
    expect(buf[8 * N + 15]).toBe(0)
  })
})

// ── columnStyleCache ─────────────────────────────────────────────────────────

interface FakeDef {
  category?: string
  tint?: string
  textureTint?: string
  textureTintColors?: readonly string[]
}

/** A registry that answers from a plain table — no world, no resolver. */
function fakeRegistry(defs: Record<number, FakeDef>): BlockRenderRegistry {
  return {
    lookup: (id: number) => defs[id] ?? {},
  } as unknown as BlockRenderRegistry
}

function config(over: Partial<RenderConfig> = {}): RenderConfig {
  return { ...presetToConfig(BUILT_IN_PRESETS[0]), ...over }
}

/**
 * The per-pixel resolution the memo replaced, kept as the oracle — the same
 * role naiveBoxBlur plays above. Only the position-independent branches: grass,
 * foliage and water are finished in the pixel loop from data this never sees.
 */
function oracleFlatColor(
  id: number,
  meta: number,
  deps: {
    registry: BlockRenderRegistry
    colorMap?: BlockColorMap
    textureKeys?: Record<number, string>
    metaTextureKeys?: Record<string, string>
    texAvgOf: (k: string) => readonly [number, number, number] | null
    sat: number
  }
): [number, number, number] {
  const def = deps.registry.lookup(id) as FakeDef
  const texKey =
    deps.metaTextureKeys?.[`${id}:${meta}`] ?? deps.textureKeys?.[id] ?? null
  const texAvg = texKey ? deps.texAvgOf(texKey) : null
  let r: number, g: number, b: number

  if (def.textureTint === 'metadata16' || def.textureTint === 'custom') {
    ;[r, g, b] = resolveMetadataTint(meta, def.textureTintColors)
  } else if (texAvg) {
    ;[r, g, b] = texAvg
  } else {
    const metaColor = metaBlockColorRGB(id, meta)
    if (metaColor) {
      ;[r, g, b] = metaColor
    } else {
      const mapped = deps.colorMap?.[id]
      if (mapped) {
        ;[r, g, b] = mapped
        const maxCh = Math.max(r, g, b)
        if (maxCh === 0) {
          r = g = b = 130
        } else if (maxCh < 80) {
          const boost = 80 / maxCh
          r = Math.min(255, Math.round(r * boost))
          g = Math.min(255, Math.round(g * boost))
          b = Math.min(255, Math.round(b * boost))
        }
      } else {
        ;[r, g, b] = hardcodedBlockColor(id) ?? UNKNOWN_COLOR
      }
    }
  }
  if (deps.sat < 1.0) {
    const lum = 0.299 * r + 0.587 * g + 0.114 * b
    r = Math.round(lum + (r - lum) * deps.sat)
    g = Math.round(lum + (g - lum) * deps.sat)
    b = Math.round(lum + (b - lum) * deps.sat)
  }
  return [r, g, b]
}

describe('columnStyleCache', () => {
  const DEFS: Record<number, FakeDef> = {
    1: {}, // plain solid, no texture → colour map / hardcoded
    2: { tint: 'grass' },
    18: { tint: 'foliage' },
    9: { category: 'fluid', tint: 'water' },
    35: { textureTint: 'metadata16' }, // wool: per-meta dye colour
    99: { textureTint: 'custom', textureTintColors: ['#ff0000', '#00ff00'] },
    123: {}, // nothing known anywhere → UNKNOWN_COLOR
  }
  const registry = fakeRegistry(DEFS)
  const texAvgOf = (k: string): readonly [number, number, number] | null =>
    k === 'stone' ? [110, 110, 110] : k === 'wool:1' ? [200, 120, 40] : null

  it.each([0.4, 1.0])(
    'matches the per-pixel resolution it replaced (saturation %s)',
    (sat) => {
      const colorMap: BlockColorMap = {
        1: [40, 90, 30],
        7: [0, 0, 0], // all-black → the 130 grey guard
        8: [10, 20, 15], // dark → the brightness boost
      }
      const textureKeys = { 1: 'stone' }
      const metaTextureKeys = { '35:1': 'wool:1' }
      const cfg = config({ colorSaturation: sat })
      const styleOf = columnStyleCache({
        colorMap,
        registry,
        config: cfg,
        textureKeys,
        metaTextureKeys,
        blendTints: true,
        texAvgOf,
      })

      for (const id of [1, 7, 8, 35, 99, 123]) {
        for (const meta of [0, 1, 5, 15]) {
          const style = styleOf(id, meta)
          expect(style.kind).toBe(FLAT)
          expect([style.r, style.g, style.b]).toEqual(
            oracleFlatColor(id, meta, {
              registry,
              colorMap,
              textureKeys,
              metaTextureKeys,
              texAvgOf,
              sat,
            })
          )
        }
      }
    }
  )

  it('routes the position-dependent blocks to the pixel loop', () => {
    const styleOf = columnStyleCache({
      colorMap: undefined,
      registry,
      config: config(),
      blendTints: true,
      texAvgOf,
    })
    expect(styleOf(2, 0).kind).toBe(GRASS)
    expect(styleOf(18, 0).kind).toBe(FOLIAGE)
    expect(styleOf(9, 0).kind).toBe(WATER)
  })

  it('drops grass and foliage back to flat colours when tints are off', () => {
    // With biomeTint off there is no blended tint to sample, so those columns
    // must resolve like any other block instead of reading an absent scratch.
    const styleOf = columnStyleCache({
      colorMap: { 2: [90, 140, 60], 18: [60, 100, 40] },
      registry,
      config: config({ colorSaturation: 1 }),
      blendTints: false,
      texAvgOf,
    })
    expect(styleOf(2, 0).kind).toBe(FLAT)
    expect(styleOf(18, 0).kind).toBe(FLAT)
    expect([styleOf(2, 0).r, styleOf(2, 0).g, styleOf(2, 0).b]).toEqual([
      90, 140, 60,
    ])
  })

  it('prefers the per-metadata texture over the per-id one', () => {
    const styleOf = columnStyleCache({
      colorMap: undefined,
      registry,
      config: config({ colorSaturation: 1 }),
      textureKeys: { 35: 'stone' },
      metaTextureKeys: { '35:1': 'wool:1' },
      blendTints: true,
      texAvgOf,
    })
    // id 35 is metadata16, so the tint wins over both textures — but the key
    // must still resolve per meta, which is what the string build was for.
    expect(styleOf(35, 1).texAvg).toEqual([200, 120, 40])
    expect(styleOf(35, 2).texAvg).toEqual([110, 110, 110])
  })

  it('resolves each (id, meta) pair once, however many columns share it', () => {
    const spy = vi.fn(texAvgOf)
    const lookup = vi.fn((id: number) => DEFS[id] ?? {})
    const styleOf = columnStyleCache({
      colorMap: { 1: [40, 90, 30] },
      registry: { lookup } as unknown as BlockRenderRegistry,
      config: config(),
      textureKeys: { 1: 'stone' },
      metaTextureKeys: { '35:1': 'wool:1' },
      blendTints: true,
      texAvgOf: spy,
    })

    // A region is 512×512 columns; three distinct pairs across all of them.
    const pairs: [number, number][] = [
      [1, 0],
      [35, 1],
      [123, 7],
    ]
    for (let i = 0; i < 512 * 512; i++) {
      const [id, meta] = pairs[i % pairs.length]
      styleOf(id, meta)
    }
    expect(lookup).toHaveBeenCalledTimes(pairs.length)
    // Two of the three: id 123 has no texture key, so its average is never
    // asked for at all — the third lookup that never happens.
    expect(spy).toHaveBeenCalledTimes(2)
    // Same pair, same object: nothing is rebuilt per column.
    expect(styleOf(1, 0)).toBe(styleOf(1, 0))
  })
})
