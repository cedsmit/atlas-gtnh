import { open } from '@tauri-apps/plugin-dialog'
import {
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'

import type { MapEngine } from '../map/mapEngine'
import { validateWorld } from '../world/api/worlds'
import { addRecentWorld } from '../world/recentWorlds'
import {
  copyChunks,
  createWorld,
  deleteChunks,
  deleteChunksExcept,
  type RotationReport,
} from './api/chunkOps'
import {
  type ChunkClipboard,
  setClipboard,
  useClipboard,
} from './chunkClipboard'

/** Shared empty selection, so "nothing selected" is one stable value. */
const EMPTY: ChunkSet = new Set<string>()

/** An inclusive chunk-coordinate box — a selection's extent, not its shape. */
export interface ChunkBox {
  cx0: number
  cz0: number
  cx1: number
  cz1: number
}

/**
 * The chosen chunks, as `"cx,cz"` keys.
 *
 * A set rather than a box because a selection is free-form: a box drag, a
 * painted blob and a scattering of single chunks are all the same thing to
 * everything downstream — the backend has always taken a chunk *list*, so
 * nothing below this line had to learn a new shape.
 */
export type ChunkSet = ReadonlySet<string>

/** How a gesture folds into the current selection. */
export type BrushMode = 'replace' | 'add' | 'subtract'

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

export const chunkKey = (cx: number, cz: number) => `${cx},${cz}`

export function parseChunkKey(key: string): [number, number] {
  const comma = key.indexOf(',')
  return [Number(key.slice(0, comma)), Number(key.slice(comma + 1))]
}

export function chunkList(sel: ChunkSet): [number, number][] {
  return [...sel].map(parseChunkKey)
}

/** The box a selection spans — its extent, which a free-form shape need not fill. */
export function boundsOf(sel: ChunkSet): ChunkBox | null {
  let box: ChunkBox | null = null
  for (const key of sel) {
    const [cx, cz] = parseChunkKey(key)
    if (!box) {
      box = { cx0: cx, cz0: cz, cx1: cx, cz1: cz }
      continue
    }
    if (cx < box.cx0) box.cx0 = cx
    if (cx > box.cx1) box.cx1 = cx
    if (cz < box.cz0) box.cz0 = cz
    if (cz > box.cz1) box.cz1 = cz
  }
  return box
}

/** Every chunk in the box between two corners, in either order. */
export function boxChunks(a: [number, number], b: [number, number]) {
  const out: [number, number][] = []
  for (let z = Math.min(a[1], b[1]); z <= Math.max(a[1], b[1]); z++)
    for (let x = Math.min(a[0], b[0]); x <= Math.max(a[0], b[0]); x++)
      out.push([x, z])
  return out
}

/**
 * The chunks a brush stroke crosses going from *a* to *b*, excluding *a*.
 *
 * Mouse moves arrive a few chunks apart when the pointer is quick or the zoom
 * is far out, so painting only the sampled chunk leaves a dotted line. Stepping
 * along the longer axis fills the gap.
 */
export function chunkLine(
  a: [number, number],
  b: [number, number]
): [number, number][] {
  const dx = b[0] - a[0]
  const dz = b[1] - a[1]
  const steps = Math.max(Math.abs(dx), Math.abs(dz))
  if (steps === 0) return []
  const out: [number, number][] = []
  for (let i = 1; i <= steps; i++)
    out.push([
      Math.round(a[0] + (dx * i) / steps),
      Math.round(a[1] + (dz * i) / steps),
    ])
  return out
}

/** Fold *chunks* into *sel* — replacing, adding to or cutting out of it. */
export function applyBrush(
  sel: ChunkSet,
  chunks: readonly [number, number][],
  mode: BrushMode
): ChunkSet {
  const next = new Set(mode === 'replace' ? [] : sel)
  for (const [cx, cz] of chunks) {
    if (mode === 'subtract') next.delete(chunkKey(cx, cz))
    else next.add(chunkKey(cx, cz))
  }
  return next
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

/**
 * Where each clipboard chunk lands for a paste anchored at *anchor*, turned by
 * *turn* degrees.
 *
 * One function for both the preview and the post-paste redraw, so what the map
 * outlines is by construction the set of chunks the write touches.
 */
export function pasteTargets(
  clipboard: ChunkClipboard,
  anchor: { cx: number; cz: number },
  turn: number
): [number, number][] {
  const b = clipboard.bounds
  const w = b.cx1 - b.cx0 + 1
  const h = b.cz1 - b.cz0 + 1
  const dx = anchor.cx - b.cx0
  const dz = anchor.cz - b.cz0
  return clipboard.chunks.map(([cx, cz]) => {
    const [i, j] = rotateInBox(cx - b.cx0, cz - b.cz0, turn, w, h)
    return [b.cx0 + dx + i, b.cz0 + dz + j]
  })
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
  open_: boolean,
  /** Switch worlds while remembering that paste placement should resume there. */
  onTargetWorldSelected: (path: string) => void
) {
  const clipboard = useClipboard()
  const [mode, setMode] = useState<ChunkOpsMode>('select')
  const [selection, setSelection] = useState<ChunkSet>(EMPTY)
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
  // outlives the tool that made it.
  useEffect(() => {
    if (open_) return
    setMode('select')
    setSelection(EMPTY)
    setAnchor(null)
    setTurn(0)
    setResult(null)
  }, [open_])

  // Selections are chunk coordinates, which mean nothing in another dimension.
  useEffect(() => {
    setSelection(EMPTY)
    setAnchor(null)
  }, [dimensionPath])

  // One place where the map learns what is selected. The alternative — every
  // action that changes the selection also telling the engine — is what lets
  // the two drift apart.
  useEffect(() => {
    engineRef.current?.setSelection(chunkList(selection))
  }, [selection, engineRef])

  /** Fold a gesture's chunks into the selection. */
  const paint = useCallback(
    (chunks: readonly [number, number][], brush: BrushMode) => {
      setSelection((sel) => applyBrush(sel, chunks, brush))
      setResult(null)
    },
    []
  )

  const clearSelection = useCallback(() => setSelection(EMPTY), [])

  // ── Paste preview ────────────────────────────────────────────────────
  // The outline covers exactly the chunks the paste will write — sparse and
  // turned included — because both come out of the same pasteTargets().
  const targets = useMemo(
    () =>
      clipboard && anchor && mode === 'paste'
        ? pasteTargets(clipboard, anchor, turn)
        : null,
    [clipboard, anchor, turn, mode]
  )

  useEffect(() => {
    const eng = engineRef.current
    eng?.setPreview(targets)
    return () => eng?.setPreview(null)
  }, [targets, engineRef])

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
    const bounds = boundsOf(selection)
    if (!bounds) return
    const chunks = chunkList(selection)
    setClipboard({ srcDim: dimensionPath, srcWorld: worldPath, chunks, bounds })
    say(
      `Copied ${chunks.length} chunk(s). Paste here or choose an existing target world.`
    )
  }

  const enterPaste = useCallback(() => {
    if (!clipboard) return
    clearSelection()
    setAnchor({ cx: clipboard.bounds.cx0, cz: clipboard.bounds.cz0 })
    setResult(null)
    setMode('paste')
  }, [clipboard, clearSelection])

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
    if (selection.size === 0) return
    const chunks = chunkList(selection)
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
        // the plain offset would not predict. Same targets the preview drew.
        engineRef.current?.invalidateChunks(
          pasteTargets(clipboard, anchor, turn)
        )
        return (
          `Pasted ${r.copied ?? 0} chunk(s)` +
          (r.missing ? `, ${r.missing} missing` : '') +
          '.' +
          (r.block_ids_remapped
            ? ` Remapped ${r.block_ids_remapped} block ID registration(s) for the target world.`
            : '') +
          (r.block_ids_inferred?.length
            ? ` Recovered unregistered source block ID(s) ${r.block_ids_inferred.join(', ')} from the target registry; verify those blocks in-game.`
            : '') +
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

  async function pasteToExistingWorld() {
    if (!clipboard || busy) return
    const picked = await open({ directory: true, multiple: false })
    if (typeof picked !== 'string') return

    setBusy(true)
    setResult(null)
    try {
      const validation = await validateWorld(picked)
      if (!validation.valid) {
        throw new Error(validation.error ?? 'Invalid world folder')
      }
      addRecentWorld(picked)
      onTargetWorldSelected(picked)
    } catch (e) {
      say(`Could not open target world: ${errMsg(e)}`, true)
    } finally {
      setBusy(false)
    }
  }

  return {
    clipboard,
    worldPath,
    mode,
    selection,
    anchor,
    turn,
    rotate,
    busy,
    result,
    error,
    count: selection.size,
    bounds: boundsOf(selection),
    paint,
    clearSelection,
    placeAnchor,
    nudge,
    copy,
    enterPaste,
    exitPaste,
    runDestructive,
    pasteHere,
    pasteToExistingWorld,
    pasteToNewWorld,
  }
}

export type ChunkOps = ReturnType<typeof useChunkOps>
