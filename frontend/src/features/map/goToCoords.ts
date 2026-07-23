/**
 * Reading coordinates the way they actually reach you.
 *
 * Coordinates get copied out of the F3 screen, out of Discord, off a wiki page
 * — rarely typed fresh. So the "go to" field accepts what those look like
 * rather than one canonical format.
 */

/** Minecraft's hard world limit; past it the game has no world to show. */
export const WORLD_LIMIT = 30_000_000

/** Why *value* is not a usable coordinate, or null when it is fine. */
export function coordinateError(value: string): string | null {
  const text = value.trim()
  if (text === '') return 'Enter a number'
  const n = Number(text)
  if (!Number.isFinite(n)) return 'Not a number'
  if (Math.abs(n) > WORLD_LIMIT) return 'Outside the world'
  return null
}

/**
 * Pull an X and Z out of pasted text, or null if it holds neither.
 *
 * Two numbers are read as X and Z. **Three are read as X, Y, Z** and the middle
 * one is dropped — that is what F3 puts on the clipboard
 * (`XYZ: -1234.5 / 70.0 / 890.1`), and a map has no use for the height.
 * Anything around the numbers is ignored, so labelled forms like `x: 12 z: 34`
 * work without a rule of their own.
 */
export function parseCoordinates(text: string): [number, number] | null {
  const found = text.match(/-?\d+(?:\.\d+)?/g)
  if (!found) return null
  const nums = found.map(Number)
  if (nums.length === 3) return [nums[0], nums[2]]
  if (nums.length >= 2) return [nums[0], nums[1]]
  return null
}
