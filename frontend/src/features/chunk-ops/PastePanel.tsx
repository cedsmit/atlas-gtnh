import { open } from '@tauri-apps/plugin-dialog'
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ClipboardPaste,
  FolderPlus,
  Loader2,
  TriangleAlert,
  X,
} from 'lucide-react'
import { type MouseEvent, type RefObject, useEffect, useState } from 'react'

import type { MapEngine } from '../map/mapEngine'
import { copyChunks, createWorld } from './api/chunkOps'
import type { ChunkClipboard } from './chunkClipboard'

const base = (p: string) => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? p
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e))

/**
 * Paste the clipboard into the currently-viewed world: click the map to place
 * the anchor, nudge with the arrows, then paste into this world or a new one.
 * Renders a full-map click overlay plus its own top-left panel.
 */
export function PastePanel({
  clip,
  destDim,
  engineRef,
  onClose,
}: {
  clip: ChunkClipboard
  destDim: string
  engineRef: RefObject<MapEngine | null>
  onClose: () => void
}) {
  const w = clip.bounds.cx1 - clip.bounds.cx0 + 1
  const h = clip.bounds.cz1 - clip.bounds.cz0 + 1
  const [anchor, setAnchor] = useState({ cx: clip.bounds.cx0, cz: clip.bounds.cz0 })
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<string | null>(null)

  const dx = anchor.cx - clip.bounds.cx0
  const dz = anchor.cz - clip.bounds.cz0
  const offset: [number, number] = [dx, dz]
  const destChunks = (): [number, number][] =>
    clip.chunks.map(([cx, cz]) => [cx + dx, cz + dz] as [number, number])

  // Draw / move the green preview; clear it when leaving paste mode.
  useEffect(() => {
    const eng = engineRef.current
    eng?.setPreview({
      cx0: anchor.cx,
      cz0: anchor.cz,
      cx1: anchor.cx + w - 1,
      cz1: anchor.cz + h - 1,
    })
    return () => eng?.setPreview(null)
  }, [anchor, w, h, engineRef])

  function placeAt(e: MouseEvent) {
    const eng = engineRef.current
    if (!eng || busy) return
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const vp = eng.getViewport()
    const worldX = vp.cx + (e.clientX - rect.left - vp.w / 2) / vp.scale
    const worldZ = vp.cz + (e.clientY - rect.top - vp.h / 2) / vp.scale
    setAnchor({ cx: Math.floor(worldX / 16), cz: Math.floor(worldZ / 16) })
    setResult(null)
  }

  const nudge = (ddx: number, ddz: number) => () =>
    setAnchor((a) => ({ cx: a.cx + ddx, cz: a.cz + ddz }))

  async function pasteHere() {
    setBusy(true)
    setResult(null)
    try {
      const r = await copyChunks(clip.srcDim, destDim, clip.chunks, offset)
      engineRef.current?.invalidateChunks(destChunks())
      setResult(`Pasted ${r.copied ?? 0} chunk(s)` + (r.missing ? `, ${r.missing} missing` : '') + '.')
    } catch (e) {
      setResult(`Error: ${errMsg(e)}`)
    } finally {
      setBusy(false)
    }
  }

  async function pasteNewWorld() {
    const picked = await open({ directory: true, multiple: false })
    if (typeof picked !== 'string') return
    setBusy(true)
    setResult(null)
    try {
      const r = await createWorld(clip.srcDim, picked, clip.chunks, offset)
      setResult(`Created ${base(picked)} with ${r.copied ?? 0} chunk(s).`)
    } catch (e) {
      setResult(`Error: ${errMsg(e)}`)
    } finally {
      setBusy(false)
    }
  }

  const nudgeBtn = 'rounded bg-zinc-700 p-1 hover:bg-zinc-600 disabled:opacity-50'

  return (
    <>
      <div onMouseDown={placeAt} className="absolute inset-0 z-10 cursor-copy" />

      <div className="absolute left-2 top-2 z-20 flex w-64 flex-col gap-1 rounded border border-emerald-800 bg-black/80 p-2 font-mono text-xs text-zinc-200">
        <span className="inline-flex items-center gap-1 text-emerald-200">
          <ClipboardPaste className="h-4 w-4 shrink-0" aria-hidden />
          Paste {clip.chunks.length} chunk(s) from {base(clip.srcWorld)}
        </span>
        <span className="text-zinc-400">
          click the map to place · offset ({dx}, {dz})
        </span>

        <div className="flex items-center justify-center gap-1 py-1">
          <button onClick={nudge(-1, 0)} disabled={busy} className={nudgeBtn} aria-label="Nudge west">
            <ArrowLeft className="h-4 w-4" aria-hidden />
          </button>
          <div className="flex flex-col gap-1">
            <button onClick={nudge(0, -1)} disabled={busy} className={nudgeBtn} aria-label="Nudge north">
              <ArrowUp className="h-4 w-4" aria-hidden />
            </button>
            <button onClick={nudge(0, 1)} disabled={busy} className={nudgeBtn} aria-label="Nudge south">
              <ArrowDown className="h-4 w-4" aria-hidden />
            </button>
          </div>
          <button onClick={nudge(1, 0)} disabled={busy} className={nudgeBtn} aria-label="Nudge east">
            <ArrowRight className="h-4 w-4" aria-hidden />
          </button>
        </div>

        <span className="inline-flex items-center gap-1 text-amber-300">
          <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden />
          Same modpack version, and the destination world must be closed in Minecraft.
        </span>

        <button
          onClick={pasteHere}
          disabled={busy}
          className="inline-flex items-center justify-center gap-1 rounded bg-emerald-700 px-2 py-1 text-white hover:bg-emerald-600 disabled:opacity-50"
        >
          {busy ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <ClipboardPaste className="h-3.5 w-3.5" aria-hidden />
          )}
          Paste here
        </button>
        <div className="flex gap-1">
          <button
            onClick={pasteNewWorld}
            disabled={busy}
            className="inline-flex flex-1 items-center justify-center gap-1 rounded bg-sky-800 px-2 py-1 text-sky-100 hover:bg-sky-700 disabled:opacity-50"
          >
            <FolderPlus className="h-3.5 w-3.5" aria-hidden />
            New world…
          </button>
          <button
            onClick={onClose}
            disabled={busy}
            className="inline-flex items-center justify-center gap-1 rounded bg-zinc-700 px-2 py-1 hover:bg-zinc-600 disabled:opacity-50"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
            Close
          </button>
        </div>
        {result && (
          <span className={result.startsWith('Error') ? 'text-red-300' : 'text-emerald-300'}>
            {result}
          </span>
        )}
      </div>
    </>
  )
}
