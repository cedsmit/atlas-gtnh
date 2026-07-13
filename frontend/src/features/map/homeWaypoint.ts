/**
 * Remembers a "home" waypoint (your base) per dimension, so the map can pin a
 * marker there and searches can measure distance from it. Stored in localStorage,
 * keyed by the dimension's path so each dimension of each world keeps its own
 * home — mirrors {@link ./lastView}.
 *
 * The per-dimension record is an object (not a bare position) so future named
 * waypoints — friends' bases, mines, portals — can slot in alongside `home`
 * without a storage migration.
 */

export interface HomePos {
  x: number
  z: number
}

interface DimWaypoints {
  home?: HomePos
  // Future: named?: { id: string; name: string; x: number; z: number }[]
}

const KEY = 'atlas:homeWaypoint'

type Store = Record<string, DimWaypoints>

function load(): Store {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? (parsed as Store) : {}
  } catch {
    return {}
  }
}

function persist(store: Store): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(store))
  } catch {
    // ignore quota / unavailable storage
  }
}

/** The home waypoint for a dimension, or null if none is set (or it's corrupt). */
export function loadHome(dimensionPath: string): HomePos | null {
  const h = load()[dimensionPath]?.home
  return h && typeof h.x === 'number' && typeof h.z === 'number' ? h : null
}

/** Set (or move) the home waypoint for a dimension. */
export function saveHome(dimensionPath: string, pos: HomePos): void {
  const store = load()
  store[dimensionPath] = { ...store[dimensionPath], home: pos }
  persist(store)
}

/** Straight-line horizontal (XZ) block distance from home, rounded. Y is ignored
 *  on purpose — players glide/fly, so elevation doesn't reflect travel effort. */
export function homeDistance(x: number, z: number, home: HomePos): number {
  const dx = x - home.x
  const dz = z - home.z
  return Math.round(Math.sqrt(dx * dx + dz * dz))
}

/**
 * Sort any positioned hits nearest-first from home (returns a new array), or hand
 * back the original order when no home is set. Shared by the search panels so the
 * "sort by distance from home" behaviour lives in one place.
 */
export function sortByDistanceFromHome<T extends { x: number; z: number }>(
  items: T[],
  home: HomePos | null
): T[] {
  if (!home) return items
  return [...items].sort(
    (a, b) => homeDistance(a.x, a.z, home) - homeDistance(b.x, b.z, home)
  )
}

/** Remove the home waypoint for a dimension. */
export function clearHome(dimensionPath: string): void {
  const store = load()
  const dim = store[dimensionPath]
  if (!dim || !dim.home) return
  delete dim.home
  persist(store)
}
