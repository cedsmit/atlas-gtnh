import { useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft,
  Droplets,
  Loader2,
  MapPin,
  Minus,
  Plus,
  X,
} from 'lucide-react'

import {
  type HomePos,
  homeDistance,
  sortByDistanceFromHome,
} from '../map/homeWaypoint'
import type { FluidsProspectingField } from './api/fluidsProspecting'
import {
  applyMinimumFluidYield,
  fluidFieldYieldStats,
  type FluidGroup,
  groupFieldsByFluid,
} from './fluidGroups'
import {
  calculateRigRecommendations,
  OIL_DRILLING_RIGS,
  type OilDrillingRigTier,
  type RigRecommendation,
} from './rigPlanner'

const MINIMUM_YIELD_STEP = 50

interface Props {
  fields: FluidsProspectingField[]
  loading: boolean
  available: boolean
  overlayOn: boolean
  onToggleOverlay: () => void
  selectedKey: string | null
  onSelectKey: (key: string | null) => void
  rigTier: OilDrillingRigTier
  onRigTierChange: (tier: OilDrillingRigTier) => void
  minimumYield: number
  onMinimumYieldChange: (minimum: number) => void
  selectedRigKey: string | null
  onSelectRig: (recommendation: RigRecommendation) => void
  home: HomePos | null
  onJump: (x: number, z: number) => void
  onClose: () => void
}

/** Browse fluid types, then jump to a field. */
export function FluidsProspectingPanel({
  fields,
  loading,
  available,
  overlayOn,
  onToggleOverlay,
  selectedKey,
  onSelectKey,
  rigTier,
  onRigTierChange,
  minimumYield,
  onMinimumYieldChange,
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
          Fluids prospecting
        </span>
        <button
          onClick={onClose}
          className="ml-auto text-zinc-500 hover:text-zinc-200"
          aria-label="Close fluids prospecting"
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
          Reading fluid fields…
        </div>
      ) : !available ? (
        <p className="px-3 py-2 text-xs leading-snug text-zinc-500">
          No Visual Prospecting data or UndergroundFluids.cfg found for this
          world.
        </p>
      ) : groups.length === 0 ? (
        <p className="px-3 py-2 text-xs leading-snug text-zinc-500">
          No fluid fields overlap generated chunks in this dimension.
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
            minimumYield={minimumYield}
            onMinimumYieldChange={onMinimumYieldChange}
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
  minimumYield,
  onMinimumYieldChange,
  selectedRigKey,
  onSelectRig,
  home,
  onJump,
}: {
  group: FluidGroup
  rigTier: OilDrillingRigTier
  onRigTierChange: (tier: OilDrillingRigTier) => void
  minimumYield: number
  onMinimumYieldChange: (minimum: number) => void
  selectedRigKey: string | null
  onSelectRig: (recommendation: RigRecommendation) => void
  home: HomePos | null
  onJump: (x: number, z: number) => void
}) {
  const matchingFields = useMemo(
    () =>
      group.empty
        ? group.fields
        : group.fields.filter(
            (field) => fluidFieldYieldStats(field, minimumYield) !== null
          ),
    [group.empty, group.fields, minimumYield]
  )
  const sorted = useMemo(
    () => sortByDistanceFromHome(matchingFields, home),
    [home, matchingFields]
  )

  const rig = OIL_DRILLING_RIGS.find((item) => item.tier === rigTier)!
  const recommendationsByField = useMemo(() => {
    const byField = new Map<string, RigRecommendation>()
    for (const field of group.fields) {
      const [filteredField] = applyMinimumFluidYield([field], minimumYield)
      const recommendation = filteredField
        ? calculateRigRecommendations([filteredField], rig.range)[0]
        : undefined
      if (recommendation) {
        byField.set(`${field.chunk_x},${field.chunk_z}`, recommendation)
      }
    }
    return byField
  }, [group.fields, minimumYield, rig.range])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <p className="px-3 py-1.5 text-[11px] text-zinc-500">
        {sorted.length.toLocaleString()} field
        {sorted.length === 1 ? '' : 's'}
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
            <label
              htmlFor="minimum-fluid-yield"
              className="mb-1.5 mt-3 block text-[11px] font-medium uppercase tracking-wide text-zinc-500"
            >
              Minimum yield
            </label>
            <div className="flex overflow-hidden rounded-md border border-zinc-700 bg-atlas-input focus-within:border-atlas-accent-line">
              <button
                type="button"
                onClick={() =>
                  onMinimumYieldChange(
                    Math.max(0, minimumYield - MINIMUM_YIELD_STEP)
                  )
                }
                disabled={minimumYield === 0}
                className="flex w-9 shrink-0 items-center justify-center border-r border-zinc-700 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200 disabled:cursor-not-allowed disabled:text-zinc-700 disabled:hover:bg-transparent"
                aria-label={`Decrease minimum yield by ${MINIMUM_YIELD_STEP} L/op`}
              >
                <Minus className="h-3.5 w-3.5" aria-hidden />
              </button>
              <input
                id="minimum-fluid-yield"
                type="number"
                min={0}
                step={MINIMUM_YIELD_STEP}
                value={minimumYield}
                onChange={(event) => {
                  const value = event.currentTarget.valueAsNumber
                  onMinimumYieldChange(
                    Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0
                  )
                }}
                className="min-w-0 flex-1 appearance-none bg-transparent px-2 py-2 text-center font-mono text-xs font-medium text-zinc-200 outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              />
              <button
                type="button"
                onClick={() =>
                  onMinimumYieldChange(minimumYield + MINIMUM_YIELD_STEP)
                }
                className="flex w-9 shrink-0 items-center justify-center border-l border-zinc-700 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
                aria-label={`Increase minimum yield by ${MINIMUM_YIELD_STEP} L/op`}
              >
                <Plus className="h-3.5 w-3.5" aria-hidden />
              </button>
              <span className="flex shrink-0 items-center border-l border-zinc-700 bg-zinc-900 px-2.5 font-mono text-xs text-zinc-500">
                L/op
              </span>
            </div>
            <p className="mt-1.5 text-[11px] leading-snug text-zinc-500">
              Rig {rig.tier} estimates are shown with each matching field.
            </p>
          </section>
        )}

        <div className="flex items-baseline justify-between px-3 pb-1 pt-3">
          <span className="text-[11px] font-medium uppercase tracking-wide text-zinc-600">
            Individual fields
          </span>
          {minimumYield > 0 && (
            <span className="text-[10px] text-zinc-600">
              {sorted.length}/{group.fields.length} fields
            </span>
          )}
        </div>
        {sorted.length === 0 ? (
          <p className="px-3 py-2 text-xs text-zinc-500">
            No fields contain chunks at or above {minimumYield.toLocaleString()}{' '}
            L/op.
          </p>
        ) : (
          <div className="space-y-1 px-2 pb-2">
            {sorted.map((field) => {
              const stats = fluidFieldYieldStats(field, minimumYield)
              const recommendation = recommendationsByField.get(
                `${field.chunk_x},${field.chunk_z}`
              )
              const selected = recommendation?.key === selectedRigKey
              return (
                <button
                  key={`${field.chunk_x},${field.chunk_z}`}
                  onClick={() =>
                    recommendation
                      ? onSelectRig(recommendation)
                      : onJump(field.x, field.z)
                  }
                  className={`w-full rounded border px-2 py-2 text-left font-mono transition-colors ${
                    selected
                      ? 'border-cyan-400/70 bg-cyan-400/10'
                      : 'border-zinc-800 bg-zinc-900/40 hover:border-zinc-700 hover:bg-zinc-800'
                  }`}
                  title={`Jump to field ${field.x}, ${field.z}`}
                >
                  <span className="flex items-center gap-1.5 text-xs text-zinc-200">
                    <MapPin
                      className="h-3.5 w-3.5 shrink-0 text-cyan-400"
                      aria-hidden
                    />
                    <span>
                      {field.x}, {field.z}
                    </span>
                    {home && (
                      <span className="ml-auto text-[10px] text-emerald-400/80">
                        {homeDistance(field.x, field.z, home).toLocaleString()}{' '}
                        blk
                      </span>
                    )}
                  </span>
                  {stats && (
                    <span className="mt-1 block text-[10px] text-zinc-500">
                      {stats.minimum.toLocaleString()}–
                      {stats.maximum.toLocaleString()} L/op · avg{' '}
                      {stats.average.toLocaleString()} · {stats.chunks} chunk
                      {stats.chunks === 1 ? '' : 's'}
                    </span>
                  )}
                  {recommendation && (
                    <span className="mt-0.5 block text-[10px] text-zinc-400">
                      Rig {rig.tier} ~
                      {recommendation.estimatedLitersPerSecond.toLocaleString(
                        undefined,
                        { maximumFractionDigits: 1 }
                      )}{' '}
                      L/s · controller {recommendation.x}, {recommendation.z}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
