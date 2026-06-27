/**
 * Always-on tally of how many map columns each block id is the *top* (rendered)
 * block of. Populated once per chunk as chunks render, independent of debug mode,
 * and reset when the world changes.
 *
 * Used by the dump-mismatch banner to rank missing blocks by visible impact — so
 * a block actually covering the map (e.g. ProjectRed stone) is surfaced above
 * technical blocks that never appear (fakeAir, light nodes, TESR chests).
 */
class ColumnTally {
  private _counts = new Map<number, number>()
  private _metas = new Map<number, Set<number>>()
  private _subs = new Set<() => void>()
  private _version = 0
  private _scheduled = false

  /** Record one column whose top block is `id` (with metadata `meta`). */
  record(id: number, meta: number) {
    this._counts.set(id, (this._counts.get(id) ?? 0) + 1)
    let ms = this._metas.get(id)
    if (!ms) { ms = new Set(); this._metas.set(id, ms) }
    ms.add(meta)
    this._schedule()
  }

  count(id: number): number {
    return this._counts.get(id) ?? 0
  }

  /** Plain-object snapshot for the missing-block report export. */
  snapshot(): { occurrences: Record<number, number>; metas: Record<number, number[]> } {
    const occurrences: Record<number, number> = {}
    const metas: Record<number, number[]> = {}
    for (const [id, n] of this._counts) occurrences[id] = n
    for (const [id, set] of this._metas) metas[id] = [...set].sort((a, b) => a - b)
    return { occurrences, metas }
  }

  /** Drop all counts (call when switching worlds). */
  reset() {
    if (this._counts.size === 0 && this._metas.size === 0) return
    this._counts.clear()
    this._metas.clear()
    this._version++
    this._notify()
  }

  // ── useSyncExternalStore plumbing ──
  subscribe = (cb: () => void): (() => void) => {
    this._subs.add(cb)
    return () => this._subs.delete(cb)
  }

  getVersion = (): number => this._version

  private _schedule() {
    if (this._scheduled) return
    this._scheduled = true
    queueMicrotask(() => {
      this._scheduled = false
      this._version++
      this._notify()
    })
  }

  private _notify() {
    for (const cb of this._subs) cb()
  }
}

export const columnTally = new ColumnTally()
