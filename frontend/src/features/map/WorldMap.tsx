import { useEffect, useRef } from 'react'
import { LocateFixed } from 'lucide-react'

import type { BlockColorMap } from '../blocks/api/blockColors'
import type { RegionSummary } from './api/regions'
import { textureDebugStore } from '../textures/textureDebugStore'
import { type BlockRenderRegistry, createResolvedRegistry } from '../blocks/blockRenderRegistry'
import { type RenderConfig, presetToConfig, BUILT_IN_PRESETS } from '../blocks/renderPresets'
import { ChunkTools } from '../chunk-ops/ChunkTools'
import { FilterPipelineInfo } from './FilterPipelineInfo'
import { MapEngine } from './mapEngine'

const DEFAULT_CONFIG: RenderConfig = presetToConfig(BUILT_IN_PRESETS[0])

interface Props {
  dimensionPath: string
  regions: RegionSummary[]
  blockColors?: BlockColorMap
  textureKeys?: Record<number, string>
  metaTextureKeys?: Record<string, string>
  worldPath?: string
  blockNames?: Record<number, string>
  registry?: BlockRenderRegistry
  config?: RenderConfig
  debugMode?: boolean
}

export function WorldMap({
  dimensionPath,
  regions,
  blockColors,
  textureKeys,
  metaTextureKeys,
  worldPath,
  blockNames,
  registry: registryProp,
  config: configProp,
  debugMode = false,
}: Props) {
  const containerRef  = useRef<HTMLDivElement>(null)
  const hudRef        = useRef<HTMLDivElement>(null)
  const inspectorRef  = useRef<HTMLDivElement>(null)

  const blockColorsRef     = useRef(blockColors);     blockColorsRef.current     = blockColors
  const textureKeysRef     = useRef(textureKeys);     textureKeysRef.current     = textureKeys
  const metaTextureKeysRef = useRef(metaTextureKeys); metaTextureKeysRef.current = metaTextureKeys
  const blockNamesRef      = useRef(blockNames);      blockNamesRef.current      = blockNames
  const configRef      = useRef(configProp ?? DEFAULT_CONFIG)
  configRef.current    = configProp ?? DEFAULT_CONFIG
  const debugModeRef   = useRef(debugMode);    debugModeRef.current   = debugMode
  const bcCountRef     = useRef(0);            bcCountRef.current     = Object.keys(blockColors ?? {}).length

  // Registry: use prop if provided (App.tsx owns it), otherwise create locally.
  const registryRef       = useRef<BlockRenderRegistry>(registryProp ?? createResolvedRegistry())
  const prevRegistryProp  = useRef<typeof registryProp>(undefined)
  if (registryProp !== prevRegistryProp.current) {
    prevRegistryProp.current = registryProp
    registryRef.current      = registryProp ?? createResolvedRegistry(blockNames)
  }

  const regionsRef     = useRef(regions); regionsRef.current = regions
  const syncRegionsRef = useRef<(() => void) | null>(null)
  const fitCameraRef   = useRef<(() => void) | null>(null)
  const engineRef      = useRef<MapEngine | null>(null)

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
      configRef, debugModeRef, bcCountRef, blockColorsRef, textureKeysRef,
      metaTextureKeysRef, blockNamesRef, registryRef, regionsRef,
      syncRegionsRef, fitCameraRef,
    })
    engineRef.current = engine
    return () => {
      engine.dispose()
      engineRef.current = null
    }
  }, [dimensionPath]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { syncRegionsRef.current?.() }, [regions])

  return (
    <div ref={containerRef} className="relative h-full w-full" style={{ touchAction: 'none' }}>
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
      <ChunkTools engineRef={engineRef} dimensionPath={dimensionPath} worldPath={worldPath ?? ''} />
    </div>
  )
}
