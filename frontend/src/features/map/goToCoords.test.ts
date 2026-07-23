import { describe, expect, it } from 'vitest'

import { coordinateError, parseCoordinates, WORLD_LIMIT } from './goToCoords'

describe('coordinateError', () => {
  it('accepts what a coordinate looks like', () => {
    for (const ok of ['0', '1234', '-1234', '12.5', '  -7  '])
      expect(coordinateError(ok)).toBeNull()
  })

  it('rejects empty and non-numeric input', () => {
    expect(coordinateError('')).toBe('Enter a number')
    expect(coordinateError('   ')).toBe('Enter a number')
    expect(coordinateError('over there')).toBe('Not a number')
    expect(coordinateError('12x')).toBe('Not a number')
  })

  it('rejects a coordinate past the world border', () => {
    // Beyond this the game has no world, so the map would fly somewhere
    // permanently empty and leave you lost with no landmark to get back by.
    expect(coordinateError(String(WORLD_LIMIT))).toBeNull()
    expect(coordinateError(String(WORLD_LIMIT + 1))).toBe('Outside the world')
    expect(coordinateError(String(-WORLD_LIMIT - 1))).toBe('Outside the world')
  })

  it('rejects the things Number() would happily swallow', () => {
    // Number('') is 0 and Number('Infinity') is Infinity — an empty field or a
    // typed "Infinity" would both sail through a bare isNaN check and fly the
    // camera somewhere absurd.
    expect(coordinateError('Infinity')).toBe('Not a number')
    expect(coordinateError('NaN')).toBe('Not a number')
  })
})

describe('parseCoordinates', () => {
  it('reads a plain pair', () => {
    expect(parseCoordinates('123, -456')).toEqual([123, -456])
    expect(parseCoordinates('123 -456')).toEqual([123, -456])
  })

  it('drops the height from an F3 triple', () => {
    // What Minecraft's debug screen puts on the clipboard. Taking the first two
    // numbers would send you to (x, y) — a plausible-looking wrong place.
    expect(parseCoordinates('XYZ: -1234.5 / 70.0 / 890.1')).toEqual([
      -1234.5, 890.1,
    ])
  })

  it('ignores whatever is written around the numbers', () => {
    expect(parseCoordinates('x: 12 z: 34')).toEqual([12, 34])
    expect(parseCoordinates('base at 100,200!')).toEqual([100, 200])
  })

  it('has nothing to offer when there is no pair', () => {
    expect(parseCoordinates('')).toBeNull()
    expect(parseCoordinates('somewhere')).toBeNull()
    expect(parseCoordinates('1234')).toBeNull()
  })
})
