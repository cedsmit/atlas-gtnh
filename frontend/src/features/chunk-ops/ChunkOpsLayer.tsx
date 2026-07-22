import { type MouseEvent, type RefObject, useRef, useState } from 'react'

import type { MapEngine } from '../map/mapEngine'
import type { ChunkOps } from './useChunkOps'

interface Box {
  x0: number
  y0: number
  x1: number
  y1: number
}

/**
 * The map half of the chunk tools: drag a box to select, or click to place the
 * paste anchor. Purely input — every result goes to the panel through `ops`, so
 * the map surface itself stays free of controls.
 *
 * Only mounted while the panel is open, which is what keeps the map clear the
 * rest of the time.
 */
export function ChunkOpsLayer({
  ops,
  engineRef,
}: {
  ops: ChunkOps
  engineRef: RefObject<MapEngine | null>
}) {
  const [drag, setDrag] = useState<Box | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  function at(e: MouseEvent) {
    const r = ref.current!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  function toChunk(x: number, y: number) {
    const vp = engineRef.current!.getViewport()
    return {
      cx: Math.floor((vp.cx + (x - vp.w / 2) / vp.scale) / 16),
      cz: Math.floor((vp.cz + (y - vp.h / 2) / vp.scale) / 16),
    }
  }

  function onDown(e: MouseEvent) {
    if (!engineRef.current || ops.busy) return
    if (ops.mode === 'paste') {
      const { x, y } = at(e)
      const c = toChunk(x, y)
      ops.placeAnchor(c.cx, c.cz)
      return
    }
    const { x, y } = at(e)
    setDrag({ x0: x, y0: y, x1: x, y1: y })
  }

  function onMove(e: MouseEvent) {
    if (!drag) return
    const { x, y } = at(e)
    setDrag({ ...drag, x1: x, y1: y })
  }

  function onUp() {
    if (!drag || !engineRef.current) return setDrag(null)
    const a = toChunk(drag.x0, drag.y0)
    const b = toChunk(drag.x1, drag.y1)
    ops.selectBox({ cx0: a.cx, cz0: a.cz, cx1: b.cx, cz1: b.cz })
    setDrag(null)
  }

  const box = drag && {
    left: Math.min(drag.x0, drag.x1),
    top: Math.min(drag.y0, drag.y1),
    width: Math.abs(drag.x1 - drag.x0),
    height: Math.abs(drag.y1 - drag.y0),
  }

  return (
    <div
      ref={ref}
      onMouseDown={onDown}
      onMouseMove={onMove}
      onMouseUp={onUp}
      onMouseLeave={onUp}
      className={`absolute inset-0 z-10 ${
        ops.mode === 'paste' ? 'cursor-copy' : 'cursor-crosshair'
      }`}
    >
      {box && (
        <div
          className="absolute border-2 border-atlas-accent bg-atlas-accent/20"
          style={box}
        />
      )}
    </div>
  )
}
