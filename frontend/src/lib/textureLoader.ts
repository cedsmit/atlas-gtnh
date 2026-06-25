/**
 * Singleton texture loader for block face PNGs fetched from the backend.
 *
 * Textures are loaded asynchronously on first request and cached for the
 * lifetime of the session.  Subscribers are notified each time a batch of
 * textures resolves so the map renderer can re-draw stale chunk tiles.
 *
 * Designed to be render-engine agnostic: callers receive HTMLImageElement
 * objects that work with Canvas 2D, WebGL, and Three.js alike.
 */

import { API_BASE } from './api'

export type TextureState = 'pending' | 'loaded' | 'missing'

interface Entry {
  state: TextureState
  image: HTMLImageElement | null
}

const _cache = new Map<string, Entry>()
const _subscribers = new Set<() => void>()

let _notifyScheduled = false

function _scheduleNotify() {
  if (_notifyScheduled) return
  _notifyScheduled = true
  // Batch notifications so a burst of loads triggers one re-render pass
  queueMicrotask(() => {
    _notifyScheduled = false
    for (const cb of _subscribers) cb()
  })
}

/** Subscribe to texture-load events.  Returns an unsubscribe function. */
export function onTextureLoad(cb: () => void): () => void {
  _subscribers.add(cb)
  return () => _subscribers.delete(cb)
}

/**
 * Return the loaded HTMLImageElement for *key*, or null if not yet loaded /
 * not found.
 */
export function getTexture(key: string): HTMLImageElement | null {
  return _cache.get(key)?.image ?? null
}

/** Current load state for a single key, or undefined if not yet queued. */
export function getTextureState(key: string): TextureState | undefined {
  return _cache.get(key)?.state
}

/** Counts per state for a specific key list. Unqueued keys count as pending. */
export function getSettledCount(keys: string[]): {
  loaded: number
  missing: number
  pending: number
} {
  let loaded = 0, missing = 0, pending = 0
  for (const key of keys) {
    const e = _cache.get(key)
    if (!e || e.state === 'pending') pending++
    else if (e.state === 'loaded') loaded++
    else missing++
  }
  return { loaded, missing, pending }
}

/** True once every key passed to warmTextures has resolved (loaded or failed). */
export function allSettled(keys: string[]): boolean {
  return keys.every((k) => {
    const e = _cache.get(k)
    return e !== undefined && e.state !== 'pending'
  })
}

/**
 * Pre-load a set of textures.  Already-loading or loaded keys are skipped.
 * *worldPath* is forwarded to the backend texture endpoint.
 */
export function warmTextures(keys: string[], worldPath: string): void {
  for (const key of keys) {
    if (_cache.has(key)) continue

    const entry: Entry = { state: 'pending', image: null }
    _cache.set(key, entry)

    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      entry.state = 'loaded'
      entry.image = img
      _scheduleNotify()
    }
    img.onerror = () => {
      entry.state = 'missing'
      _scheduleNotify()
    }
    img.src =
      `${API_BASE}/worlds/textures` +
      `?key=${encodeURIComponent(key)}` +
      `&world_path=${encodeURIComponent(worldPath)}` +
      `&_v=2`
  }
}
