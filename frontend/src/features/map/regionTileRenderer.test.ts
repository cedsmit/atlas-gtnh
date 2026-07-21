import { describe, expect, it } from 'vitest'

import { boxBlur } from './regionTileRenderer'

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
