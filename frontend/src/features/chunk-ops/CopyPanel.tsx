import { open } from '@tauri-apps/plugin-dialog'
import { type RefObject, useState } from 'react'

import type { MapEngine } from '../map/mapEngine'
import { copyChunks } from './api/chunkOps'

const base = (p: string) => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? p
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** The dimension's path relative to its world root ("" for the overworld, "DIM-1", …). */
function dimSubpath(dim: string, world: string): string {
  if (dim === world) return ''
  return dim.slice(world.length).replace(/^[\\/]+/, '')
}

/**
 * Copy the selected chunks into another existing world (same coordinates). The
 * destination dimension mirrors the source's (overworld→overworld, DIMx→DIMx).
 */
export function CopyPanel({
  chunks,
  srcDim,
  srcWorld,
  engineRef,
  onClose,
}: {
  chunks: [number, number][]
  srcDim: string
  srcWorld: string
  engineRef: RefObject<MapEngine | null>
  onClose: () => void
}) {
  const [dest, setDest] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<string | null>(null)

  async function pickDest() {
    const picked = await open({ directory: true, multiple: false })
    if (typeof picked === 'string') {
      setDest(picked)
      setResult(null)
    }
  }

  async function runCopy() {
    if (!dest) return
    setBusy(true)
    setResult(null)
    try {
      const sub = dimSubpath(srcDim, srcWorld)
      const destDim = sub ? `${dest}/${sub}` : dest
      const r = await copyChunks(srcDim, destDim, chunks)
      if (dest === srcWorld) engineRef.current?.refreshView() // copied into the viewed world
      setResult(
        `Copied ${r.copied ?? 0} chunk(s)` +
          (r.missing ? `, ${r.missing} missing` : '') +
          ` to ${base(dest)}.`,
      )
    } catch (e) {
      setResult(`Error: ${errMsg(e)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-1 rounded border border-sky-800 bg-sky-950/50 p-2">
      <span className="text-sky-200">Copy {chunks.length} chunk(s) to another world</span>
      <button
        onClick={pickDest}
        disabled={busy}
        className="truncate rounded bg-zinc-700 px-2 py-1 hover:bg-zinc-600 disabled:opacity-50"
      >
        {dest ? `Dest: ${base(dest)}` : 'Pick destination world…'}
      </button>
      <span className="text-amber-300">
        ⚠ Destination must be the same modpack version and closed in Minecraft. Overwrites its
        chunks at the same coordinates.
      </span>
      <div className="flex gap-1">
        <button
          onClick={runCopy}
          disabled={!dest || busy}
          className="flex-1 rounded bg-sky-700 px-2 py-1 text-white hover:bg-sky-600 disabled:opacity-50"
        >
          {busy ? 'Copying…' : 'Copy'}
        </button>
        <button
          onClick={onClose}
          disabled={busy}
          className="flex-1 rounded bg-zinc-700 px-2 py-1 hover:bg-zinc-600 disabled:opacity-50"
        >
          Close
        </button>
      </div>
      {result && (
        <span className={result.startsWith('Error') ? 'text-red-300' : 'text-emerald-300'}>
          {result}
        </span>
      )}
    </div>
  )
}
