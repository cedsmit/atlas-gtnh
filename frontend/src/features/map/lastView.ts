/**
 * Remembers the last map camera (centre + zoom) per dimension so closing the
 * app or the world and reopening resumes where you left off. Distinct from named
 * "Saved views" (userPresets) — this is the implicit, always-on resume state.
 * Stored in localStorage, keyed by the dimension's path so each dimension of each
 * world keeps its own last position.
 */

export interface SavedView {
  cx: number
  cz: number
  scale: number
}

const KEY = 'atlas:lastView'

type Store = Record<string, SavedView>

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

/** The last camera for a dimension, or null if none was saved (or it's corrupt). */
export function loadLastView(dimensionPath: string): SavedView | null {
  const v = load()[dimensionPath]
  return v && typeof v.cx === 'number' && typeof v.scale === 'number' ? v : null
}

/** Remember the current camera for a dimension. Unchanged values are skipped. */
export function saveLastView(dimensionPath: string, view: SavedView): void {
  // Ignore the engine's uninitialised default (0,0 @ ×1) before its first fit —
  // a real world is never centred exactly there at exactly unit zoom.
  if (view.cx === 0 && view.cz === 0 && view.scale === 1) return
  try {
    const store = load()
    const prev = store[dimensionPath]
    if (
      prev &&
      prev.cx === view.cx &&
      prev.cz === view.cz &&
      prev.scale === view.scale
    ) {
      return
    }
    store[dimensionPath] = view
    localStorage.setItem(KEY, JSON.stringify(store))
  } catch {
    // ignore quota / unavailable storage
  }
}
