import { open } from '@tauri-apps/plugin-dialog'
import { type RefObject, useCallback, useEffect, useState } from 'react'

import type { MapEngine } from '../map/mapEngine'
import {
  copyChunks,
  createWorld,
  deleteChunks,
  deleteChunksExcept,
  type RotationReport,
} from './api/chunkOps'
import { setClipboard, useClipboard } from './chunkClipboard'

export interface ChunkSelection {
  cx0: number
  cz0: number
  cx1: number
  cz1: number
}

/** Drag a box to select, or click to place the paste anchor. */
export type ChunkOpsMode = 'select' | 'paste'

/** The two destructive operations, kept apart so neither can be mistaken for the other. */
export type Destructive = 'delete' | 'deleteExcept'

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e))

/**
 * Turn the backend's rotation report into one honest sentence.
 *
 * The guessed count is the point: those are tile-entity fields matched by name
 * rather than by a verified rule, so the number is really "how many machines to
 * go and look at". Reporting only the successes would imply a confidence the
 * rotation does not have.
 */
export function rotationNote(report?: RotationReport): string {
  if (!report) return ''
  const guessed = Object.values(report.guessed_keys).reduce((a, b) => a + b, 0)
  const parts = [`Turned ${report.turn}°`]
  if (report.blocks_turned)
    parts.push(`${report.blocks_turned} block(s) re-faced`)
  if (guessed)
    parts.push(
      `${guessed} machine field(s) rotated on a guess — check them in game`
    )
  return ` ${parts.join(', ')}.`
}

export function selectionCount(s: ChunkSelection): number {
  return (Math.abs(s.cx1 - s.cx0) + 1) * (Math.abs(s.cz1 - s.cz0) + 1)
}

export function normalise(s: ChunkSelection): ChunkSelection {
  return {
    cx0: Math.min(s.cx0, s.cx1),
    cz0: Math.min(s.cz0, s.cz1),
    cx1: Math.max(s.cx0, s.cx1),
    cz1: Math.max(s.cz0, s.cz1),
  }
}

/**
 * Where a chunk at offset (i, j) inside a w×h selection lands after *turn*
 * degrees clockwise.
 *
 * Mirrors `rotate_grid` in the backend's `chunk_rotate`. The duplication is
 * deliberate and small: the map has to know which chunks a turned paste will
 * cover before the request is sent (to draw the preview) and which ones to
 * redraw after (to refresh them), and neither can wait for a round trip.
 */
export function rotateInBox(
  i: number,
  j: number,
  turn: number,
  w: number,
  h: number
): [number, number] {
  switch (((turn % 360) + 360) % 360) {
    case 90:
      return [h - 1 - j, i]
    case 180:
      return [w - 1 - i, h - 1 - j]
    case 270:
      return [j, w - 1 - i]
    default:
      return [i, j]
  }
}

function expand(s: ChunkSelection): [number, number][] {
  const n = normalise(s)
  const out: [number, number][] = []
  for (let z = n.cz0; z <= n.cz1; z++)
    for (let x = n.cx0; x <= n.cx1; x++) out.push([x, z])
  return out
}

/**
 * State and save-writing actions for the chunk tools.
 *
 * Lives here rather than in either component because the work is split: a thin
 * input layer over the map produces the selection, and the side panel acts on
 * it. Both need the same state, and neither owns the other.
 */
export function useChunkOps(
  dimensionPath: string,
  worldPath: string,
  engineRef: RefObject<MapEngine | null>,
  /** True while the panel is open — drives the map overlays. */
  open_: boolean
) {
  const clipboard = useClipboard()
  const [mode, setMode] = useState<ChunkOpsMode>('select')
  const [selection, setSelection] = useState<ChunkSelection | null>(null)
  const [anchor, setAnchor] = useState<{ cx: number; cz: number } | null>(null)
  const [turn, setTurn] = useState(0)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState(false)

  const say = (text: string, failed = false) => {
    setResult(text)
    setError(failed)
  }

  // Closing the panel must take the map decorations with it, or a selection
  // rectangle outlives the tool that made it.
  useEffect(() => {
    if (open_) return
    setMode('select')
    setSelection(null)
    setAnchor(null)
    setTurn(0)
    setResult(null)
    engineRef.current?.setSelection(null)
    engineRef.current?.setPreview(null)
  }, [open_, engineRef])

  // Selections are chunk coordinates, which mean nothing in another dimension.
  useEffect(() => {
    setSelection(null)
    setAnchor(null)
    engineRef.current?.setSelection(null)
  }, [dimensionPath, engineRef])

  const selectBox = useCallback(
    (s: ChunkSelection) => {
      const n = normalise(s)
      setSelection(n)
      setResult(null)
      engineRef.current?.setSelection(n)
    },
    [engineRef]
  )

  const clearSelection = useCallback(() => {
    setSelection(null)
    engineRef.current?.setSelection(null)
  }, [engineRef])

  // ── Paste preview ────────────────────────────────────────────────────
  // A quarter turn swaps the footprint, so the preview has to swap with it —
  // otherwise the outline stops matching what the paste will actually cover.
  const quarter = turn === 90 || turn === 270
  const raw = clipboard && {
    w: clipboard.bounds.cx1 - clipboard.bounds.cx0 + 1,
    h: clipboard.bounds.cz1 - clipboard.bounds.cz0 + 1,
  }
  const size = raw && {
    w: quarter ? raw.h : raw.w,
    h: quarter ? raw.w : raw.h,
  }

  useEffect(() => {
    const eng = engineRef.current
    if (!eng || mode !== 'paste' || !anchor || !size) {
      eng?.setPreview(null)
      return
    }
    eng.setPreview({
      cx0: anchor.cx,
      cz0: anchor.cz,
      cx1: anchor.cx + size.w - 1,
      cz1: anchor.cz + size.h - 1,
    })
    return () => eng?.setPreview(null)
  }, [mode, anchor, size?.w, size?.h, turn, engineRef]) // eslint-disable-line react-hooks/exhaustive-deps

  const placeAnchor = useCallback((cx: number, cz: number) => {
    setAnchor({ cx, cz })
    setResult(null)
  }, [])

  /** Quarter turn clockwise; wraps back to none after a full circle. */
  const rotate = useCallback(() => setTurn((t) => (t + 90) % 360), [])

  const nudge = useCallback(
    (dx: number, dz: number) =>
      setAnchor((a) => (a ? { cx: a.cx + dx, cz: a.cz + dz } : a)),
    []
  )

  // ── Actions ──────────────────────────────────────────────────────────
  function copy() {
    if (!selection) return
    const chunks = expand(selection)
    setClipboard({
      srcDim: dimensionPath,
      srcWorld: worldPath,
      chunks,
      bounds: normalise(selection),
    })
    say(`Copied ${chunks.length} chunk(s). Open any world, then Paste.`)
  }

  function enterPaste() {
    if (!clipboard) return
    clearSelection()
    setAnchor({ cx: clipboard.bounds.cx0, cz: clipboard.bounds.cz0 })
    setResult(null)
    setMode('paste')
  }

  function exitPaste() {
    setMode('select')
    setAnchor(null)
    setTurn(0)
    setResult(null)
    engineRef.current?.setPreview(null)
  }

  async function run<T>(fn: () => Promise<T>, done: (r: T) => string) {
    setBusy(true)
    setResult(null)
    try {
      say(done(await fn()))
    } catch (e) {
      say(`Error: ${errMsg(e)}`, true)
    } finally {
      setBusy(false)
    }
  }

  async function runDestructive(kind: Destructive) {
    if (!selection) return
    const chunks = expand(selection)
    if (kind === 'delete') {
      await run(
        () => deleteChunks(dimensionPath, chunks),
        (r) => {
          engineRef.current?.invalidateChunks(chunks)
          return (
            `Deleted ${r.deleted ?? 0} chunk(s)` +
            (r.missing ? `, ${r.missing} already empty` : '') +
            '. Minecraft regenerates them next load.'
          )
        }
      )
    } else {
      await run(
        () => deleteChunksExcept(dimensionPath, chunks),
        (r) => {
          engineRef.current?.refreshView() // the whole dimension changed
          return (
            `Deleted ${r.deleted ?? 0} chunk(s), kept ${r.kept ?? chunks.length}. ` +
            'Minecraft regenerates them next load.'
          )
        }
      )
    }
    clearSelection()
  }

  async function pasteHere() {
    if (!clipboard || !anchor) return
    const dx = anchor.cx - clipboard.bounds.cx0
    const dz = anchor.cz - clipboard.bounds.cz0
    const b = clipboard.bounds
    const w = b.cx1 - b.cx0 + 1
    const h = b.cz1 - b.cz0 + 1
    await run(
      () =>
        copyChunks(
          clipboard.srcDim,
          dimensionPath,
          clipboard.chunks,
          [dx, dz],
          turn
        ),
      (r) => {
        // Redraw where the chunks actually landed — a turn moves them somewhere
        // the plain offset would not predict.
        engineRef.current?.invalidateChunks(
          clipboard.chunks.map(([cx, cz]) => {
            const [i, j] = rotateInBox(cx - b.cx0, cz - b.cz0, turn, w, h)
            return [b.cx0 + dx + i, b.cz0 + dz + j]
          })
        )
        return (
          `Pasted ${r.copied ?? 0} chunk(s)` +
          (r.missing ? `, ${r.missing} missing` : '') +
          '.' +
          rotationNote(r.rotation)
        )
      }
    )
  }

  async function pasteToNewWorld() {
    if (!clipboard || !anchor) return
    const picked = await open({ directory: true, multiple: false })
    if (typeof picked !== 'string') return
    const dx = anchor.cx - clipboard.bounds.cx0
    const dz = anchor.cz - clipboard.bounds.cz0
    await run(
      () => createWorld(clipboard.srcDim, picked, clipboard.chunks, [dx, dz]),
      (r) => {
        const name =
          picked
            .replace(/[\\/]+$/, '')
            .split(/[\\/]/)
            .pop() ?? picked
        return `Created ${name} with ${r.copied ?? 0} chunk(s).`
      }
    )
  }

  return {
    clipboard,
    mode,
    selection,
    anchor,
    turn,
    rotate,
    busy,
    result,
    error,
    count: selection ? selectionCount(selection) : 0,
    selectBox,
    clearSelection,
    placeAnchor,
    nudge,
    copy,
    enterPaste,
    exitPaste,
    runDestructive,
    pasteHere,
    pasteToNewWorld,
  }
}

export type ChunkOps = ReturnType<typeof useChunkOps>
