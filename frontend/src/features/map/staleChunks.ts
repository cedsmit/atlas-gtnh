/**
 * Which drawn chunks still need re-rendering after a texture/config change.
 *
 * A `texVersion` bump invalidates every tile at once, so the engine derives the
 * affected keys once per bump instead of re-deriving them by scanning the whole
 * chunk cache every frame — `texVersion` is greater than zero from the first
 * loaded texture onward, so a `texVersion > 0` guard never actually gates work.
 *
 * Kept in its own module (rather than inline in mapEngine) so the boundary
 * condition is unit-testable without standing up Three.js or a canvas.
 */
export function collectStaleChunks<T>(
  cache: ReadonlyMap<string, T>,
  /** True for entries that are actually drawn — placeholders can't be stale. */
  isDrawn: (entry: T) => boolean,
  /** texVersion each key was last rendered at; absent = never rendered. */
  renderedAt: ReadonlyMap<string, number>,
  texVersion: number
): Set<string> {
  const stale = new Set<string>()
  for (const [key, entry] of cache) {
    if (!isDrawn(entry)) continue
    // Strictly less-than: a tile rendered *at* the current version is current.
    // Using <= would re-render it forever; using < on a missing entry (0) still
    // marks it, which is what we want for a tile drawn before any texture load.
    if ((renderedAt.get(key) ?? 0) < texVersion) stale.add(key)
  }
  return stale
}
