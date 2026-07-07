import type { RenderPrefs } from './renderPrefs'

/** Map centre + zoom captured when a view was saved (a location bookmark). */
export interface SavedCamera {
  cx: number
  cz: number
  scale: number
}

/**
 * A named snapshot of a render view — the base preset plus the session overrides
 * (elevation / texture filter / layer toggles) and, when saved from the map, the
 * camera location + zoom so re-applying jumps back to that spot. Stage 3.3: users
 * save the current view and re-apply it later. Stored in localStorage.
 */
export interface UserPreset extends RenderPrefs {
  id: string
  name: string
  /** Camera bookmark captured at save time; absent for views saved before 3.3.1. */
  camera?: SavedCamera
  /** Dimension the camera belongs to — the camera only restores in a match. */
  dimensionPath?: string
}

const KEY = 'atlas:userPresets'

export function loadUserPresets(): UserPreset[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as UserPreset[]) : []
  } catch {
    return []
  }
}

function persist(list: UserPreset[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list))
  } catch {
    // ignore quota / unavailable storage
  }
}

function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Save a named view. A save with an existing name replaces it (same-name dedupe),
 * so re-saving "My base" updates it in place. Returns the updated list.
 */
export function saveUserPreset(preset: Omit<UserPreset, 'id'>): UserPreset[] {
  const list = loadUserPresets().filter((p) => p.name !== preset.name)
  list.push({ ...preset, id: newId() })
  persist(list)
  return list
}

/** Remove a user preset by id; returns the updated list. */
export function deleteUserPreset(id: string): UserPreset[] {
  const list = loadUserPresets().filter((p) => p.id !== id)
  persist(list)
  return list
}
