import { type RefObject, useEffect, useRef, useState } from 'react'

import type { MapEngine } from '../map/mapEngine'
import {
  type BrushMode,
  boxChunks,
  chunkLine,
  type ChunkOps,
} from './useChunkOps'

interface Box {
  x0: number
  y0: number
  x1: number
  y1: number
}

/**
 * What the button that went down is doing:
 *
 *  - `box` — the marquee, from a plain drag (and the paste mode's click test);
 *  - `paint` — a modifier is held, so chunks are brushed in or out one at a
 *    time along the pointer's path.
 */
type Gesture =
  | ({ kind: 'box' } & Box)
  | { kind: 'paint'; brush: BrushMode; last: [number, number] }

/** Which brush a modifier asks for, or null for the plain marquee. */
function brushFor(e: globalThis.MouseEvent): BrushMode | null {
  if (e.shiftKey) return 'add'
  if (e.altKey) return 'subtract'
  return null
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
 * The layer never covers the map. It listens on the container instead and takes
 * the left button only, leaving every other button to the map underneath —
 * middle-drag still pans, right-click still inspects, in both modes. Covering
 * the canvas (as select mode used to) swallows all three, which left no way to
 * pan to the chunks you wanted to select.
 *
 * The left button then splits by mode: select claims it, because a drag has to
 * draw a box rather than pan; paste lets it through and places the anchor from
 * the mouseup, but only when the pointer barely moved — i.e. on a click rather
 * than at the end of a pan.
 *
 * In select mode a plain drag is a marquee that replaces the selection, and
 * holding shift (add) or alt (remove) turns the pointer into a brush that
 * paints chunk by chunk — which is how an irregular shape, like the footprint
 * of a base, gets selected at all.
 */
export function ChunkOpsLayer({
  ops,
  engineRef,
}: {
  ops: ChunkOps
  engineRef: RefObject<MapEngine | null>
}) {
  const [box, setBox] = useState<Box | null>(null)
  // The live gesture, mirrored into state only for drawing. Kept in a ref
  // because the listeners below are registered once but `ops` is a fresh object
  // every render, so the effect can re-run mid-drag.
  const dragRef = useRef<Gesture | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const pasting = ops.mode === 'paste'

  useEffect(() => {
    const host = ref.current?.parentElement
    if (!host) return

    const onDown = (e: globalThis.MouseEvent) => {
      if (e.button !== 0 || ops.busy) return
      // Only presses on the map canvas. The same container also holds the HUD,
      // the context menu and the banners; claiming one of those would swallow
      // the button's own handler and start a selection nobody asked for.
      if (!(e.target instanceof HTMLCanvasElement)) return
      const eng = engineRef.current
      if (!eng) return
      const p = localPoint(host, e.clientX, e.clientY)
      const brush = pasting ? null : brushFor(e)

      if (brush) {
        const c = chunkAt(eng, p.x, p.y)
        dragRef.current = { kind: 'paint', brush, last: [c.cx, c.cz] }
        ops.paint([[c.cx, c.cz]], brush)
      } else {
        const started: Gesture = {
          kind: 'box',
          x0: p.x,
          y0: p.y,
          x1: p.x,
          y1: p.y,
        }
        dragRef.current = started
        if (!pasting) setBox(started)
      }
      // Capture phase, so stopping the event here beats the map's own mousedown
      // on the canvas below: in select mode the drag must draw or paint, not
      // pan. Paste mode wants the pan, and reads the click off the mouseup.
      if (!pasting) e.stopPropagation()
    }

    const onMove = (e: globalThis.MouseEvent) => {
      const g = dragRef.current
      const eng = engineRef.current
      if (!g || pasting || !eng) return
      const p = localPoint(host, e.clientX, e.clientY)
      if (g.kind === 'paint') {
        const c = chunkAt(eng, p.x, p.y)
        const step = chunkLine(g.last, [c.cx, c.cz])
        if (step.length === 0) return
        g.last = [c.cx, c.cz]
        ops.paint(step, g.brush)
      } else {
        const moved = { ...g, x1: p.x, y1: p.y }
        dragRef.current = moved
        setBox(moved)
      }
    }

    const onUp = (e: globalThis.MouseEvent) => {
      const g = dragRef.current
      dragRef.current = null
      setBox(null)
      const eng = engineRef.current
      if (!g || !eng || ops.busy || g.kind === 'paint') return
      const p = localPoint(host, e.clientX, e.clientY)
      if (pasting) {
        if (Math.hypot(p.x - g.x0, p.y - g.y0) > CLICK_SLOP) return
        const c = chunkAt(eng, p.x, p.y)
        ops.placeAnchor(c.cx, c.cz)
      } else {
        const a = chunkAt(eng, g.x0, g.y0)
        const b = chunkAt(eng, p.x, p.y)
        ops.paint(boxChunks([a.cx, a.cz], [b.cx, b.cz]), 'replace')
      }
    }

    host.addEventListener('mousedown', onDown, true)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      host.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [pasting, ops, engineRef])

  // The crosshair belongs to the map's own canvas now that this layer doesn't
  // cover it — a pointer-events-none element can't set the cursor.
  useEffect(() => {
    const eng = engineRef.current
    if (!eng || pasting) return
    eng.setCursor('crosshair')
    return () => eng.setCursor(null)
  }, [pasting, engineRef])

  const rect = box && {
    left: Math.min(box.x0, box.x1),
    top: Math.min(box.y0, box.y1),
    width: Math.abs(box.x1 - box.x0),
    height: Math.abs(box.y1 - box.y0),
  }

  return (
    <div ref={ref} className="pointer-events-none absolute inset-0 z-10">
      {rect && (
        <div
          className="absolute border-2 border-atlas-accent bg-atlas-accent/20"
          style={rect}
        />
      )}
    </div>
  )
}
