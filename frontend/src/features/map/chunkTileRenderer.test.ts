import { describe, expect, it } from 'vitest'

import { BlockRenderRegistry } from '../blocks/blockRenderRegistry'
import type { ChunkData } from './api/chunks'
import { computeEdgeHeights, computeHillshade } from './chunkTileRenderer'

// Minimal chunk: one 16-high section at section y=4 (abs Y 64-79).
// Block id 1 = solid (registry default). Heights vary per column below.
function makeChunk(
  fill: (x: number, z: number, y: number) => number
): ChunkData {
  const blocks = new Array(4096).fill(0)
  const data = new Array(4096).fill(0)
  for (let y = 0; y < 16; y++)
    for (let z = 0; z < 16; z++)
      for (let x = 0; x < 16; x++)
        blocks[(y << 8) | (z << 4) | x] = fill(x, z, y)
  return {
    chunk_x: 0,
    chunk_z: 0,
    sections: [{ y: 4, blocks, data }],
    biomes: [],
  }
}

const config = { foliageMode: 'full' } as never

describe('computeEdgeHeights', () => {
  const registry = new BlockRenderRegistry()

  it('samples the facing row for each side', () => {
    // Solid up to y=5 everywhere, but the z=15 row is one higher (y=6).
    const chunk = makeChunk((_x, z, y) =>
      y <= 5 || (z === 15 && y === 6) ? 1 : 0
    )
    const north = computeEdgeHeights(chunk, 'n', registry, config) // z=15 row
    const south = computeEdgeHeights(chunk, 's', registry, config) // z=0 row
    expect(north[0]).toBe(64 + 6)
    expect(south[0]).toBe(64 + 5)
  })

  it('indexes w/e edges by z', () => {
    // Column x=15 z=7 is raised.
    const chunk = makeChunk((x, z, y) =>
      y <= 3 || (x === 15 && z === 7 && y === 4) ? 1 : 0
    )
    const west = computeEdgeHeights(chunk, 'w', registry, config) // x=15 column
    expect(west[7]).toBe(64 + 4)
    expect(west[6]).toBe(64 + 3)
  })

  it('skips ignore-category blocks', () => {
    const reg = new BlockRenderRegistry()
    reg.loadJson({
      format: 1,
      source: 'test.json',
      blocks: { 'mod:airlike': { category: 'ignore' } },
    } as never)
    reg.resolveNames({ 2: 'mod:airlike' })
    // id 2 (ignored) on top at y=9, solid id 1 below at y=5.
    const chunk = makeChunk((_x, _z, y) => (y <= 5 ? 1 : y === 9 ? 2 : 0))
    const heights = computeEdgeHeights(chunk, 'n', reg, config)
    expect(heights[0]).toBe(64 + 5)
  })
})

describe('computeHillshade', () => {
  const cfg = { elevationMode: 'normal', elevationStrength: 1.0 } as never

  it('is zero on flat ground', () => {
    const { brightA, darkA } = computeHillshade(72, 72, 72, 72, 72, cfg)
    expect(brightA).toBe(0)
    expect(darkA).toBe(0)
  })

  it('is zero when shading is off', () => {
    const off = { elevationMode: 'off', elevationStrength: 1.0 } as never
    const s = computeHillshade(72, 60, 90, 60, 90, off)
    expect(s.brightA).toBe(0)
    expect(s.darkA).toBe(0)
  })

  it('treats unknown neighbors (-1) as no contribution', () => {
    const { brightA, darkA } = computeHillshade(72, -1, -1, -1, -1, cfg)
    expect(brightA).toBe(0)
    expect(darkA).toBe(0)
  })

  it('renders a deep drop rim as a whisper, not a wash (regression: W-7)', () => {
    // Floor tile at Y72 with a 7-block drop to its west (edge of a lower
    // room). This produced a +28% (then +12%) white band; JourneyMap shows
    // ~5% there. Must now be barely visible and equal to a 2-block step.
    const deep = computeHillshade(72, 72, 72, 65, 72, cfg)
    const step2 = computeHillshade(72, 72, 72, 70, 72, cfg)
    expect(deep.brightA).toBeCloseTo(step2.brightA, 5)
    expect(deep.brightA).toBeLessThanOrEqual(0.06)
    expect(deep.darkA).toBe(0) // no AO in normal mode
  })

  it('leaves tiles south/east of walls untouched (JourneyMap N/W rule)', () => {
    // Floor beside a 9-block wall to the south and east (base corner):
    // JM only compares N and W, so this tile is flat.
    const { brightA, darkA } = computeHillshade(72, 72, 81, 72, 81, cfg)
    expect(brightA).toBe(0)
    expect(darkA).toBe(0)
  })

  it('shadows tiles below their north/west neighbors', () => {
    // Floor at the base of a 9-block wall to the north.
    const { darkA, brightA } = computeHillshade(72, 81, 72, 72, 72, cfg)
    expect(brightA).toBe(0)
    expect(darkA).toBeGreaterThan(0.05)
    expect(darkA).toBeLessThanOrEqual(0.35)
  })

  it('keeps natural 1-block terrain steps visible', () => {
    const { brightA } = computeHillshade(72, 71, 72, 71, 72, cfg)
    expect(brightA).toBeGreaterThan(0.04)
  })

  it("keeps 'strong' mode dramatic for Topo cliffs", () => {
    const strong = {
      elevationMode: 'strong',
      elevationStrength: 2.5,
    } as never
    const { darkA } = computeHillshade(72, 72, 81, 72, 81, strong)
    expect(darkA).toBeGreaterThan(0.5)
  })
})
