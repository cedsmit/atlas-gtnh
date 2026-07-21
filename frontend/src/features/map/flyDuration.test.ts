import { describe, expect, it } from 'vitest'

import { flyDuration } from './flyDuration'

const at = (cx: number, cz: number) => ({ cx, cz })

describe('flyDuration', () => {
  it('keeps a no-op jump at the floor rather than zero', () => {
    // A zero-length fly still needs a frame or two, or it reads as a jump cut.
    expect(flyDuration(at(0, 0), at(0, 0))).toBe(350)
  })

  it('stays snappy for a short hop', () => {
    expect(flyDuration(at(0, 0), at(200, 0))).toBeLessThan(450)
  })

  it('caps a cross-world jump instead of scaling with distance', () => {
    const far = flyDuration(at(0, 0), at(500_000, 500_000))
    expect(far).toBeLessThanOrEqual(900)
    // 2500× the distance must not cost anywhere near 2500× the time.
    expect(far).toBeLessThan(flyDuration(at(0, 0), at(200, 0)) * 3)
  })

  it('grows with distance, but sub-linearly', () => {
    const near = flyDuration(at(0, 0), at(500, 0))
    const mid = flyDuration(at(0, 0), at(5_000, 0))
    const far = flyDuration(at(0, 0), at(50_000, 0))
    expect(near).toBeLessThan(mid)
    expect(mid).toBeLessThan(far)
    // Each 10× of distance adds a similar slice of time, not a 10× multiple.
    // Not exactly equal — the +1 offset in the curve still bites at short range.
    const ratio = (mid - near) / (far - mid)
    expect(ratio).toBeGreaterThan(0.8)
    expect(ratio).toBeLessThan(1.25)
  })

  it('is direction-agnostic', () => {
    expect(flyDuration(at(0, 0), at(-3000, 1500))).toBe(
      flyDuration(at(0, 0), at(3000, -1500))
    )
  })

  it('never leaves the clamp range', () => {
    for (const d of [0, 1, 10, 100, 1e3, 1e5, 1e7]) {
      const ms = flyDuration(at(0, 0), at(d, 0))
      expect(ms).toBeGreaterThanOrEqual(350)
      expect(ms).toBeLessThanOrEqual(900)
    }
  })
})
