import { useEffect, useRef, useState, type MutableRefObject } from 'react'

import type { MapEngine } from './mapEngine'

interface Props {
  engineRef: MutableRefObject<MapEngine | null>
}

interface Viewport {
  cx: number
  cz: number
  scale: number
  w: number
  h: number
}

// Label steps aligned to the drawn grid lines: chunk multiples (16) when the
// chunk grid is visible (zoomed in), else region multiples (512). The first step
// giving ~≥70px on-screen spacing is used, so labels stay readable at any zoom.
const CHUNK_STEPS = [16, 32, 64, 128, 256]
const REGION_STEPS = [512, 1024, 2048, 4096, 8192, 16384]

/**
 * Coordinate-ruler overlay (Stage 5): block-X labels along the top edge and
 * block-Z labels down the left edge, sitting on the grid lines. Synced to the map
 * camera, pointer-transparent.
 */
export function GridLabels({ engineRef }: Props) {
  const [vp, setVp] = useState<Viewport | null>(null)
  const last = useRef<Viewport | null>(null)

  // Poll the engine camera each frame; only re-render when it actually changes.
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

  if (!vp) return null
  const { cx, cz, scale, w, h } = vp
  // Chunk grid is drawn at scale ≥ 3 (mapScene.updateGrid); match its lines.
  const steps = scale >= 3 ? CHUNK_STEPS : REGION_STEPS
  const step = steps.find((s) => s * scale >= 70) ?? steps[steps.length - 1]
  const halfW = w / (2 * scale)
  const halfH = h / (2 * scale)

  // Block-X labels at each vertical grid line, block-Z at each horizontal line.
  const xs: { s: number; v: number }[] = []
  for (
    let x = Math.ceil((cx - halfW) / step) * step;
    x <= cx + halfW;
    x += step
  ) {
    const s = (x - cx) * scale + w / 2
    if (s >= 26 && s <= w - 4) xs.push({ s, v: x })
  }
  const zs: { s: number; v: number }[] = []
  for (
    let z = Math.ceil((cz - halfH) / step) * step;
    z <= cz + halfH;
    z += step
  ) {
    const s = (z - cz) * scale + h / 2
    if (s >= 16 && s <= h - 4) zs.push({ s, v: z })
  }

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden font-mono text-[10px] text-zinc-200">
      {xs.map((l) => (
        <span
          key={`x${l.v}`}
          className="absolute top-0 -translate-x-1/2 rounded-b bg-black/55 px-1"
          style={{ left: l.s }}
        >
          {l.v}
        </span>
      ))}
      {zs.map((l) => (
        <span
          key={`z${l.v}`}
          className="absolute left-0 -translate-y-1/2 rounded-r bg-black/55 px-1"
          style={{ top: l.s }}
        >
          {l.v}
        </span>
      ))}
    </div>
  )
}
