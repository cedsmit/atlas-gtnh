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
  private _subs = new Set<() => void>()
  private _version = 0
  private _scheduled = false

  /** Record one column whose top block is `id`. Called once per chunk render. */
  record(id: number) {
    this._counts.set(id, (this._counts.get(id) ?? 0) + 1)
    this._schedule()
  }

  count(id: number): number {
    return this._counts.get(id) ?? 0
  }

  /** Drop all counts (call when switching worlds). */
  reset() {
    if (this._counts.size === 0) return
    this._counts.clear()
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
