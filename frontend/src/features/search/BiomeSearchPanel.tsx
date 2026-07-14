import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Loader2, MapPin, Trees, X } from 'lucide-react'

import type { ChunkCoord } from '../map/mapEngine'
import {
  type HomePos,
  homeDistance,
  sortByDistanceFromHome,
} from '../map/homeWaypoint'
import { useSearchBiomes } from './api/searchBiomes'
import { useBiomesPresent } from './api/biomesPresent'
import { type BiomeRegion, clusterBiomeRegions } from './biomeRegions'

interface Props {
  biomeNames: Record<number, string>
  dimensionPath: string
  /** Home waypoint to measure/sort distance from; null = no sorting. */
  home: HomePos | null
  /** Fly the map camera to frame a region's full extent. */
  onFrame: (bounds: {
    minX: number
    minZ: number
    maxX: number
    maxZ: number
  }) => void
  /** Outline (or clear, with null) a region's chunks; `pulse` animates the glow. */
  onHighlight: (chunks: ChunkCoord[] | null, pulse?: boolean) => void
  onClose: () => void
}

interface BiomeRow {
  id: number
  name: string
  chunks: number
}

/**
 * Biome search: pick from the biomes actually present in this dimension (not every
 * biome the pack registers), then browse its regions (connected patches). Nothing
 * is highlighted just by picking a biome — hovering a region pulses its glow on
 * the map, and clicking one locks the glow on and flies there.
 */
export function BiomeSearchPanel({
  biomeNames,
  dimensionPath,
  home,
  onFrame,
  onHighlight,
  onClose,
}: Props) {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<BiomeRow | null>(null)
  // The clicked region (steady glow) and the hovered one (pulsing glow, wins).
  const [locked, setLocked] = useState<BiomeRegion | null>(null)
  const [hovered, setHovered] = useState<BiomeRegion | null>(null)
  const present = useBiomesPresent(dimensionPath)
  const search = useSearchBiomes(dimensionPath)

  // Highlight the hovered region (pulsing) or, failing that, the locked one
  // (steady). Nothing active → no highlight. Cleared on close/unmount.
  useEffect(() => {
    const active = hovered ?? locked
    onHighlight(active ? active.coords : null, hovered !== null)
  }, [hovered, locked, onHighlight])
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
    setLocked(null)
    setHovered(null)
    search.reset()
    search.mutate([r.id])
  }

  function back() {
    setSelected(null)
    setLocked(null)
    setHovered(null)
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
            locked={locked}
            onRetry={() => search.mutate([selected.id])}
            onHover={setHovered}
            onPick={(r) => {
              setLocked(r)
              onFrame(r.bounds)
            }}
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
  locked,
  onRetry,
  onHover,
  onPick,
}: {
  state: ReturnType<typeof useSearchBiomes>
  home: HomePos | null
  locked: BiomeRegion | null
  onRetry: () => void
  onHover: (region: BiomeRegion | null) => void
  onPick: (region: BiomeRegion) => void
}) {
  // Cluster the biome's chunks into connected regions — one row per patch.
  const regions = useMemo<BiomeRegion[]>(
    () => (state.data ? clusterBiomeRegions(state.data.hits) : []),
    [state.data]
  )

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
  // Nearest-first from home, else biggest patch first.
  const sorted = home
    ? sortByDistanceFromHome(regions, home)
    : [...regions].sort((a, b) => b.chunks - a.chunks)
  return (
    <>
      <p className="px-3 py-1.5 text-[11px] text-zinc-500">
        {sorted.length.toLocaleString()} region{sorted.length === 1 ? '' : 's'}{' '}
        · {data.hit_chunks.toLocaleString()} chunk
        {data.hit_chunks === 1 ? '' : 's'}
        {home && ' · nearest first'}
        {data.capped && ' (capped — some far patches omitted)'}
      </p>
      <p className="px-3 pb-1 text-[11px] leading-snug text-zinc-600">
        {home
          ? 'Hover to preview, click to keep it on the map.'
          : 'Hover to preview · click to keep it on · right-click the map to set a home for distances.'}
      </p>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {sorted.map((r: BiomeRegion) => {
          const isLocked = locked?.cx === r.cx && locked?.cz === r.cz
          return (
            <button
              key={`${r.cx},${r.cz}`}
              onClick={() => onPick(r)}
              onMouseEnter={() => onHover(r)}
              onMouseLeave={() => onHover(null)}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-xs hover:bg-zinc-800 hover:text-zinc-100 ${
                isLocked ? 'bg-zinc-800/60 text-zinc-100' : 'text-zinc-300'
              }`}
              title={`Center ${r.x}, ${r.z} — ${r.chunks} chunks`}
            >
              <MapPin
                className={`h-3.5 w-3.5 shrink-0 ${isLocked ? 'text-sky-400' : 'text-amber-400'}`}
                aria-hidden
              />
              <span className="flex-1">
                {r.x}, {r.z}
              </span>
              <span className="shrink-0 text-zinc-500">
                {r.chunks.toLocaleString()} ch
              </span>
              {home && (
                <span className="shrink-0 text-emerald-400/80">
                  {homeDistance(r.x, r.z, home).toLocaleString()} blk
                </span>
              )}
            </button>
          )
        })}
      </div>
    </>
  )
}
