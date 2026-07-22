import { useEffect, useMemo } from 'react'
import { Loader2, MapPin, Puzzle, X } from 'lucide-react'

import type { BlockColumn } from '../map/mapEngine'
import {
  type HomePos,
  homeDistance,
  sortByDistanceFromHome,
} from '../map/homeWaypoint'
import { type SearchHit, useSearchBlocks } from '../search/api/searchBlocks'
import { useLocateBlocks } from '../search/api/locateBlocks'
import { resolveMasterBlockId } from './masterBlock'

interface Props {
  blockNames: Record<number, string>
  dimensionPath: string
  /** Home waypoint to measure/sort distance from; null = no sorting. */
  home: HomePos | null
  /** Fly the map camera to a world block position. */
  onJump: (x: number, z: number) => void
  /** Paint (or clear, with null) the map highlight over the located dungeons. */
  onHighlight: (columns: BlockColumn[] | null) => void
  onClose: () => void
}

/**
 * LootGames dungeon locator: resolves the `lootgames:LootGamesMasterBlock` id for
 * this world (each master block marks one dungeon's centre), scans the dimension
 * for every occurrence, and lists them with XZ coords. Reuses the block-search
 * pipeline — the instant index gives the list, and a background chunk read marks
 * the exact blocks amber on the map. Clicking a dungeon flies the camera there.
 *
 * What this can and can't prove: a present Puzzle Master block means the game is
 * still active/available. Both a win and a loss end the game via `onGameEnd()`,
 * which destroys the master block — so an absent block is indistinguishable
 * between won, lost, never-generated, or manually removed. We therefore only
 * claim what presence proves ("still available to play"), never "not yet cleared".
 */
export function LootGamesPanel({
  blockNames,
  dimensionPath,
  home,
  onJump,
  onHighlight,
  onClose,
}: Props) {
  const masterId = useMemo(() => resolveMasterBlockId(blockNames), [blockNames])
  const search = useSearchBlocks(dimensionPath)
  const {
    mutate: locateMutate,
    reset: locateReset,
    data: locateData,
    isPending: locating,
  } = useLocateBlocks(dimensionPath)

  const { mutate: searchMutate, reset: searchReset } = search

  // Kick off the scan as soon as the panel opens (or the world/dimension
  // changes), since there's nothing for the user to pick.
  useEffect(() => {
    if (masterId == null) return
    searchReset()
    searchMutate([masterId])
  }, [masterId, dimensionPath, searchMutate, searchReset])

  // Once the instant index search returns the matching chunks, resolve the exact
  // block positions within them (a background chunk read) so the map can mark the
  // actual dungeons.
  useEffect(() => {
    if (masterId != null && search.data && search.data.hits.length) {
      locateMutate({
        ids: [masterId],
        chunks: search.data.hits.map((h) => [h.cx, h.cz] as [number, number]),
      })
    } else {
      locateReset()
    }
  }, [masterId, search.data, locateMutate, locateReset])

  // Drive the map highlight from the located dungeons; clear it on unmount.
  useEffect(() => {
    onHighlight(locateData ?? null)
  }, [locateData, onHighlight])
  useEffect(() => () => onHighlight(null), [onHighlight])

  return (
    <div className="flex h-full w-96 shrink-0 flex-col border-l border-zinc-800 bg-atlas-row">
      <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2">
        <Puzzle className="h-4 w-4 shrink-0 text-zinc-500" aria-hidden />
        <span className="text-sm font-medium text-zinc-200">
          LootGames dungeons
        </span>
        <button
          onClick={onClose}
          className="ml-auto text-zinc-500 hover:text-zinc-200"
          aria-label="Close LootGames locator"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>

      <p className="border-b border-zinc-800/60 px-3 py-1.5 text-[11px] leading-snug text-zinc-600">
        Shows LootGames that are still available to play. Games disappear from
        this list after they end.
      </p>

      {masterId == null ? (
        <p className="px-3 py-2 text-xs text-zinc-500">
          LootGames isn’t installed in this world — no{' '}
          <span className="font-mono">LootGamesMasterBlock</span> is registered.
        </p>
      ) : (
        <DungeonResults
          state={search}
          locating={locating}
          home={home}
          onRetry={() => search.mutate([masterId])}
          onJump={onJump}
        />
      )}
    </div>
  )
}

function DungeonResults({
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
  if (state.isPending || state.isIdle) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-1.5 px-6 text-center text-xs text-zinc-500">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        Scanning for dungeons…
        <span className="text-[11px] text-zinc-600">
          The first scan of a world builds an index; later ones are instant.
        </span>
      </div>
    )
  }
  if (state.isError) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 text-xs text-red-400">
        Scan failed.
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
        No active LootGames found in this dimension’s generated chunks.
      </p>
    )
  }
  // Nearest-first when a home is set; otherwise the index's densest-first order.
  const hits = sortByDistanceFromHome(data.hits, home)

  return (
    <>
      <p className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] text-zinc-500">
        <span>
          {data.total_matches.toLocaleString()} dungeon
          {data.total_matches === 1 ? '' : 's'} found
          {home && ' · nearest first'}
          {data.capped && ' (capped)'}
        </span>
        {locating && (
          <span className="ml-auto flex items-center gap-1 text-amber-400/80">
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
            marking…
          </span>
        )}
      </p>
      {!home && (
        <p className="px-3 pb-1 text-[11px] leading-snug text-zinc-600">
          Set a home (right-click the map) to sort by distance.
        </p>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {hits.map((h: SearchHit, i: number) => (
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
            <span className="w-8 shrink-0 text-zinc-600">#{i + 1}</span>
            <span className="flex-1">
              {h.x}, {h.z}
            </span>
            {home ? (
              <span className="shrink-0 text-emerald-400/80">
                {homeDistance(h.x, h.z, home).toLocaleString()} blk
              </span>
            ) : (
              h.count > 1 && <span className="text-zinc-500">×{h.count}</span>
            )}
          </button>
        ))}
      </div>
    </>
  )
}
