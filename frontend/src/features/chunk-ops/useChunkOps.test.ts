import { describe, expect, it } from 'vitest'

import {
  applyBrush,
  boundsOf,
  boxChunks,
  chunkKey,
  chunkLine,
  type ChunkSet,
  pasteTargets,
  rotateInBox,
  rotationNote,
} from './useChunkOps'

const setOf = (...chunks: [number, number][]): ChunkSet =>
  new Set(chunks.map(([cx, cz]) => chunkKey(cx, cz)))

const sorted = (chunks: [number, number][]) =>
  [...chunks].sort((a, b) => a[0] - b[0] || a[1] - b[1])

/**
 * `rotateInBox` mirrors `rotate_grid` in the backend. If the two drift, the
 * preview outlines one set of chunks and the paste writes another — so these
 * cases are deliberately the same shape as the backend's own.
 */
describe('rotateInBox', () => {
  it('sends a quarter turn clockwise, matching the backend convention', () => {
    // A 1-wide, 3-tall strip becomes 3-wide, 1-tall; the far end leads.
    expect(rotateInBox(0, 0, 90, 1, 3)).toEqual([2, 0])
    expect(rotateInBox(0, 1, 90, 1, 3)).toEqual([1, 0])
    expect(rotateInBox(0, 2, 90, 1, 3)).toEqual([0, 0])
  })

  it('leaves everything where it is at zero', () => {
    expect(rotateInBox(2, 5, 0, 4, 7)).toEqual([2, 5])
  })

  it('returns to the start after four quarter turns', () => {
    const w = 3
    const h = 5
    for (const [i, j] of [
      [0, 0],
      [2, 4],
      [1, 3],
    ]) {
      // Each turn swaps the box dimensions, so they swap back on the way round.
      let p: [number, number] = [i, j]
      let [bw, bh] = [w, h]
      for (let n = 0; n < 4; n++) {
        p = rotateInBox(p[0], p[1], 90, bw, bh)
        ;[bw, bh] = [bh, bw]
      }
      expect(p).toEqual([i, j])
    }
  })

  it('normalises turns outside 0-359', () => {
    expect(rotateInBox(0, 1, 450, 1, 3)).toEqual(rotateInBox(0, 1, 90, 1, 3))
    expect(rotateInBox(0, 1, -90, 1, 3)).toEqual(rotateInBox(0, 1, 270, 1, 3))
  })
})

describe('the selection brush', () => {
  it('replaces, adds and subtracts', () => {
    const start = setOf([0, 0], [1, 0])
    expect(applyBrush(start, [[5, 5]], 'replace')).toEqual(setOf([5, 5]))
    expect(applyBrush(start, [[1, 1]], 'add')).toEqual(
      setOf([0, 0], [1, 0], [1, 1])
    )
    expect(applyBrush(start, [[1, 0]], 'subtract')).toEqual(setOf([0, 0]))
  })

  it('leaves the previous selection untouched', () => {
    const start = setOf([0, 0])
    applyBrush(start, [[9, 9]], 'add')
    expect(start).toEqual(setOf([0, 0]))
  })

  it('shrugs off subtracting a chunk that was never selected', () => {
    expect(applyBrush(setOf([0, 0]), [[4, 4]], 'subtract')).toEqual(
      setOf([0, 0])
    )
  })

  it('fills the gap between two mouse samples, so a fast drag has no holes', () => {
    // Diagonal: one chunk per step along the longer axis, start excluded.
    expect(chunkLine([0, 0], [3, 3])).toEqual([
      [1, 1],
      [2, 2],
      [3, 3],
    ])
    // Shallow slope: still one per step of the longer axis.
    expect(chunkLine([0, 0], [3, 1])).toEqual([
      [1, 0],
      [2, 1],
      [3, 1],
    ])
    expect(chunkLine([2, -2], [2, -2])).toEqual([])
  })

  it('boxes from any pair of corners', () => {
    const fromTopLeft = boxChunks([0, 0], [1, 1])
    expect(sorted(fromTopLeft)).toEqual([
      [0, 0],
      [0, 1],
      [1, 0],
      [1, 1],
    ])
    expect(sorted(boxChunks([1, 1], [0, 0]))).toEqual(sorted(fromTopLeft))
  })
})

describe('boundsOf', () => {
  it('reports the extent, not the shape', () => {
    // An L: the box it spans is bigger than the chunks in it.
    expect(boundsOf(setOf([0, 0], [0, 1], [0, 2], [1, 2]))).toEqual({
      cx0: 0,
      cz0: 0,
      cx1: 1,
      cz1: 2,
    })
  })

  it('has nothing to report for an empty selection', () => {
    expect(boundsOf(new Set())).toBeNull()
  })

  it('handles negative coordinates', () => {
    expect(boundsOf(setOf([-5, 3], [2, -7]))).toEqual({
      cx0: -5,
      cz0: -7,
      cx1: 2,
      cz1: 3,
    })
  })
})

/**
 * The preview outline and the post-paste redraw both come from `pasteTargets`,
 * so what it returns is what the write is expected to touch. A sparse
 * selection must stay sparse through a turn — rotating the *bounding box* and
 * filling it would claim chunks the paste never writes.
 */
describe('pasteTargets', () => {
  const clip = {
    srcDim: 'd',
    srcWorld: 'w',
    chunks: [
      [10, 10],
      [10, 11],
      [10, 12],
      [11, 10],
    ] as [number, number][],
    bounds: { cx0: 10, cz0: 10, cx1: 11, cz1: 12 },
  }

  it('shifts to the anchor when nothing is turned', () => {
    expect(sorted(pasteTargets(clip, { cx: 0, cz: 0 }, 0))).toEqual([
      [0, 0],
      [0, 1],
      [0, 2],
      [1, 0],
    ])
  })

  it('keeps the same chunk count through a quarter turn', () => {
    const turned = pasteTargets(clip, { cx: 0, cz: 0 }, 90)
    expect(turned).toHaveLength(clip.chunks.length)
    // The 2×3 footprint becomes 3×2, mirroring rotate_grid in the backend.
    expect(sorted(turned)).toEqual([
      [0, 0],
      [1, 0],
      [2, 0],
      [2, 1],
    ])
  })

  it('lands where the anchor says', () => {
    expect(sorted(pasteTargets(clip, { cx: -3, cz: 7 }, 0))).toEqual([
      [-3, 7],
      [-3, 8],
      [-3, 9],
      [-2, 7],
    ])
  })
})

describe('rotationNote', () => {
  it('says nothing when the paste was not turned', () => {
    expect(rotationNote(undefined)).toBe('')
  })

  it('names the guessed fields, because those are the ones to go and check', () => {
    const note = rotationNote({
      turn: 90,
      blocks_turned: 12,
      blocks_skipped: {},
      guessed_keys: { mFacing: 3, mConnections: 2 },
    })
    expect(note).toContain('90°')
    expect(note).toContain('12 block(s) re-faced')
    expect(note).toContain('5 machine field(s)')
    expect(note).toContain('check them in game')
  })

  it('does not warn about guesses when there were none', () => {
    const note = rotationNote({
      turn: 180,
      blocks_turned: 4,
      blocks_skipped: {},
      guessed_keys: {},
    })
    expect(note).not.toContain('guess')
  })
})
