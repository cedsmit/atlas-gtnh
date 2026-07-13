import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Loader2, MapPin, Trees, X } from 'lucide-react'

import type { BlockColumn } from '../map/mapEngine'
import {
  type HomePos,
  homeDistance,
  sortByDistanceFromHome,
} from '../map/homeWaypoint'
import type { SearchHit } from './api/searchBlocks'
import { useSearchBiomes } from './api/searchBiomes'
import { useBiomesPresent } from './api/biomesPresent'

interface Props {
  biomeNames: Record<number, string>
  dimensionPath: string
  /** Home waypoint to measure/sort distance from; null = no sorting. */
  home: HomePos | null
  /** Fly the map camera to a world block position. */
  onJump: (x: number, z: number) => void
  /** Paint (or clear, with null) the map highlight over the matched chunks. */
  onHighlight: (columns: BlockColumn[] | null) => void
  onClose: () => void
}

interface BiomeRow {
  id: number
  name: string
  chunks: number
}

/** Cap the highlight footprint; hits arrive densest-first so top chunks win. */
const MAX_HIGHLIGHT_CHUNKS = 400

/** Fill each matched chunk's 16×16 columns — biomes are per-column and cluster by
 *  chunk, so a solid chunk footprint is the natural highlight (no chunk read). */
function chunkFillColumns(hits: SearchHit[]): BlockColumn[] {
  const columns: BlockColumn[] = []
  for (const h of hits.slice(0, MAX_HIGHLIGHT_CHUNKS)) {
    const bx = h.cx * 16
    const bz = h.cz * 16
    for (let c = 0; c < 256; c++) {
      columns.push({ x: bx + (c & 15), z: bz + (c >> 4) })
    }
  }
  return columns
}

/**
 * Biome search: pick from the biomes actually present in this dimension (not every
 * biome the pack registers), then list the chunks where it occurs. The matched
 * chunks are highlighted on the map; clicking a result flies the camera there.
 * Biomes are per-column, so whole matched chunks are highlighted directly (no
 * per-block locate step).
 */
export function BiomeSearchPanel({
  biomeNames,
  dimensionPath,
  home,
  onJump,
  onHighlight,
  onClose,
}: Props) {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<BiomeRow | null>(null)
  const present = useBiomesPresent(dimensionPath)
  const search = useSearchBiomes(dimensionPath)

  // Drive the map highlight from the matched chunks; clear it when nothing is
  // selected, and whenever the panel closes/unmounts.
  useEffect(() => {
    onHighlight(
      selected && search.data ? chunkFillColumns(search.data.hits) : null
    )
  }, [selected, search.data, onHighlight])
  useEffect(() => () => onHighlight(null), [onHighlight])

  // The present biomes (already widest-first), named from the dump when known,
  // narrowed by the filter box.
  const rows = useMemo<BiomeRow[]>(() => {
    if (!present.data) return []
    const q = query.trim().toLowerCase()
    return present.data
      .map((p) => ({
        id: p.biome_id,
        name: biomeNames[p.biome_id] ?? `Biome #${p.biome_id}`,
        chunks: p.chunks,
      }))
      .filter((r) => !q || r.name.toLowerCase().includes(q))
  }, [present.data, biomeNames, query])

  function pick(r: BiomeRow) {
    setSelected(r)
    search.reset()
    search.mutate([r.id])
  }

  function back() {
    setSelected(null)
    search.reset()
  }

  return (
    <div className="flex h-full w-96 shrink-0 flex-col border-l border-zinc-800 bg-zinc-950">
      <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2">
        <Trees className="h-4 w-4 shrink-0 text-zinc-500" aria-hidden />
        <span className="text-sm font-medium text-zinc-200">Search biomes</span>
        <button
          onClick={onClose}
          className="ml-auto text-zinc-500 hover:text-zinc-200"
          aria-label="Close biome search"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>

      {!selected ? (
        // ── Step 1: pick from the biomes present in this dimension ──
        <BiomeList
          state={present}
          rows={rows}
          query={query}
          onQuery={setQuery}
          onPick={pick}
        />
      ) : (
        // ── Step 2: results for the chosen biome ──
        <>
          <div className="flex items-center gap-1.5 border-b border-zinc-800 px-3 py-2">
            <button
              onClick={back}
              className="text-zinc-500 hover:text-zinc-200"
              aria-label="Back to biome list"
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
          <BiomeResults
            state={search}
            home={home}
            onRetry={() => search.mutate([selected.id])}
            onJump={onJump}
          />
        </>
      )}
    </div>
  )
}

function BiomeList({
  state,
  rows,
  query,
  onQuery,
  onPick,
}: {
  state: ReturnType<typeof useBiomesPresent>
  rows: BiomeRow[]
  query: string
  onQuery: (q: string) => void
  onPick: (r: BiomeRow) => void
}) {
  if (state.isPending) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-1.5 px-6 text-center text-xs text-zinc-500">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        Scanning biomes…
        <span className="text-[11px] text-zinc-600">
          The first scan of a world builds an index; later ones are instant.
        </span>
      </div>
    )
  }
  if (state.isError) {
    return (
      <p className="px-3 py-2 text-xs text-red-400">Failed to list biomes.</p>
    )
  }
  if (!state.data || state.data.length === 0) {
    return (
      <p className="px-3 py-2 text-xs text-zinc-500">
        No biomes found in this dimension’s generated chunks.
      </p>
    )
  }
  return (
    <>
      <div className="p-3">
        <input
          autoFocus
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder={`Filter ${state.data.length} biomes…`}
          className="w-full rounded bg-zinc-900 px-2 py-1.5 font-mono text-xs text-zinc-200 outline-none ring-1 ring-zinc-700 focus:ring-zinc-500"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {rows.length === 0 ? (
          <p className="px-3 py-1.5 text-xs text-zinc-500">
            No biomes match “{query}”.
          </p>
        ) : (
          rows.map((r) => (
            <button
              key={r.id}
              onClick={() => onPick(r)}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-xs text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100"
              title={`${r.name} (id ${r.id})`}
            >
              <span className="flex-1 truncate">{r.name}</span>
              <span className="shrink-0 text-zinc-500">
                {r.chunks.toLocaleString()} chunk{r.chunks === 1 ? '' : 's'}
              </span>
            </button>
          ))
        )}
      </div>
    </>
  )
}

function BiomeResults({
  state,
  home,
  onRetry,
  onJump,
}: {
  state: ReturnType<typeof useSearchBiomes>
  home: HomePos | null
  onRetry: () => void
  onJump: (x: number, z: number) => void
}) {
  if (state.isPending) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-1.5 px-6 text-center text-xs text-zinc-500">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        Locating…
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
        Not found in this dimension’s generated chunks.
      </p>
    )
  }
  const hits = sortByDistanceFromHome(data.hits, home)
  return (
    <>
      <p className="px-3 py-1.5 text-[11px] text-zinc-500">
        {data.hit_chunks.toLocaleString()} chunk
        {data.hit_chunks === 1 ? '' : 's'}
        {home && ' · nearest first'}
        {data.capped && ' (capped — refine for more)'}
      </p>
      {!home && (
        <p className="px-3 pb-1 text-[11px] leading-snug text-zinc-600">
          Set a home (right-click the map) to sort by distance.
        </p>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {hits.map((h: SearchHit) => (
          <button
            key={`${h.cx},${h.cz}`}
            onClick={() => onJump(h.x, h.z)}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-xs text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100"
            title={`Jump to ${h.x}, ${h.z}`}
          >
            <MapPin
              className="h-3.5 w-3.5 shrink-0 text-amber-400"
              aria-hidden
            />
            <span className="flex-1">
              {h.x}, {h.z}
            </span>
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
