import type { SearchHit } from './api/searchBlocks'

/** A contiguous patch of one biome — a cluster of connected chunks. */
export interface BiomeRegion {
  cx: number // representative (center) chunk
  cz: number
  x: number // world coords of the center chunk's middle (jump target)
  z: number
  chunks: number // chunks in the region
  columns: number // total area (matching columns) in the region
}

// 8-connectivity: chunks touching on an edge OR corner are the same patch.
const NEIGHBORS: [number, number][] = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
]

/**
 * Group a biome's matched chunks into connected regions, so one contiguous patch
 * is a single entry instead of dozens of neighbouring chunks. Each region reports
 * its size and a center jump target — the member chunk nearest the region's
 * centroid, so the jump lands inside the biome even for concave/ring shapes.
 */
export function clusterBiomeRegions(hits: SearchHit[]): BiomeRegion[] {
  const byKey = new Map<string, SearchHit>()
  for (const h of hits) byKey.set(`${h.cx},${h.cz}`, h)

  const seen = new Set<string>()
  const regions: BiomeRegion[] = []

  for (const h of hits) {
    const startKey = `${h.cx},${h.cz}`
    if (seen.has(startKey)) continue
    seen.add(startKey)

    // Flood-fill this chunk's connected component.
    const members: SearchHit[] = []
    const stack = [h]
    while (stack.length) {
      const c = stack.pop()!
      members.push(c)
      for (const [dx, dz] of NEIGHBORS) {
        const nk = `${c.cx + dx},${c.cz + dz}`
        const n = byKey.get(nk)
        if (n && !seen.has(nk)) {
          seen.add(nk)
          stack.push(n)
        }
      }
    }

    // Centroid, then the member chunk nearest it (keeps the jump in-biome).
    let sumCx = 0
    let sumCz = 0
    let columns = 0
    for (const m of members) {
      sumCx += m.cx
      sumCz += m.cz
      columns += m.count
    }
    const avgCx = sumCx / members.length
    const avgCz = sumCz / members.length
    let center = members[0]
    let bestD = Infinity
    for (const m of members) {
      const d = (m.cx - avgCx) ** 2 + (m.cz - avgCz) ** 2
      if (d < bestD) {
        bestD = d
        center = m
      }
    }

    regions.push({
      cx: center.cx,
      cz: center.cz,
      x: center.cx * 16 + 8,
      z: center.cz * 16 + 8,
      chunks: members.length,
      columns,
    })
  }
  return regions
}
