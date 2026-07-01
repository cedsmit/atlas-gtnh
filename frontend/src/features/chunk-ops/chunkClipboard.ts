import { useSyncExternalStore } from 'react'

/** A copied set of chunks, held in memory so it survives switching worlds. */
export interface ChunkClipboard {
  srcDim: string // source dimension path (read from here at paste time)
  srcWorld: string // source world root (for display)
  chunks: [number, number][] // source chunk coords
  bounds: { cx0: number; cz0: number; cx1: number; cz1: number } // normalized min/max
}

let clip: ChunkClipboard | null = null
const subscribers = new Set<() => void>()

export function setClipboard(next: ChunkClipboard | null): void {
  clip = next
  for (const cb of subscribers) cb()
}

export function getClipboard(): ChunkClipboard | null {
  return clip
}

/** React hook: re-renders when the clipboard changes. */
export function useClipboard(): ChunkClipboard | null {
  return useSyncExternalStore(
    (cb) => {
      subscribers.add(cb)
      return () => subscribers.delete(cb)
    },
    () => clip,
  )
}
