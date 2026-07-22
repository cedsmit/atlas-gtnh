import { describe, expect, it } from 'vitest'

import { rotateInBox, rotationNote } from './useChunkOps'

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
