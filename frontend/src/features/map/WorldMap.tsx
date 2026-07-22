import { useEffect, useRef, type MutableRefObject } from 'react'
import { LocateFixed } from 'lucide-react'

import type { BlockColorMap } from '../blocks/api/blockColors'
import {
  setDumpedBiomeColors,
  type DumpedBiomeColors,
} from '../blocks/blockColors'
import type { RegionSummary } from './api/regions'
import { textureDebugStore } from '../textures/textureDebugStore'
import {
  type BlockRenderRegistry,
  createResolvedRegistry,
} from '../blocks/blockRenderRegistry'
import {
  type RenderConfig,
  presetToConfig,
  BUILT_IN_PRESETS,
} from '../blocks/renderPresets'
import { FilterPipelineInfo } from './FilterPipelineInfo'
import { MapEngine, type MapContextInfo } from './mapEngine'
import { loadLastView, saveLastView } from './lastView'
import { loadHome } from './homeWaypoint'

const DEFAULT_CONFIG: RenderConfig = presetToConfig(BUILT_IN_PRESETS[0])

interface Props {
  dimensionPath: string
  regions: RegionSummary[]
  blockColors?: BlockColorMap
  biomeColors?: DumpedBiomeColors
  textureKeys?: Record<number, string>
  metaTextureKeys?: Record<string, string>
  blockNames?: Record<number, string>
  registry?: BlockRenderRegistry
  config?: RenderConfig
  debugMode?: boolean
  // Lifted so App can read the camera when saving a view and move it when
  // applying one. WorldMap populates it with the live engine (or null when torn down).
  engineRef?: MutableRefObject<MapEngine | null>
  // When set, right-clicking the map calls this (App opens a context menu) instead
  // of the block inspector. Left unset, right-click keeps the classic inspector.
  onMapContextRef?: MutableRefObject<((info: MapContextInfo) => void) | null>
}

export function WorldMap({
  dimensionPath,
  regions,
  blockColors,
  biomeColors,
  textureKeys,
  metaTextureKeys,
  blockNames,
  registry: registryProp,
  config: configProp,
  debugMode = false,
  engineRef: engineRefProp,
  onMapContextRef,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const hudRef = useRef<HTMLDivElement>(null)
  const inspectorRef = useRef<HTMLDivElement>(null)

  const blockColorsRef = useRef(blockColors)
  blockColorsRef.current = blockColors
  const textureKeysRef = useRef(textureKeys)
  textureKeysRef.current = textureKeys
  const metaTextureKeysRef = useRef(metaTextureKeys)
  metaTextureKeysRef.current = metaTextureKeys
  const blockNamesRef = useRef(blockNames)
  blockNamesRef.current = blockNames
  const configRef = useRef(configProp ?? DEFAULT_CONFIG)
  configRef.current = configProp ?? DEFAULT_CONFIG
  const debugModeRef = useRef(debugMode)
  debugModeRef.current = debugMode
  // Biome colours from the modpack dump feed a module singleton that biomeTints()
  // reads (so all call sites benefit without threading). Fold their count into
  // bcCount so tiles re-render when the dump loads.
  setDumpedBiomeColors(biomeColors ?? null)
  const bcCountRef = useRef(0)
  bcCountRef.current =
    Object.keys(blockColors ?? {}).length +
    Object.keys(biomeColors ?? {}).length

  // Registry: use prop if provided (App.tsx owns it), otherwise create locally.
  const registryRef = useRef<BlockRenderRegistry>(
    registryProp ?? createResolvedRegistry()
  )
  const prevRegistryProp = useRef<typeof registryProp>(undefined)
  if (registryProp !== prevRegistryProp.current) {
    prevRegistryProp.current = registryProp
    registryRef.current = registryProp ?? createResolvedRegistry(blockNames)
  }

  const regionsRef = useRef(regions)
  regionsRef.current = regions
  const syncRegionsRef = useRef<(() => void) | null>(null)
  const fitCameraRef = useRef<(() => void) | null>(null)
  // Use App's lifted ref when provided (so it can read/move the camera for saved
  // views); otherwise keep a local ref so WorldMap still works standalone.
  const localEngineRef = useRef<MapEngine | null>(null)
  const engineRef = engineRefProp ?? localEngineRef

  // Enable/disable debug store when prop changes
  useEffect(() => {
    if (debugMode) textureDebugStore.enable()
    else textureDebugStore.disable()
  }, [debugMode])

  // ── Main Three.js effect ────────────────────────────────────────────────
  useEffect(() => {
    const engine = new MapEngine({
      container: containerRef.current!,
      hud: hudRef.current!,
      inspector: inspectorRef.current!,
      dimensionPath,
      configRef,
      debugModeRef,
      bcCountRef,
      blockColorsRef,
      textureKeysRef,
      metaTextureKeysRef,
      blockNamesRef,
      registryRef,
      regionsRef,
      syncRegionsRef,
      fitCameraRef,
      onContextRef: onMapContextRef,
      // Resume where the user left off in this dimension (null = fit instead).
      initialView: loadLastView(dimensionPath),
      // Restore the home-waypoint marker for this dimension, if one is set.
      initialHome: loadHome(dimensionPath),
    })
    engineRef.current = engine
    // Persist the camera so closing the app or the world resumes here on reopen.
    // Periodic (covers a hard app close) plus a final save before teardown
    // (covers closing the world / switching dimension). saveLastView de-dupes.
    const persist = () => {
      const vp = engine.getViewport()
      saveLastView(dimensionPath, { cx: vp.cx, cz: vp.cz, scale: vp.scale })
    }
    const persistId = setInterval(persist, 1000)
    return () => {
      clearInterval(persistId)
      persist()
      engine.dispose()
      engineRef.current = null
    }
    // engineRef is a stable ref (App passes the same object); listed to satisfy
    // exhaustive-deps now that it's `prop ?? local` rather than a bare useRef.
  }, [dimensionPath, engineRef, onMapContextRef])

  useEffect(() => {
    syncRegionsRef.current?.()
  }, [regions])

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full"
      style={{ touchAction: 'none' }}
    >
      <div
        ref={hudRef}
        className="pointer-events-none absolute bottom-2 left-2 rounded bg-black/50 px-2 py-1 font-mono text-xs text-zinc-400"
      />
      <button
        onClick={() => fitCameraRef.current?.()}
        className="absolute right-2 top-2 inline-flex items-center gap-1 rounded bg-black/60 px-2 py-1 font-mono text-xs text-zinc-300 hover:bg-black/80"
        title="Fit camera to world (F / Home)"
      >
        <LocateFixed className="h-3.5 w-3.5" aria-hidden /> fit
      </button>
      {debugMode && (
        <FilterPipelineInfo filter={configProp?.textureFilter ?? 'pixel'} />
      )}
      <div
        ref={inspectorRef}
        className="pointer-events-auto absolute hidden rounded border border-zinc-600 bg-black/80 px-2 py-1 font-mono text-xs text-zinc-200"
        style={{ maxWidth: 280 }}
      />
    </div>
  )
}
