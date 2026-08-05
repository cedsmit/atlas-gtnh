import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Loader2, MapPin, Search, X } from 'lucide-react'

import type { BlockColumn } from '../map/mapEngine'
import {
  type HomePos,
  homeDistance,
  sortByDistanceFromHome,
} from '../map/homeWaypoint'
import { type SearchHit, useSearchBlocks } from './api/searchBlocks'
import { useLocateBlocks } from './api/locateBlocks'

interface Props {
  blockNames: Record<number, string>
  dimensionPath: string
  /** Home waypoint to measure/sort distance from; null = no sorting. */
  home: HomePos | null
  /** Fly the map camera to a world block position. */
  onJump: (x: number, z: number) => void
  /** Paint (or clear, with null) the map highlight over the matched blocks. */
  onHighlight: (columns: BlockColumn[] | null) => void
  onClose: () => void
}

interface BlockMatch {
  id: number
  name: string
}

const MAX_NAME_MATCHES = 100

/**
 * Stage 5 search: type a block name, pick a match, and list the chunks where it
 * occurs (surface and underground). The matched blocks are highlighted on the map
 * (amber markers); clicking a result flies the camera there.
 */
export function SearchPanel({
  blockNames,
  dimensionPath,
  home,
  onJump,
  onHighlight,
  onClose,
}: Props) {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<BlockMatch | null>(null)
  const search = useSearchBlocks(dimensionPath)
  const {
    mutate: locateMutate,
    reset: locateReset,
    data: locateData,
    isPending: locating,
  } = useLocateBlocks(dimensionPath)

  // Once the instant index search returns the matching chunks, resolve the exact
  // block positions within them (a background chunk read) so the map can mark the
  // actual blocks. Reset when the selection or results go away.
  useEffect(() => {
    if (selected && search.data && search.data.hits.length) {
      locateMutate({
        ids: [selected.id],
        chunks: search.data.hits.map((h) => [h.cx, h.cz] as [number, number]),
      })
    } else {
      locateReset()
    }
  }, [selected, search.data, locateMutate, locateReset])

  // Drive the map highlight from the located blocks; clear it when nothing is
  // selected, and whenever the panel closes/unmounts.
  useEffect(() => {
    onHighlight(selected ? (locateData ?? null) : null)
  }, [selected, locateData, onHighlight])
  useEffect(() => () => onHighlight(null), [onHighlight])

  // Block names matching the query substring (case-insensitive), capped.
  const matches = useMemo<BlockMatch[]>(() => {
    const q = query.trim().toLowerCase()
    if (q.length < 2) return []
    const out: BlockMatch[] = []
    for (const [id, name] of Object.entries(blockNames)) {
      if (name.toLowerCase().includes(q)) {
        out.push({ id: Number(id), name })
        if (out.length > MAX_NAME_MATCHES) break
      }
    }
    return out.sort((a, b) => a.name.localeCompare(b.name))
  }, [query, blockNames])

  function pick(m: BlockMatch) {
    setSelected(m)
    search.reset()
    search.mutate([m.id])
  }

  function back() {
    setSelected(null)
    search.reset()
  }

  return (
    <div className="flex h-full w-96 shrink-0 flex-col border-l border-zinc-800 bg-atlas-row">
      <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2">
        <Search className="h-4 w-4 shrink-0 text-zinc-500" aria-hidden />
        <span className="text-sm font-medium text-zinc-200">Search blocks</span>
        <button
          onClick={onClose}
          className="ml-auto text-zinc-500 hover:text-zinc-200"
          aria-label="Close search"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>

      {!selected ? (
        // ── Step 1: pick a block by name ──
        <>
          <div className="p-3">
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Block name, e.g. blastfurnace…"
              className="w-full rounded-lg border border-zinc-700 bg-atlas-input px-3 py-2 font-mono text-xs text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-atlas-accent-line"
            />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {query.trim().length < 2 ? (
              <p className="px-3 py-1.5 text-xs text-zinc-600">
                Type at least 2 characters.
              </p>
            ) : matches.length === 0 ? (
              <p className="px-3 py-1.5 text-xs text-zinc-500">
                No block names match “{query}”.
              </p>
            ) : (
              matches.map((m) => (
                <button
                  key={m.id}
                  onClick={() => pick(m)}
                  className="block w-full truncate px-3 py-1.5 text-left font-mono text-xs text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100"
                  title={`${m.name} (id ${m.id})`}
                >
                  {m.name}
                </button>
              ))
            )}
          </div>
        </>
      ) : (
        // ── Step 2: results for the chosen block ──
        <>
          <div className="flex items-center gap-1.5 border-b border-zinc-800 px-3 py-2">
            <button
              onClick={back}
              className="text-zinc-500 hover:text-zinc-200"
              aria-label="Back to block list"
            >
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
            </button>
            <span
              className="truncate font-mono text-xs text-zinc-300"
              title={selected.name}
            >
              {selected.name}
            </span>
          </div>
          <SearchResults
            state={search}
            locating={locating}
            home={home}
            onRetry={() => search.mutate([selected.id])}
            onJump={onJump}
          />
        </>
      )}
    </div>
  )
}

function SearchResults({
  state,
  locating,
  home,
  onRetry,
  onJump,
}: {
  state: ReturnType<typeof useSearchBlocks>
  locating: boolean
  home: HomePos | null
  onRetry: () => void
  onJump: (x: number, z: number) => void
}) {
  if (state.isPending) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-1.5 px-6 text-center text-xs text-zinc-500">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        Searching…
        {state.progress && state.progress.total > 0 && (
          <span className="font-mono text-zinc-400">
            {state.progress.done}/{state.progress.total} regions (
            {Math.round((state.progress.done / state.progress.total) * 100)}%)
          </span>
        )}
        <span className="text-[11px] text-zinc-600">
          The first search of a world builds an index; later ones are instant.
        </span>
      </div>
    )
  }
  if (state.isError) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 text-xs text-red-400">
        Search failed.
        <button
          onClick={onRetry}
          className="rounded bg-zinc-800 px-2 py-1 text-zinc-300 hover:bg-zinc-700"
        >
          Retry
        </button>
      </div>
    )
  }
  const data = state.data
  if (!data) return null
  if (data.hits.length === 0) {
    return (
      <p className="px-3 py-2 text-xs text-zinc-500">
        Not found in this dimension.
      </p>
    )
  }
  // Nearest-first when a home is set; otherwise the index's densest-first order.
  // Note: the server caps hits by count first, so this reorders the returned
  // (densest) chunks — it isn't a guaranteed global nearest for very common blocks.
  const hits = sortByDistanceFromHome(data.hits, home)

  return (
    <>
      <p className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] text-zinc-500">
        <span>
          {data.total_matches.toLocaleString()} blocks in {data.hit_chunks}{' '}
          chunk
          {data.hit_chunks === 1 ? '' : 's'}
          {home && ' · nearest first'}
          {data.capped && ' (capped — refine the name for more)'}
        </span>
        {locating && (
          <span className="ml-auto flex items-center gap-1 text-amber-400/80">
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
            marking…
          </span>
        )}
      </p>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {hits.map((h: SearchHit) => (
          <button
            key={`${h.cx},${h.cz}`}
            onClick={() => onJump(h.x, h.z)}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-xs text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100"
            title={`Jump to ${h.x}, ${h.y}, ${h.z}`}
          >
            <MapPin
              className="h-3.5 w-3.5 shrink-0 text-amber-400"
              aria-hidden
            />
            <span className="flex-1">
              {h.x}, {h.z}
            </span>
            <span className="text-zinc-500">×{h.count}</span>
            {home && (
              <span className="shrink-0 text-emerald-400/80">
                {homeDistance(h.x, h.z, home).toLocaleString()} blk
              </span>
            )}
          </button>
        ))}
      </div>
    </>
  )
}
