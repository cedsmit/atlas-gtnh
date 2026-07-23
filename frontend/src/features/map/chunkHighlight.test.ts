import { describe, expect, it } from 'vitest'

import { chunkFill, chunkOutline } from './chunkHighlight'

/** The distinct (x, y) corners in a vertex buffer. */
function corners(verts: number[]): Set<string> {
  const out = new Set<string>()
  for (let i = 0; i < verts.length; i += 3)
    out.add(`${verts[i]},${verts[i + 1]}`)
  return out
}

/** How many quads (two triangles each) a buffer holds. */
const quads = (verts: number[]) => verts.length / 18

/** Signed area of every triangle: positive is counter-clockwise. */
function windings(verts: number[]): number[] {
  const out: number[] = []
  for (let i = 0; i < verts.length; i += 9) {
    const [ax, ay] = [verts[i], verts[i + 1]]
    const [bx, by] = [verts[i + 3], verts[i + 4]]
    const [cx, cy] = [verts[i + 6], verts[i + 7]]
    out.push((bx - ax) * (cy - ay) - (cx - ax) * (by - ay))
  }
  return out
}

/**
 * Three culls back faces by default, so a clockwise triangle is not a
 * cosmetic slip — it draws nothing at all, silently. Both highlight parts get
 * checked because getting this wrong once made the whole overlay vanish.
 */
describe('winding', () => {
  const chunks: [number, number][] = [
    [0, 0],
    [1, 0],
    [0, 1],
  ]

  it('faces the camera, so the highlight actually draws', () => {
    for (const verts of [chunkFill(chunks), chunkOutline(chunks, 2)])
      for (const area of windings(verts)) expect(area).toBeGreaterThan(0)
  })
})

describe('chunkFill', () => {
  it('covers a chunk with the 16 blocks it owns, at world Y = -Z', () => {
    // Chunk (1, 2) is blocks x 16..32, z 32..48 — and the map draws +Z downward
    // as -Y, so the south edge is the *lower* Y. Getting this sign wrong
    // mirrors the highlight onto the wrong chunks.
    const fill = chunkFill([[1, 2]])
    expect(quads(fill)).toBe(1)
    expect(corners(fill)).toEqual(
      new Set(['16,-32', '32,-32', '32,-48', '16,-48'])
    )
  })

  it('has nothing to draw for an empty selection', () => {
    expect(chunkFill([])).toEqual([])
  })
})

describe('chunkOutline', () => {
  it('bands all four sides of a lone chunk', () => {
    expect(quads(chunkOutline([[0, 0]], 2))).toBe(4)
  })

  it('drops the seams inside a block of chunks', () => {
    // A 2×2 square: 8 outer edges, and the 4 shared inner ones left out.
    expect(
      quads(
        chunkOutline(
          [
            [0, 0],
            [1, 0],
            [0, 1],
            [1, 1],
          ],
          2
        )
      )
    ).toBe(8)
  })

  it('keeps the seam between chunks that only touch at a corner', () => {
    // Diagonal neighbours share no edge, so neither loses one.
    expect(
      quads(
        chunkOutline(
          [
            [0, 0],
            [1, 1],
          ],
          2
        )
      )
    ).toBe(8)
  })

  it('outlines a hole left by the eraser', () => {
    // A 3×3 ring: 12 outer edges plus 4 around the missing middle.
    const ring: [number, number][] = []
    for (let z = 0; z < 3; z++)
      for (let x = 0; x < 3; x++) if (x !== 1 || z !== 1) ring.push([x, z])
    expect(quads(chunkOutline(ring, 2))).toBe(16)
  })

  it('straddles the edge and overruns it, so corners meet square', () => {
    // North edge of chunk (0,0) — blocks x 0..16 along y = 0 — as a band 2
    // wide: half either side of the edge, and half past each end so the
    // east/west bands have something to meet.
    const north = chunkOutline([[0, 0]], 2).slice(0, 18)
    expect(corners(north)).toEqual(new Set(['-1,1', '17,1', '17,-1', '-1,-1']))
  })

  it('has nothing to draw for an empty selection', () => {
    expect(chunkOutline([], 2)).toEqual([])
  })
})
