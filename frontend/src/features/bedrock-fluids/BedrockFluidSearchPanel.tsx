import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Droplets, Loader2, MapPin, X } from 'lucide-react'

import {
  type HomePos,
  homeDistance,
  sortByDistanceFromHome,
} from '../map/homeWaypoint'
import type { BedrockFluidField } from './api/bedrockFluids'
import { type FluidGroup, groupFieldsByFluid } from './fluidGroups'
import {
  OIL_DRILLING_RIGS,
  type OilDrillingRigTier,
  type RigRecommendation,
} from './rigPlanner'

interface Props {
  fields: BedrockFluidField[]
  loading: boolean
  available: boolean
  predictionAvailable: boolean
  overlayOn: boolean
  onToggleOverlay: () => void
  selectedKey: string | null
  onSelectKey: (key: string | null) => void
  rigTier: OilDrillingRigTier
  onRigTierChange: (tier: OilDrillingRigTier) => void
  rigRecommendations: RigRecommendation[]
  selectedRigKey: string | null
  onSelectRig: (recommendation: RigRecommendation) => void
  home: HomePos | null
  onJump: (x: number, z: number) => void
  onClose: () => void
}

/** Browse fluid types, then jump to a predicted or prospected field. */
export function BedrockFluidSearchPanel({
  fields,
  loading,
  available,
  predictionAvailable,
  overlayOn,
  onToggleOverlay,
  selectedKey,
  onSelectKey,
  rigTier,
  onRigTierChange,
  rigRecommendations,
  selectedRigKey,
  onSelectRig,
  home,
  onJump,
  onClose,
}: Props) {
  const [query, setQuery] = useState('')

  useEffect(() => () => onSelectKey(null), [onSelectKey])

  const groups = useMemo(() => groupFieldsByFluid(fields), [fields])
  const selected = selectedKey
    ? (groups.find((group) => group.key === selectedKey) ?? null)
    : null
  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return groups
    return groups.filter(
      (group) =>
        group.name.toLowerCase().includes(needle) ||
        group.fluid.toLowerCase().includes(needle)
    )
  }, [groups, query])

  return (
    <div className="flex h-full w-96 shrink-0 flex-col border-l border-zinc-800 bg-atlas-row">
      <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2">
        <Droplets className="h-4 w-4 shrink-0 text-zinc-500" aria-hidden />
        <span className="text-sm font-medium text-zinc-200">
          Search bedrock fluids
        </span>
        <button
          onClick={onClose}
          className="ml-auto text-zinc-500 hover:text-zinc-200"
          aria-label="Close bedrock fluid search"
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
          Reading and predicting fluid fields…
        </div>
      ) : !available ? (
        <p className="px-3 py-2 text-xs leading-snug text-zinc-500">
          No Visual Prospecting data or UndergroundFluids.cfg found for this
          world.
        </p>
      ) : groups.length === 0 ? (
        <p className="px-3 py-2 text-xs leading-snug text-zinc-500">
          {predictionAvailable
            ? 'No fluid fields overlap generated chunks in this dimension.'
            : 'No bedrock-fluid fields have been prospected in this dimension yet.'}
        </p>
      ) : !selected ? (
        <>
          <div className="p-3">
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={`Filter ${groups.length} fluids…`}
              className="w-full rounded-lg border border-zinc-700 bg-atlas-input px-3 py-2 font-mono text-xs text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-atlas-accent-line"
            />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {rows.length === 0 ? (
              <p className="px-3 py-1.5 text-xs text-zinc-500">
                No fluids match “{query}”.
              </p>
            ) : (
              rows.map((group) => (
                <FluidRow
                  key={group.key}
                  group={group}
                  onPick={() => onSelectKey(group.key)}
                />
              ))
            )}
          </div>
        </>
      ) : (
        <>
          <div className="flex items-center gap-1.5 border-b border-zinc-800 px-3 py-2">
            <button
              onClick={() => onSelectKey(null)}
              className="text-zinc-500 hover:text-zinc-200"
              aria-label="Back to fluid list"
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
              title={selected.fluid}
            >
              {selected.name}
            </span>
          </div>
          <FluidResults
            group={selected}
            rigTier={rigTier}
            onRigTierChange={onRigTierChange}
            rigRecommendations={rigRecommendations}
            selectedRigKey={selectedRigKey}
            onSelectRig={onSelectRig}
            home={home}
            onJump={onJump}
          />
        </>
      )}
    </div>
  )
}

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
        {filtered ? 'Show this fluid on map' : 'Show all fluid fields on map'}
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

function FluidRow({
  group,
  onPick,
}: {
  group: FluidGroup
  onPick: () => void
}) {
  return (
    <button
      onClick={onPick}
      className="flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-xs text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100"
      title={`${group.name} (${group.fluid})`}
    >
      <span
        className="h-2.5 w-2.5 shrink-0 rounded-full"
        style={{ backgroundColor: group.color }}
        aria-hidden
      />
      <span className="flex-1 truncate">{group.name}</span>
      {group.prospected > 0 && (
        <span
          className="shrink-0 text-emerald-500/70"
          title={`${group.prospected} prospected/current`}
        >
          {group.prospected} cur
        </span>
      )}
      <span className="shrink-0 text-zinc-500">
        {group.fields.length.toLocaleString()} field
        {group.fields.length === 1 ? '' : 's'}
      </span>
    </button>
  )
}

function FluidResults({
  group,
  rigTier,
  onRigTierChange,
  rigRecommendations,
  selectedRigKey,
  onSelectRig,
  home,
  onJump,
}: {
  group: FluidGroup
  rigTier: OilDrillingRigTier
  onRigTierChange: (tier: OilDrillingRigTier) => void
  rigRecommendations: RigRecommendation[]
  selectedRigKey: string | null
  onSelectRig: (recommendation: RigRecommendation) => void
  home: HomePos | null
  onJump: (x: number, z: number) => void
}) {
  const sorted = useMemo(
    () => sortByDistanceFromHome(group.fields, home),
    [group.fields, home]
  )

  const rig = OIL_DRILLING_RIGS.find((item) => item.tier === rigTier)!
  const shownRecommendations = rigRecommendations.slice(0, 20)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <p className="px-3 py-1.5 text-[11px] text-zinc-500">
        {sorted.length.toLocaleString()} field
        {sorted.length === 1 ? '' : 's'} · {group.predicted.toLocaleString()}{' '}
        predicted · {group.prospected.toLocaleString()} current
        {home && ' · nearest first'}
      </p>
      {!home && (
        <p className="px-3 pb-1 text-[11px] leading-snug text-zinc-600">
          Right-click the map to set a home for distances.
        </p>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {!group.empty && (
          <section className="border-y border-zinc-800 bg-zinc-950/30 px-3 py-3">
            <label
              htmlFor="oil-drilling-rig-tier"
              className="mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-zinc-500"
            >
              Oil drilling rig
            </label>
            <select
              id="oil-drilling-rig-tier"
              value={rigTier}
              onChange={(event) =>
                onRigTierChange(event.target.value as OilDrillingRigTier)
              }
              className="w-full rounded-md border border-zinc-700 bg-atlas-input px-2.5 py-2 font-mono text-xs text-zinc-200 outline-none focus:border-atlas-accent-line"
            >
              {OIL_DRILLING_RIGS.map((item) => (
                <option key={item.tier} value={item.tier}>
                  Rig {item.tier} · {item.voltage} · {item.range}×{item.range}{' '}
                  chunks
                </option>
              ))}
            </select>
            <p className="mt-1.5 text-[11px] leading-snug text-zinc-500">
              GTNH sums every matching-fluid chunk in the snapped {rig.range}×
              {rig.range} area. Σ L/op is the combined displayed chunk flow; L/s
              includes the minimum-tier {rig.voltage} speed and 8-tick cycle.
            </p>

            <div className="mt-3 flex items-baseline justify-between">
              <span className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                Best locations
              </span>
              <span className="text-[10px] text-zinc-600">
                showing {shownRecommendations.length}
              </span>
            </div>
            {shownRecommendations.length === 0 ? (
              <p className="mt-2 text-xs text-zinc-500">
                No positive-yield chunks found for this fluid.
              </p>
            ) : (
              <div className="mt-1.5 space-y-1">
                {shownRecommendations.map((recommendation, index) => {
                  const selected = recommendation.key === selectedRigKey
                  const areaEndX =
                    recommendation.areaChunkX + recommendation.range - 1
                  const areaEndZ =
                    recommendation.areaChunkZ + recommendation.range - 1
                  const controllerMinX = recommendation.controllerChunkX * 16
                  const controllerMinZ = recommendation.controllerChunkZ * 16
                  return (
                    <button
                      key={recommendation.key}
                      onClick={() => onSelectRig(recommendation)}
                      className={`w-full rounded border px-2 py-1.5 text-left font-mono transition-colors ${
                        selected
                          ? 'border-cyan-400/70 bg-cyan-400/10 text-zinc-100'
                          : 'border-zinc-800 bg-zinc-900/50 text-zinc-300 hover:border-zinc-700 hover:bg-zinc-800'
                      }`}
                      title={`Place the controller anywhere in chunk ${recommendation.controllerChunkX}, ${recommendation.controllerChunkZ}`}
                    >
                      <span className="flex items-baseline gap-2">
                        <span className="text-[11px] text-cyan-300">
                          #{index + 1}
                        </span>
                        <span className="text-sm font-semibold text-white">
                          ~
                          {recommendation.estimatedLitersPerSecond.toLocaleString(
                            undefined,
                            { maximumFractionDigits: 1 }
                          )}{' '}
                          L/s
                        </span>
                        <span className="ml-auto text-[10px] text-zinc-500">
                          {recommendation.activeChunks}/{rig.range * rig.range}{' '}
                          chunks
                        </span>
                      </span>
                      <span className="mt-0.5 block text-[10px] text-zinc-500">
                        Σ {recommendation.totalYield.toLocaleString()} L/op
                        shown ·{' '}
                        {recommendation.baseOutputPerCycle.toLocaleString()} L /
                        8 ticks
                      </span>
                      <span className="mt-0.5 block text-[10px] text-zinc-600">
                        Suggested controller chunk{' '}
                        {recommendation.controllerChunkX},{' '}
                        {recommendation.controllerChunkZ} · blocks{' '}
                        {controllerMinX}–{controllerMinX + 15}, {controllerMinZ}
                        –{controllerMinZ + 15}
                      </span>
                      <span className="mt-0.5 block text-[10px] text-zinc-600">
                        Area chunks {recommendation.areaChunkX},{' '}
                        {recommendation.areaChunkZ} to {areaEndX}, {areaEndZ} ·{' '}
                        {recommendation.prospectedChunks}/
                        {recommendation.activeChunks} active chunks prospected
                      </span>
                    </button>
                  )
                })}
              </div>
            )}
          </section>
        )}

        <p className="px-3 pb-1 pt-3 text-[11px] font-medium uppercase tracking-wide text-zinc-600">
          Individual fields
        </p>
        {sorted.map((field) => (
          <button
            key={`${field.chunk_x},${field.chunk_z}`}
            onClick={() => onJump(field.x, field.z)}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-xs text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100"
            title={`Jump to ${field.x}, ${field.z} · ${field.source}`}
          >
            <MapPin
              className={`h-3.5 w-3.5 shrink-0 ${
                field.source === 'prospected'
                  ? 'text-emerald-400'
                  : 'text-amber-400'
              }`}
              aria-hidden
            />
            <span className="flex-1">
              {field.x}, {field.z}
            </span>
            {!field.empty && (
              <span className="shrink-0 text-zinc-500">
                {field.min_yield}–{field.max_yield} L/Op
              </span>
            )}
            {home && (
              <span className="shrink-0 text-emerald-400/80">
                {homeDistance(field.x, field.z, home).toLocaleString()} blk
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}
