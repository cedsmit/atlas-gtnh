/** Shortest and longest a fly-to may take, in ms. */
const MIN_MS = 350
const MAX_MS = 900

/**
 * How long the camera should take to fly between two world points.
 *
 * A fixed duration serves both ends badly: a hop to the next base over feels
 * sluggish, while a jump across the world at the same duration is a violent
 * swoop. Distance is scaled on a log curve so each order of magnitude further
 * buys a little more travel time rather than a proportional amount — a 200-block
 * hop stays snappy, a 50k-block jump gets roughly double, not 250×.
 *
 * Clamped at both ends: below MIN_MS the motion reads as a jump cut, above
 * MAX_MS the user is just waiting.
 */
export function flyDuration(
  from: { cx: number; cz: number },
  to: { cx: number; cz: number }
): number {
  const dist = Math.hypot(to.cx - from.cx, to.cz - from.cz)
  const ms = 300 + 140 * Math.log10(1 + dist / 50)
  return Math.max(MIN_MS, Math.min(MAX_MS, ms))
}
