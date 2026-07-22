import {
  type MouseEvent,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from 'react'

import type { MapEngine } from '../map/mapEngine'
import type { ChunkOps } from './useChunkOps'

interface Box {
  x0: number
  y0: number
  x1: number
  y1: number
}

/** Movement past this (px) is a pan, not a click. */
const CLICK_SLOP = 4

/** Client point → coordinates within `el`. */
function localPoint(el: HTMLElement, clientX: number, clientY: number) {
  const r = el.getBoundingClientRect()
  return { x: clientX - r.left, y: clientY - r.top }
}

/** Viewport point → the chunk under it. */
function chunkAt(eng: MapEngine, x: number, y: number) {
  const vp = eng.getViewport()
  return {
    cx: Math.floor((vp.cx + (x - vp.w / 2) / vp.scale) / 16),
    cz: Math.floor((vp.cz + (y - vp.h / 2) / vp.scale) / 16),
  }
}

/**
 * The map half of the chunk tools: drag a box to select, or click to place the
 * paste anchor. Purely input — every result goes to the panel through `ops`, so
 * the map surface itself stays free of controls. Only mounted while the panel is
 * open, which is what keeps the map clear the rest of the time.
 *
 * The two modes take opposite approaches to the mouse, because they want
 * opposite things from a drag:
 *
 *  - select intercepts, since dragging must draw a box rather than pan;
 *  - paste is pointer-events-none so the map still pans normally, and the
 *    anchor is placed from a listener on the container that fires only when the
 *    pointer barely moved — i.e. a click rather than the end of a drag.
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
  const pasting = ops.mode === 'paste'

  // Paste mode: watch the container instead of covering it, so panning is
  // untouched and only a genuine click moves the anchor.
  useEffect(() => {
    if (!pasting) return
    const host = ref.current?.parentElement
    if (!host) return

    let downAt: { x: number; y: number } | null = null
    const onDown = (e: globalThis.MouseEvent) => {
      if (e.button !== 0) return
      downAt = { x: e.clientX, y: e.clientY }
    }
    const onUp = (e: globalThis.MouseEvent) => {
      const from = downAt
      downAt = null
      const eng = engineRef.current
      if (!from || ops.busy || !eng) return
      if (Math.hypot(e.clientX - from.x, e.clientY - from.y) > CLICK_SLOP)
        return
      const { x, y } = localPoint(host, e.clientX, e.clientY)
      const c = chunkAt(eng, x, y)
      ops.placeAnchor(c.cx, c.cz)
    }

    host.addEventListener('mousedown', onDown)
    window.addEventListener('mouseup', onUp)
    return () => {
      host.removeEventListener('mousedown', onDown)
      window.removeEventListener('mouseup', onUp)
    }
  }, [pasting, ops, engineRef])

  // ── Select mode: intercept, so a drag draws a box ──
  function onDown(e: MouseEvent) {
    if (pasting || !engineRef.current || !ref.current || ops.busy) return
    const { x, y } = localPoint(ref.current, e.clientX, e.clientY)
    setDrag({ x0: x, y0: y, x1: x, y1: y })
  }
  function onMove(e: MouseEvent) {
    if (!drag || !ref.current) return
    const { x, y } = localPoint(ref.current, e.clientX, e.clientY)
    setDrag({ ...drag, x1: x, y1: y })
  }
  function onUp() {
    const eng = engineRef.current
    if (!drag || !eng) return setDrag(null)
    const a = chunkAt(eng, drag.x0, drag.y0)
    const b = chunkAt(eng, drag.x1, drag.y1)
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
        pasting ? 'pointer-events-none' : 'cursor-crosshair'
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
