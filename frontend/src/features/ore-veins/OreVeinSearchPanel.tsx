import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Gem, Loader2, MapPin, X } from 'lucide-react'

import {
  type HomePos,
  homeDistance,
  sortByDistanceFromHome,
} from '../map/homeWaypoint'
import type { OreVeinView } from './OreVeinLabels'
import { type OreGroup, groupVeinsByOre } from './veinGroups'

interface Props {
  /** Every vein Visual Prospecting has cached for this dimension. */
  veins: OreVeinView[]
  loading: boolean
  /** false = this world has no Visual Prospecting data at all. */
  available: boolean
  /** Whether the map overlay is drawing veins (shared with the toolbar button). */
  overlayOn: boolean
  onToggleOverlay: () => void
  /** The ore the map is filtered to; null = all ores. Owned by App. */
  selectedKind: string | null
  onSelectKind: (kind: string | null) => void
  /** Home waypoint to measure/sort distance from; null = backend order. */
  home: HomePos | null
  onJump: (x: number, z: number) => void
  onClose: () => void
}

/**
 * Ore-vein search: browse the ores Visual Prospecting has cached in this
 * dimension, then drill into one to see every vein of it — nearest home first.
 * Picking an ore also filters the map overlay to it, so the map matches the list
 * you're reading; going back restores every vein.
 */
export function OreVeinSearchPanel({
  veins,
  loading,
  available,
  overlayOn,
  onToggleOverlay,
  selectedKind,
  onSelectKind,
  home,
  onJump,
  onClose,
}: Props) {
  const [query, setQuery] = useState('')

  // Leave the map showing everything when the panel goes away — a filter with no
  // visible panel driving it would look like veins had gone missing.
  useEffect(() => () => onSelectKind(null), [onSelectKind])

  const groups = useMemo(() => groupVeinsByOre(veins), [veins])
  const selected = selectedKind
    ? (groups.find((g) => g.kind === selectedKind) ?? null)
    : null

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? groups.filter((g) => g.name.toLowerCase().includes(q)) : groups
  }, [groups, query])

  return (
    <div className="flex h-full w-96 shrink-0 flex-col border-l border-zinc-800 bg-atlas-row">
      <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2">
        <Gem className="h-4 w-4 shrink-0 text-zinc-500" aria-hidden />
        <span className="text-sm font-medium text-zinc-200">
          Search ore veins
        </span>
        <button
          onClick={onClose}
          className="ml-auto text-zinc-500 hover:text-zinc-200"
          aria-label="Close ore vein search"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>

      <OverlayToggle
        on={overlayOn}
        filtered={selected !== null}
        onToggle={onToggleOverlay}
      />

      {loading ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-1.5 px-6 text-center text-xs text-zinc-500">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Reading prospecting data…
        </div>
      ) : !available ? (
        <p className="px-3 py-2 text-xs text-zinc-500">
          No Visual Prospecting data for this world.
        </p>
      ) : groups.length === 0 ? (
        <p className="px-3 py-2 text-xs leading-snug text-zinc-500">
          No ore veins cached in this dimension yet — explore/prospect in-game,
          or run Visual Prospecting’s vein cache.
        </p>
      ) : !selected ? (
        // ── Step 1: the ores present in this dimension ──
        <>
          <div className="p-3">
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Filter ${groups.length} ores…`}
              className="w-full rounded-lg border border-zinc-700 bg-atlas-input px-3 py-2 font-mono text-xs text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-atlas-accent-line"
            />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {rows.length === 0 ? (
              <p className="px-3 py-1.5 text-xs text-zinc-500">
                No ores match “{query}”.
              </p>
            ) : (
              rows.map((g) => (
                <OreRow
                  key={g.kind}
                  group={g}
                  onPick={() => onSelectKind(g.kind)}
                />
              ))
            )}
          </div>
        </>
      ) : (
        // ── Step 2: every vein of the chosen ore ──
        <>
          <div className="flex items-center gap-1.5 border-b border-zinc-800 px-3 py-2">
            <button
              onClick={() => onSelectKind(null)}
              className="text-zinc-500 hover:text-zinc-200"
              aria-label="Back to ore list"
            >
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
            </button>
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: selected.color }}
              aria-hidden
            />
            <span
              className="truncate font-mono text-xs text-zinc-300"
              title={selected.kind}
            >
              {selected.name}
            </span>
          </div>
          <VeinResults group={selected} home={home} onJump={onJump} />
        </>
      )}
    </div>
  )
}

/** The master switch for the map overlay — same state as the toolbar button. */
function OverlayToggle({
  on,
  filtered,
  onToggle,
}: {
  on: boolean
  filtered: boolean
  onToggle: () => void
}) {
  return (
    <button
      role="switch"
      aria-checked={on}
      onClick={onToggle}
      className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2 text-left text-xs hover:bg-zinc-900"
    >
      <span className={`flex-1 ${on ? 'text-zinc-200' : 'text-zinc-400'}`}>
        {filtered ? 'Show this ore on map' : 'Show all veins on map'}
      </span>
      <span
        className={`relative h-4 w-7 shrink-0 rounded-full transition-colors ${
          on ? 'bg-amber-400/80' : 'bg-zinc-700'
        }`}
        aria-hidden
      >
        <span
          className={`absolute top-0.5 h-3 w-3 rounded-full bg-zinc-950 transition-all ${
            on ? 'left-3.5' : 'left-0.5'
          }`}
        />
      </span>
    </button>
  )
}

function OreRow({ group, onPick }: { group: OreGroup; onPick: () => void }) {
  return (
    <button
      onClick={onPick}
      className="flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-xs text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100"
      title={`${group.name} (${group.kind})`}
    >
      <span
        className="h-2.5 w-2.5 shrink-0 rounded-full"
        style={{ backgroundColor: group.color }}
        aria-hidden
      />
      <span className="flex-1 truncate">{group.name}</span>
      {group.depleted > 0 && (
        <span
          className="shrink-0 text-zinc-600"
          title={`${group.depleted} mined out`}
        >
          {group.depleted} dep
        </span>
      )}
      <span className="shrink-0 text-zinc-500">
        {group.veins.length.toLocaleString()} vein
        {group.veins.length === 1 ? '' : 's'}
      </span>
    </button>
  )
}

function VeinResults({
  group,
  home,
  onJump,
}: {
  group: OreGroup
  home: HomePos | null
  onJump: (x: number, z: number) => void
}) {
  // Nearest home first; with no home set this hands back the backend's order.
  const sorted = useMemo(
    () => sortByDistanceFromHome(group.veins, home),
    [group.veins, home]
  )

  return (
    <>
      <p className="px-3 py-1.5 text-[11px] text-zinc-500">
        {sorted.length.toLocaleString()} vein{sorted.length === 1 ? '' : 's'}
        {group.depleted > 0 &&
          ` · ${group.depleted.toLocaleString()} mined out`}
        {home && ' · nearest first'}
      </p>
      {!home && (
        <p className="px-3 pb-1 text-[11px] leading-snug text-zinc-600">
          Right-click the map to set a home for distances.
        </p>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {sorted.map((v, i) => (
          <button
            key={`${v.x},${v.z},${i}`}
            onClick={() => onJump(v.x, v.z)}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-xs text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100"
            title={
              v.depleted
                ? `${v.x}, ${v.z} — mined out`
                : `Jump to ${v.x}, ${v.z}`
            }
          >
            <MapPin
              className={`h-3.5 w-3.5 shrink-0 ${
                v.depleted ? 'text-zinc-600' : 'text-amber-400'
              }`}
              aria-hidden
            />
            <span
              className={`flex-1 ${v.depleted ? 'text-zinc-500 line-through' : ''}`}
            >
              {v.x}, {v.z}
            </span>
            {home && (
              <span className="shrink-0 text-emerald-400/80">
                {homeDistance(v.x, v.z, home).toLocaleString()} blk
              </span>
            )}
          </button>
        ))}
      </div>
    </>
  )
}
