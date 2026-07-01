import { type MouseEvent, type RefObject, useRef, useState } from 'react'

import type { MapEngine } from '../map/mapEngine'
import { deleteChunks, deleteChunksExcept } from './api/chunkOps'

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

function expand(s: ChunkSelection): [number, number][] {
  const x0 = Math.min(s.cx0, s.cx1),
    x1 = Math.max(s.cx0, s.cx1)
  const z0 = Math.min(s.cz0, s.cz1),
    z1 = Math.max(s.cz0, s.cz1)
  const out: [number, number][] = []
  for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) out.push([x, z])
  return out
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e))

/**
 * Chunk selection + save operations overlaid on the map. Drag a rectangle to
 * select chunks (the engine draws a persistent highlight), then delete them for
 * regeneration. Writes to the save, so the world must be closed in Minecraft.
 */
export function ChunkTools({
  engineRef,
  dimensionPath,
}: {
  engineRef: RefObject<MapEngine | null>
  dimensionPath: string
}) {
  const [active, setActive] = useState(false)
  const [selection, setSelection] = useState<ChunkSelection | null>(null)
  const [drag, setDrag] = useState<DragBox | null>(null)
  const [confirming, setConfirming] = useState<'delete' | null>(null)
  const [invert, setInvert] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<string | null>(null)
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
    if (!engineRef.current || busy) return
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
    setResult(null)
    setConfirming(null)
    setDrag(null)
  }

  function clearSelection() {
    setSelection(null)
    setConfirming(null)
    engineRef.current?.setSelection(null)
  }

  function toggle() {
    setActive((prev) => {
      if (prev) clearSelection()
      setResult(null)
      return !prev
    })
  }

  async function runDelete() {
    if (!selection) return
    const chunks = expand(selection)
    setBusy(true)
    setResult(null)
    try {
      if (invert) {
        const r = await deleteChunksExcept(dimensionPath, chunks)
        engineRef.current?.refreshView() // whole map changed — refresh everything
        setResult(
          `Deleted ${r.deleted ?? 0} chunk(s), kept ${r.kept ?? chunks.length}. ` +
            'Reload the world in Minecraft to regenerate them.',
        )
      } else {
        const r = await deleteChunks(dimensionPath, chunks)
        engineRef.current?.invalidateChunks(chunks) // live-refresh; no reload needed
        setResult(
          `Deleted ${r.deleted ?? 0} chunk(s)` +
            (r.missing ? `, ${r.missing} already empty` : '') +
            '. Reload the world in Minecraft to regenerate them.',
        )
      }
      clearSelection()
    } catch (e) {
      setResult(`Error: ${errMsg(e)}`)
    } finally {
      setBusy(false)
      setConfirming(null)
    }
  }

  const box = drag
    ? {
        left: Math.min(drag.x0, drag.x1),
        top: Math.min(drag.y0, drag.y1),
        width: Math.abs(drag.x1 - drag.x0),
        height: Math.abs(drag.y1 - drag.y0),
      }
    : null

  const count = selection ? selCount(selection) : 0

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
          {box && <div className="absolute border-2 border-sky-400 bg-sky-400/20" style={box} />}
        </div>
      )}

      <div className="absolute left-2 top-2 z-20 flex w-64 flex-col gap-1 rounded bg-black/70 p-2 font-mono text-xs text-zinc-200">
        <button
          onClick={toggle}
          className={`rounded px-2 py-1 ${
            active ? 'bg-sky-600 text-white' : 'bg-zinc-700 text-zinc-200 hover:bg-zinc-600'
          }`}
        >
          {active ? '◉ Selecting chunks' : '▢ Select chunks'}
        </button>

        {active && !selection && <span className="text-zinc-400">drag to select</span>}

        {active && selection && (
          <div className="flex flex-col gap-1">
            <span>
              ({Math.min(selection.cx0, selection.cx1)}, {Math.min(selection.cz0, selection.cz1)}) – (
              {Math.max(selection.cx0, selection.cx1)}, {Math.max(selection.cz0, selection.cz1)})
            </span>
            <span className="text-zinc-400">{count} chunks selected</span>

            <label className="flex items-center gap-1 text-zinc-300">
              <input
                type="checkbox"
                checked={invert}
                onChange={(e) => {
                  setInvert(e.target.checked)
                  setConfirming(null)
                }}
                disabled={busy}
              />
              Invert (keep selection, delete the rest)
            </label>

            {confirming === 'delete' ? (
              <div className="flex flex-col gap-1 rounded border border-red-700 bg-red-950/60 p-2">
                <span className="text-red-300">
                  {invert
                    ? `Delete the ENTIRE dimension EXCEPT these ${count} chunk(s)?`
                    : `Delete ${count} chunk(s) for regeneration?`}
                </span>
                <span className="text-amber-300">
                  ⚠ Close Minecraft first — writing a loaded save corrupts it. A .bak is kept; MC
                  regenerates the deleted chunks on next load.
                </span>
                {invert && (
                  <span className="text-red-400">
                    This wipes everything outside your selection — double-check it covers your base.
                  </span>
                )}
                <div className="flex gap-1">
                  <button
                    onClick={runDelete}
                    disabled={busy}
                    className="flex-1 rounded bg-red-700 px-2 py-1 text-white hover:bg-red-600 disabled:opacity-50"
                  >
                    {busy ? 'Working…' : invert ? 'Delete the rest' : 'Delete'}
                  </button>
                  <button
                    onClick={() => setConfirming(null)}
                    disabled={busy}
                    className="flex-1 rounded bg-zinc-700 px-2 py-1 hover:bg-zinc-600 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex gap-1">
                <button
                  onClick={() => setConfirming('delete')}
                  disabled={busy}
                  className="flex-1 rounded bg-red-800 px-2 py-1 text-red-100 hover:bg-red-700 disabled:opacity-50"
                >
                  {invert ? 'Delete all EXCEPT selection' : 'Delete → regenerate'}
                </button>
                <button
                  onClick={clearSelection}
                  disabled={busy}
                  className="rounded bg-zinc-700 px-2 py-1 hover:bg-zinc-600 disabled:opacity-50"
                >
                  Clear
                </button>
              </div>
            )}
          </div>
        )}

        {result && (
          <span className={result.startsWith('Error') ? 'text-red-300' : 'text-emerald-300'}>
            {result}
          </span>
        )}
      </div>
    </>
  )
}
