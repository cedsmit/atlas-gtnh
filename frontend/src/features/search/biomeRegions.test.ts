import { describe, expect, it } from 'vitest'

import type { SearchHit } from './api/searchBlocks'
import { clusterBiomeRegions } from './biomeRegions'

/** Build a hit at chunk (cx, cz) with `count` matching columns. */
function hit(cx: number, cz: number, count = 256): SearchHit {
  return { cx, cz, count, x: cx * 16, y: 64, z: cz * 16 }
}

describe('clusterBiomeRegions', () => {
  it('returns nothing for no hits', () => {
    expect(clusterBiomeRegions([])).toEqual([])
  })

  it('merges edge- and corner-touching chunks into one region', () => {
    // An L-shape plus a diagonal — all 8-connected, so one region.
    const regions = clusterBiomeRegions([
      hit(0, 0),
      hit(1, 0),
      hit(1, 1),
      hit(2, 2), // touches (1,1) only at the corner → still same patch
    ])
    expect(regions).toHaveLength(1)
    expect(regions[0].chunks).toBe(4)
    expect(regions[0].columns).toBe(4 * 256)
  })

  it('separates disconnected patches', () => {
    const regions = clusterBiomeRegions([
      hit(0, 0),
      hit(1, 0),
      hit(50, 50), // far away → its own region
    ])
    expect(regions).toHaveLength(2)
    expect(regions.map((r) => r.chunks).sort()).toEqual([1, 2])
  })

  it('centers the jump on a member chunk near the centroid', () => {
    // A 3×3 block: centroid is chunk (1,1); jump target is its middle.
    const hits: SearchHit[] = []
    for (let cx = 0; cx < 3; cx++)
      for (let cz = 0; cz < 3; cz++) hits.push(hit(cx, cz))
    const [region] = clusterBiomeRegions(hits)
    expect(region.chunks).toBe(9)
    expect([region.cx, region.cz]).toEqual([1, 1])
    expect([region.x, region.z]).toEqual([1 * 16 + 8, 1 * 16 + 8])
  })
})
