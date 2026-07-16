import { useEffect, useRef, useState, type MutableRefObject } from 'react'

import type { MapEngine } from '../map/mapEngine'

/** A vein as the label overlay needs it: position + resolved name/colour. */
export interface OreVeinView {
  x: number
  z: number
  name: string
  color: string
  depleted: boolean
  // Icon-name key into the sprites map (the vein's `texture`); used by the map
  // marker, ignored by the label overlay. Absent → flat coloured dot.
  spriteKey?: string
}

interface Props {
  engineRef: MutableRefObject<MapEngine | null>
  veins: OreVeinView[]
}

interface Viewport {
  cx: number
  cz: number
  scale: number
  w: number
  h: number
}

// Show labels only once zoomed in enough that they don't pile up (veins sit on a
// ~48-block grid; at this scale that's comfortably spaced). The dots themselves
// (drawn by the engine) show at every zoom — this is just the text.
const LABEL_MIN_SCALE = 1.5
// Safety cap on labels rendered at once (viewport culling usually keeps it small).
const MAX_LABELS = 150
// Vertical gap (px) that lifts the label just above the ore marker
// (mapEngine VEIN_SPRITE_PX ≈ 44); the label is anchored by its bottom edge.
const LABEL_GAP = 28

/**
 * Ore-vein name labels: a DOM overlay synced to the map camera, mirroring
 * GridLabels. Labels only appear when zoomed in and are culled to the viewport, so
 * only the handful of on-screen veins get a span no matter how many exist.
 */
export function OreVeinLabels({ engineRef, veins }: Props) {
  const [vp, setVp] = useState<Viewport | null>(null)
  const last = useRef<Viewport | null>(null)

  useEffect(() => {
    let raf = 0
    const tick = () => {
      const v = engineRef.current?.getViewport()
      if (v) {
        const p = last.current
        if (
          !p ||
          p.cx !== v.cx ||
          p.cz !== v.cz ||
          p.scale !== v.scale ||
          p.w !== v.w ||
          p.h !== v.h
        ) {
          last.current = v
          setVp(v)
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [engineRef])

  if (!vp || vp.scale < LABEL_MIN_SCALE) return null
  const { cx, cz, scale, w, h } = vp

  const shown: { key: string; sx: number; sy: number; v: OreVeinView }[] = []
  for (let i = 0; i < veins.length; i++) {
    const v = veins[i]
    // +0.5: the engine draws each marker at the block centre (x+0.5, z+0.5); match
    // it so the label sits directly over the sprite, not half a block off.
    const sx = (v.x + 0.5 - cx) * scale + w / 2
    const sy = (v.z + 0.5 - cz) * scale + h / 2
    if (sx < 0 || sx > w || sy < 0 || sy > h) continue // viewport cull
    shown.push({ key: `${v.x},${v.z},${i}`, sx, sy, v })
    if (shown.length >= MAX_LABELS) break
  }

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden font-mono text-[13px]">
      {shown.map((l) => (
        <span
          key={l.key}
          className="absolute whitespace-nowrap px-1 text-white"
          style={{
            left: l.sx,
            top: l.sy - LABEL_GAP,
            // Anchor the box by its bottom-centre so it sits centred above the marker.
            transform: 'translate(-50%, -100%)',
            backgroundColor: 'rgba(0,0,0,0.55)',
            textDecoration: l.v.depleted ? 'line-through' : undefined,
            opacity: l.v.depleted ? 0.6 : 1,
          }}
        >
          {l.v.name}
        </span>
      ))}
    </div>
  )
}
