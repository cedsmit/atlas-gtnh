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

import { API_BASE } from '../../shared/api'

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
  let loaded = 0,
    missing = 0,
    pending = 0
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

// Keys per batch request. A handful of these replaces hundreds of <img> GETs,
// while still being granular enough to keep the loading progress bar moving.
const BATCH_SIZE = 100

/**
 * Pre-load a set of textures.  Already-loading or loaded keys are skipped.
 * Keys are fetched from the backend in batches (one round-trip per ~100 keys,
 * each JAR opened once server-side) rather than one image request per key.
 */
export function warmTextures(keys: string[], worldPath: string): void {
  const fresh: string[] = []
  for (const key of keys) {
    if (_cache.has(key)) continue
    _cache.set(key, { state: 'pending', image: null })
    fresh.push(key)
  }

  for (let i = 0; i < fresh.length; i += BATCH_SIZE) {
    void _loadBatch(fresh.slice(i, i + BATCH_SIZE), worldPath)
  }
}

/** Fetch one batch of texture keys and decode each returned data-URL. */
async function _loadBatch(keys: string[], worldPath: string): Promise<void> {
  // Retry transient request failures a few times before giving up, so a brief
  // network/backend hiccup doesn't permanently mark these keys 'missing' (the
  // cache never re-requests a settled key). A successful response that simply
  // omits a key is a genuine miss and is NOT retried.
  let data: Record<string, string> | null = null
  for (let attempt = 0; attempt < 3 && data === null; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 250 * attempt))
    try {
      const res = await fetch(`${API_BASE}/worlds/textures-batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ world_path: worldPath, keys }),
      })
      if (res.ok) data = (await res.json()) as Record<string, string>
    } catch {
      // Network error: fall through to retry (or 'missing' after the last try).
    }
  }
  const resolved = data ?? {}

  for (const key of keys) {
    const entry = _cache.get(key)
    if (!entry) continue
    const dataUrl = resolved[key]
    if (!dataUrl) {
      entry.state = 'missing'
      continue
    }
    const img = new Image()
    img.onload = () => {
      entry.state = 'loaded'
      entry.image = img
      _scheduleNotify()
    }
    img.onerror = () => {
      entry.state = 'missing'
      _scheduleNotify()
    }
    img.src = dataUrl
  }
  // Surface the keys marked 'missing' (and any all-miss batch) right away.
  _scheduleNotify()
}
