import { type MouseEvent, type RefObject, useRef, useState } from 'react'

import type { MapEngine } from './mapEngine'

export interface ChunkSelection {
  cx0: number
  cz0: number
  cx1: number
  cz1: number
}

interface DragBox {
  x0: number
  y0: number
  x1: number
  y1: number
}

function selCount(s: ChunkSelection): number {
  return (Math.abs(s.cx1 - s.cx0) + 1) * (Math.abs(s.cz1 - s.cz0) + 1)
}

/**
 * Chunk selection tool overlaid on the map. When active, drag a rectangle to
 * select a range of chunks; the engine draws a persistent world-space highlight.
 * Destructive actions (delete/copy) are added in a later step.
 */
export function ChunkTools({ engineRef }: { engineRef: RefObject<MapEngine | null> }) {
  const [active, setActive] = useState(false)
  const [selection, setSelection] = useState<ChunkSelection | null>(null)
  const [drag, setDrag] = useState<DragBox | null>(null)
  const overlayRef = useRef<HTMLDivElement>(null)

  function relative(e: MouseEvent): { x: number; y: number } {
    const rect = overlayRef.current!.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  function toChunk(x: number, y: number): { cx: number; cz: number } {
    const vp = engineRef.current!.getViewport()
    const worldX = vp.cx + (x - vp.w / 2) / vp.scale
    const worldZ = vp.cz + (y - vp.h / 2) / vp.scale
    return { cx: Math.floor(worldX / 16), cz: Math.floor(worldZ / 16) }
  }

  function onDown(e: MouseEvent) {
    if (!engineRef.current) return
    const { x, y } = relative(e)
    setDrag({ x0: x, y0: y, x1: x, y1: y })
  }
  function onMove(e: MouseEvent) {
    if (!drag) return
    const { x, y } = relative(e)
    setDrag({ ...drag, x1: x, y1: y })
  }
  function onUp() {
    if (!drag || !engineRef.current) {
      setDrag(null)
      return
    }
    const a = toChunk(drag.x0, drag.y0)
    const b = toChunk(drag.x1, drag.y1)
    const sel: ChunkSelection = { cx0: a.cx, cz0: a.cz, cx1: b.cx, cz1: b.cz }
    setSelection(sel)
    engineRef.current.setSelection(sel)
    setDrag(null)
  }

  function clearSelection() {
    setSelection(null)
    engineRef.current?.setSelection(null)
  }

  function toggle() {
    setActive((prev) => {
      if (prev) clearSelection() // leaving select mode clears the highlight
      return !prev
    })
  }

  const box = drag
    ? {
        left: Math.min(drag.x0, drag.x1),
        top: Math.min(drag.y0, drag.y1),
        width: Math.abs(drag.x1 - drag.x0),
        height: Math.abs(drag.y1 - drag.y0),
      }
    : null

  return (
    <>
      {active && (
        <div
          ref={overlayRef}
          onMouseDown={onDown}
          onMouseMove={onMove}
          onMouseUp={onUp}
          onMouseLeave={onUp}
          className="absolute inset-0 z-10 cursor-crosshair"
        >
          {box && (
            <div
              className="absolute border-2 border-sky-400 bg-sky-400/20"
              style={box}
            />
          )}
        </div>
      )}

      <div className="absolute left-2 top-2 z-20 flex flex-col gap-1 rounded bg-black/70 p-2 font-mono text-xs text-zinc-200">
        <button
          onClick={toggle}
          className={`rounded px-2 py-1 ${
            active ? 'bg-sky-600 text-white' : 'bg-zinc-700 text-zinc-200 hover:bg-zinc-600'
          }`}
        >
          {active ? '◉ Selecting chunks' : '▢ Select chunks'}
        </button>
        {active && selection && (
          <div className="flex flex-col gap-1">
            <span>
              ({Math.min(selection.cx0, selection.cx1)}, {Math.min(selection.cz0, selection.cz1)}) –
              ({Math.max(selection.cx0, selection.cx1)}, {Math.max(selection.cz0, selection.cz1)})
            </span>
            <span className="text-zinc-400">{selCount(selection)} chunks selected</span>
            <button
              onClick={clearSelection}
              className="rounded bg-zinc-700 px-2 py-1 text-zinc-200 hover:bg-zinc-600"
            >
              Clear
            </button>
          </div>
        )}
        {active && !selection && <span className="text-zinc-400">drag to select</span>}
      </div>
    </>
  )
}
