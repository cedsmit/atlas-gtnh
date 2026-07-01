import { Palette } from 'lucide-react'

import type { TextureFilter } from '../blocks/renderPresets'

// Debug-mode overlay describing the active texture-filter pipeline.
export function FilterPipelineInfo({ filter }: { filter: TextureFilter }) {
  const isJM     = filter === 'journeymap'
  const isPixel  = filter === 'pixel'
  const canvasSize  = isJM ? '256×256 → 512×512' : '256×256'
  const magFilter   = isPixel ? 'NearestFilter'  : 'LinearFilter'
  const minFilter   = isPixel ? 'NearestMipMapLinear' : 'LinearMipMapLinear'
  const smoothing   = isJM   ? 'true (upscale ctx)' : 'false'
  const upscaled    = isJM   ? 'yes — 2× bilinear' : 'no'
  return (
    <div className="pointer-events-none absolute bottom-2 right-2 rounded border border-zinc-700 bg-black/80 px-2 py-1.5 font-mono text-[10px] text-zinc-300">
      <div className="mb-0.5 inline-flex items-center gap-1 font-semibold text-zinc-200">
        <Palette className="h-3.5 w-3.5" aria-hidden />
        Filter pipeline: {filter}
      </div>
      <table className="border-separate" style={{ borderSpacing: '0 1px' }}>
        <tbody>
          <Row label="canvas"    value={canvasSize} />
          <Row label="upscaled"  value={upscaled}   highlight={isJM} />
          <Row label="magFilter" value={magFilter}  />
          <Row label="minFilter" value={minFilter}  />
          <Row label="mipmaps"   value="true"       />
          <Row label="smoothing" value={smoothing}  highlight={isJM} />
        </tbody>
      </table>
    </div>
  )
}

function Row({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  return (
    <tr>
      <td className="pr-3 text-zinc-500">{label}</td>
      <td className={highlight ? 'text-cyan-300' : 'text-zinc-200'}>{value}</td>
    </tr>
  )
}
