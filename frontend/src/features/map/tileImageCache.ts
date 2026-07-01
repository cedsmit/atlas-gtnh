/**
 * Bounded LRU cache of rendered chunk-tile images, held in CPU memory.
 *
 * When a tile scrolls out of view its GPU texture is disposed to free VRAM, but
 * its rendered pixels are demoted here as an `ImageBitmap`.  Coming back into
 * view is then a cheap GPU re-upload instead of a network fetch + canvas
 * re-render.
 *
 * Ownership is transferred, never shared: `take()` removes the entry and hands
 * the bitmap to the caller (which then owns it as a live GPU texture); the
 * caller `put()`s a fresh bitmap back when the tile is evicted again.  Because a
 * live tile is never simultaneously in the cache, LRU/stale eviction can always
 * safely `close()` the bitmaps it drops.
 *
 * Each entry carries the render version it was produced at; `take()` rejects (and
 * closes) entries whose version no longer matches the current look (preset,
 * colour map, loaded textures, icon dump).
 */

interface Entry {
  bitmap: ImageBitmap
  version: number
}

export class TileImageCache {
  private map = new Map<string, Entry>()

  constructor(private readonly maxEntries: number) {}

  /**
   * Remove and return the cached bitmap for *key* if present and still valid for
   * *version*.  Ownership passes to the caller.  Stale entries are closed and
   * dropped; returns null on miss or version mismatch.
   */
  take(key: string, version: number): ImageBitmap | null {
    const e = this.map.get(key)
    if (!e) return null
    this.map.delete(key)
    if (e.version !== version) {
      e.bitmap.close()
      return null
    }
    return e.bitmap
  }

  /** Insert (taking ownership of *bitmap*), evicting least-recently-used entries. */
  put(key: string, bitmap: ImageBitmap, version: number): void {
    const prev = this.map.get(key)
    if (prev) {
      prev.bitmap.close()
      this.map.delete(key)
    }
    this.map.set(key, { bitmap, version })
    while (this.map.size > this.maxEntries) {
      const oldest = this.map.keys().next().value
      if (oldest === undefined) break
      this.map.get(oldest)!.bitmap.close()
      this.map.delete(oldest)
    }
  }

  /** Close and drop a single entry if present (e.g. after the chunk was edited). */
  delete(key: string): void {
    const e = this.map.get(key)
    if (e) {
      e.bitmap.close()
      this.map.delete(key)
    }
  }

  /** Close and drop every entry. */
  clear(): void {
    for (const e of this.map.values()) e.bitmap.close()
    this.map.clear()
  }

  get size(): number {
    return this.map.size
  }
}
