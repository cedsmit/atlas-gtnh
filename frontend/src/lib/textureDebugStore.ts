import type { ChunkRenderStats } from './chunkTileRenderer'
import { getTextureState, onTextureLoad, type TextureState } from './textureLoader'

export type TexDebugStatus = TextureState | 'no-mapping'
export type TintType = 'grass' | 'foliage' | 'water' | 'none'

export interface DebugBlockEntry {
  id: number
  name: string | undefined
  texKey: string | null
  tintType: TintType
  occurrences: number
}

export interface DebugBlockView extends DebugBlockEntry {
  texStatus: TexDebugStatus
}

export interface RenderTotals {
  chunks: number
  drawImage: number
  fillRect: number
  missingTexKey: number
  failedTexLoad: number
}

class TextureDebugStore {
  private _blocks = new Map<number, DebugBlockEntry>()
  private _subs = new Set<() => void>()
  private _texUnsub: (() => void) | null = null
  private _notifyScheduled = false
  private _renderTotals: RenderTotals = {
    chunks: 0, drawImage: 0, fillRect: 0, missingTexKey: 0, failedTexLoad: 0,
  }

  enable() {
    if (!this._texUnsub) {
      this._texUnsub = onTextureLoad(() => this._scheduleNotify())
    }
  }

  disable() {
    this._texUnsub?.()
    this._texUnsub = null
    this._blocks.clear()
    this._notify()
  }

  record(id: number, name: string | undefined, texKey: string | null, tintType: TintType) {
    const e = this._blocks.get(id)
    if (e) {
      e.occurrences++
    } else {
      this._blocks.set(id, { id, name, texKey, tintType, occurrences: 1 })
      this._scheduleNotify()
    }
  }

  addChunkStats(s: ChunkRenderStats) {
    this._renderTotals.chunks++
    this._renderTotals.drawImage    += s.drawImage
    this._renderTotals.fillRect     += s.fillRect
    this._renderTotals.missingTexKey += s.missingTexKey
    this._renderTotals.failedTexLoad += s.failedTexLoad
    this._scheduleNotify()
  }

  getRenderTotals(): RenderTotals {
    return { ...this._renderTotals }
  }

  clear() {
    this._blocks.clear()
    this._renderTotals = { chunks: 0, drawImage: 0, fillRect: 0, missingTexKey: 0, failedTexLoad: 0 }
    this._notify()
  }

  getAll(): DebugBlockView[] {
    return [...this._blocks.values()].map((b) => ({
      ...b,
      texStatus: b.texKey
        ? ((getTextureState(b.texKey) as TexDebugStatus | undefined) ?? 'pending')
        : 'no-mapping',
    }))
  }

  getStats(): {
    loaded: number
    missing: number
    pending: number
    noMapping: number
    total: number
    /** Occurrence-weighted counts (each block × how many times it appeared). */
    occLoaded: number
    occMissing: number
    occPending: number
    occNoMapping: number
  } {
    let loaded = 0, missing = 0, pending = 0, noMapping = 0
    let occLoaded = 0, occMissing = 0, occPending = 0, occNoMapping = 0
    for (const b of this._blocks.values()) {
      if (!b.texKey) {
        noMapping++
        occNoMapping += b.occurrences
        continue
      }
      const s = getTextureState(b.texKey)
      if (s === 'loaded')       { loaded++;   occLoaded   += b.occurrences }
      else if (s === 'missing') { missing++;  occMissing  += b.occurrences }
      else                      { pending++;  occPending  += b.occurrences }
    }
    return {
      loaded, missing, pending, noMapping,
      total: this._blocks.size,
      occLoaded, occMissing, occPending, occNoMapping,
    }
  }

  subscribe(cb: () => void): () => void {
    this._subs.add(cb)
    return () => this._subs.delete(cb)
  }

  private _scheduleNotify() {
    if (this._notifyScheduled) return
    this._notifyScheduled = true
    queueMicrotask(() => {
      this._notifyScheduled = false
      this._notify()
    })
  }

  private _notify() {
    for (const cb of this._subs) cb()
  }
}

export const textureDebugStore = new TextureDebugStore()
