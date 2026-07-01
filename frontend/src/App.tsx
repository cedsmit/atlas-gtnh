import { useEffect, useMemo, useState } from 'react'

import { useBlockColors } from './features/blocks/api/blockColors'
import { useBlockNames } from './features/blocks/api/blockNames'
import { type DimensionInfo, useDimensions } from './features/world/api/dimensions'
import { useMetaTextureKeys } from './features/blocks/api/metaTextureKeys'
import { useRegions } from './features/map/api/regions'
import { useScanProgress } from './features/map/api/scanProgress'
import { useTextureKeys } from './features/blocks/api/textureKeys'
import { DimensionPicker } from './features/world/DimensionPicker'
import { DumpMismatchBanner } from './features/debug/DumpMismatchBanner'
import { InspectPanel } from './features/inspect/InspectPanel'
import { LoadingScreen, type LoadingStage } from './shared/LoadingScreen'
import { MenuBar } from './shared/MenuBar'
import { TextureDebugPanel } from './features/debug/TextureDebugPanel'
import { WorldMap } from './features/map/WorldMap'
import { WorldPicker } from './features/world/WorldPicker'
import { useTexturePreloader } from './features/textures/useTexturePreloader'
import { createResolvedRegistry } from './features/blocks/blockRenderRegistry'
import { columnTally } from './features/map/columnTally'
import { type ElevationMode, type ContourMode, type TextureFilter, BUILT_IN_PRESETS, presetToConfig } from './features/blocks/renderPresets'
import { getTextureState } from './features/textures/textureLoader'
import { textureDebugStore } from './features/textures/textureDebugStore'

const LAST_WORLD_KEY = 'atlas:lastWorldPath'

export default function App() {
  // Restore last session's world on startup so the loading screen runs immediately
  const [worldPath,           setWorldPath]           = useState<string | null>(
    () => localStorage.getItem(LAST_WORLD_KEY)
  )
  const [dimensionPath,       setDimensionPath]       = useState<string | null>(null)
  const [inspectOpen,         setInspectOpen]         = useState(false)
  const [debugOpen,           setDebugOpen]           = useState(false)
  const [showFallbackMagenta, setShowFallbackMagenta] = useState(false)
  const [disableTint,         setDisableTint]         = useState(false)
  const [selectedPresetId,    setSelectedPresetId]    = useState('journeymap')
  const [elevOverride,        setElevOverride]        = useState<'preset'|'off'|'subtle'|'strong'|'relief'|'heightmap'|'contours'>('preset')
  const [textureFilterOverride, setTextureFilterOverride] = useState<'preset' | TextureFilter>('preset')

  // ── Data fetching ──────────────────────────────────────────────────────
  const { data: blockColors, isLoading: isScanning, isError: worldError } = useBlockColors(worldPath)
  const { data: blockNames }    = useBlockNames(worldPath)
  const { data: textureKeys }   = useTextureKeys(worldPath)
  const { data: metaTextureKeys } = useMetaTextureKeys(worldPath)
  const { data: dimensions }    = useDimensions(worldPath)
  const { data: regionData }    = useRegions(dimensionPath ?? '')

  // ── Render registry ────────────────────────────────────────────────────
  // Rebuilt when blockNames changes (new world = new FML ID mapping).
  const registry = useMemo(
    () => createResolvedRegistry(blockNames),
    [blockNames],
  )

  // ── Render config ───────────────────────────────────────────────────────
  // Derived from the active preset plus per-session overrides (RAW / FB toggles).
  const preset = BUILT_IN_PRESETS.find((p) => p.id === selectedPresetId) ?? BUILT_IN_PRESETS[0]
  const config = useMemo(() => {
    const base = presetToConfig(preset)
    let elevationMode     = base.elevationMode
    let elevationStrength = base.elevationStrength
    let contourMode       = base.contourMode
    if (elevOverride !== 'preset') {
      const overrides: Record<string, [ElevationMode, number, ContourMode]> = {
        'off':       ['off',              base.elevationStrength, 'off'],
        'subtle':    ['subtle',           base.elevationStrength, 'off'],
        'strong':    ['strong',           base.elevationStrength, 'off'],
        'relief':    ['strong',           1.5,                    'normal'],
        'heightmap': ['debug-heightmap',  base.elevationStrength, 'off'],
        'contours':  ['off',              base.elevationStrength, 'strong'],
      }
      const ov = overrides[elevOverride]
      if (ov) { elevationMode = ov[0]; elevationStrength = ov[1]; contourMode = ov[2] }
    }
    return {
      ...base,
      biomeTint:           disableTint ? false : base.biomeTint,
      showFallbackMagenta: showFallbackMagenta || base.showFallbackMagenta,
      elevationMode,
      elevationStrength,
      contourMode,
      textureFilter: textureFilterOverride === 'preset' ? preset.textureFilter : textureFilterOverride,
    }
  }, [preset, disableTint, showFallbackMagenta, elevOverride, textureFilterOverride])

  // ── Texture preloading ──────────────────────────────────────────────────
  // Only preload textures for blocks registered in this world — not all mod textures.
  // `textureKeys` already contains only the blocks present in this world's FML registry,
  // so Object.values(textureKeys) is a bounded set (typically 200-600 keys for GTNH).
  const tex = useTexturePreloader(textureKeys, worldPath, metaTextureKeys)

  // Whether the vanilla JAR resolved (probed via the stone texture, id 1).
  // Derived during render — the component already re-renders on `tex` ticks, so
  // this stays in sync with the imperative texture store without an effect.
  // null = still detecting, true = found, false = not found.
  const vanillaJarFound: boolean | null = !textureKeys
    ? null
    : !textureKeys[1]
      ? false
      : getTextureState(textureKeys[1]) === 'loaded'
        ? true
        : getTextureState(textureKeys[1]) === 'missing'
          ? false
          : null

  // ── Loading gate ───────────────────────────────────────────────────────
  // Determine which loading stage we are in so the loading screen can display
  // accurate progress.  The map is hidden until `readyToShow` is true.
  let loadingStage: LoadingStage | null = null
  if (!worldPath) {
    loadingStage = null
  } else if (isScanning || !blockColors) {
    loadingStage = 'scanning'
  } else if (!textureKeys) {
    loadingStage = 'registry'
  } else if (!tex.done) {
    loadingStage = 'textures'
  }

  // Poll mod-JAR scan progress only while the scanning stage is on screen.
  const { data: scanProgress } = useScanProgress(worldPath, loadingStage === 'scanning')

  // ── Auto-select single dimension ───────────────────────────────────────
  useEffect(() => {
    if (!isScanning && dimensions?.length === 1 && !dimensionPath) {
      setDimensionPath(dimensions[0].path)
    }
  }, [isScanning, dimensions, dimensionPath])

  // Reset the on-map block tally when the rendered world/dimension changes.
  useEffect(() => {
    columnTally.reset()
  }, [worldPath, dimensionPath])

  // ── Log debug summary when textures finish loading ─────────────────────
  useEffect(() => {
    if (!tex.done || !textureKeys) return
    const total = Object.keys(textureKeys).length
    console.log(
      `[atlas:textures] ${tex.loaded} / ${total} loaded, ${tex.missing} missing`,
    )
    if (debugOpen) {
      console.group('[atlas:debug] Texture preload complete — missing mappings:')
      const entries = textureDebugStore.getAll()
      const noMapping = entries.filter((e) => e.texStatus === 'no-mapping')
      for (const b of noMapping) {
        console.log(`  [${b.id}] ${b.name ?? '?'} — no texture mapping`)
      }
      console.groupEnd()
    }
  }, [tex.done]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Clear saved world if it fails to load ─────────────────────────────
  useEffect(() => {
    if (worldError) {
      localStorage.removeItem(LAST_WORLD_KEY)
      textureDebugStore.clear()
      setWorldPath(null)
      setDimensionPath(null)
    }
  }, [worldError])

  // ── World picker handlers ──────────────────────────────────────────────
  function handleWorldSelected(path: string) {
    localStorage.setItem(LAST_WORLD_KEY, path)
    textureDebugStore.clear()
    setWorldPath(path)
    setDimensionPath(null)
    setInspectOpen(false)
    setDebugOpen(false)
  }

  function handleCloseWorld() {
    localStorage.removeItem(LAST_WORLD_KEY)
    textureDebugStore.clear()
    setWorldPath(null)
    setDimensionPath(null)
    setInspectOpen(false)
    setDebugOpen(false)
    setShowFallbackMagenta(false)
  }

  function handleSelectDimension(dim: DimensionInfo) {
    setDimensionPath(dim.path)
  }

  // ── Panels are mutually exclusive ────────────────────────────────────
  function handleToggleInspect() {
    setInspectOpen((o) => !o)
    setDebugOpen(false)
  }

  function handleToggleDebug() {
    setDebugOpen((o) => !o)
    setInspectOpen(false)
  }

  // ── InspectPanel: pass textureKeys for accurate source classification ──
  // We also compute the effective texture key per block-id here so InspectPanel
  // can show 'texture' only for blocks that truly have a PNG key (not just a
  // vanilla fallback color from _VANILLA_COLORS).
  const textureKeysForInspect = useMemo<Record<number, string> | undefined>(
    () => textureKeys,
    [textureKeys],
  )

  return (
    <div className="flex h-screen flex-col bg-zinc-950 text-white">
      <MenuBar
        worldPath={worldPath}
        onWorldSelected={handleWorldSelected}
        onCloseWorld={handleCloseWorld}
        selectedPresetId={selectedPresetId}
        onSetPreset={worldPath ? setSelectedPresetId : undefined}
        elevOverride={elevOverride}
        onSetElevOverride={worldPath ? setElevOverride : undefined}
        inspectOpen={inspectOpen}
        onToggleInspect={worldPath ? handleToggleInspect : undefined}
        debugOpen={debugOpen}
        onToggleDebug={worldPath ? handleToggleDebug : undefined}
        showFallbackMagenta={showFallbackMagenta}
        onToggleFallbackMagenta={worldPath ? () => setShowFallbackMagenta((v) => !v) : undefined}
        disableTint={disableTint}
        onToggleDisableTint={worldPath ? () => setDisableTint((v) => !v) : undefined}
        textureFilter={textureFilterOverride}
        onSetTextureFilter={worldPath ? setTextureFilterOverride : undefined}
      />

      {!worldPath ? (
        /* ── No world selected ── */
        <div className="flex flex-1 flex-col items-center justify-center gap-4">
          <h1 className="text-2xl font-bold text-zinc-100">Atlas GTNH</h1>
          <WorldPicker onWorldSelected={handleWorldSelected} />
        </div>
      ) : loadingStage !== null ? (
        /* ── Loading in progress ── */
        <LoadingScreen
          stage={loadingStage}
          texLoaded={tex.loaded}
          texMissing={tex.missing}
          texTotal={tex.total}
          scanCurrent={scanProgress?.current}
          scanScanned={scanProgress?.scanned}
          scanTotal={scanProgress?.total}
          vanillaJarFound={vanillaJarFound}
        />
      ) : !dimensionPath ? (
        /* ── Loading done: pick dimension (or wait for dimensions to resolve) ── */
        dimensions ? (
          <DimensionPicker
            worldPath={worldPath}
            dimensions={dimensions}
            onSelect={handleSelectDimension}
            onCancel={handleCloseWorld}
          />
        ) : (
          <LoadingScreen stage="tiles" />
        )
      ) : (
        /* ── Map view ── */
        <div className="flex flex-1 overflow-hidden">
          <div className="relative flex-1 overflow-hidden">
            <WorldMap
              dimensionPath={dimensionPath}
              regions={regionData?.regions ?? []}
              blockColors={blockColors}
              textureKeys={textureKeys}
              metaTextureKeys={metaTextureKeys}
              worldPath={worldPath ?? undefined}
              blockNames={blockNames}
              registry={registry}
              config={config}
              debugMode={debugOpen}
            />
            <DumpMismatchBanner worldPath={worldPath} />
          </div>

          {/* Inspect panel */}
          {inspectOpen && (
            blockColors && blockNames ? (
              <InspectPanel
                blockColors={blockColors}
                blockNames={blockNames}
                textureKeys={textureKeysForInspect}
                onClose={() => setInspectOpen(false)}
              />
            ) : (
              <div className="flex h-full w-96 shrink-0 flex-col items-center justify-center border-l border-zinc-800 bg-zinc-950 text-xs text-zinc-500">
                Loading block data…
              </div>
            )
          )}

          {/* Texture debug panel */}
          {debugOpen && (
            <TextureDebugPanel
              worldPath={worldPath ?? undefined}
              registry={registry}
              onClose={() => setDebugOpen(false)}
            />
          )}
        </div>
      )}

    </div>
  )
}
