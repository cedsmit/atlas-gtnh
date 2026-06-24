import { useEffect, useMemo, useState } from 'react'

import { useBlockColors } from './api/blockColors'
import { useBlockNames } from './api/blockNames'
import { type DimensionInfo, useDimensions } from './api/dimensions'
import { useRegions } from './api/regions'
import { useTextureKeys } from './api/textureKeys'
import { DimensionPicker } from './components/DimensionPicker'
import { InspectPanel } from './components/InspectPanel'
import { LoadingScreen, type LoadingStage } from './components/LoadingScreen'
import { MenuBar } from './components/MenuBar'
import { TextureDebugPanel } from './components/TextureDebugPanel'
import { WorldMap } from './components/WorldMap'
import { WorldPicker } from './components/WorldPicker'
import { useTexturePreloader } from './hooks/useTexturePreloader'
import { getTextureState } from './lib/textureLoader'
import { textureDebugStore } from './lib/textureDebugStore'

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
  const [vanillaJarFound,     setVanillaJarFound]     = useState<boolean | null>(null)

  // ── Data fetching ──────────────────────────────────────────────────────
  const { data: blockColors, isLoading: isScanning, isError: worldError } = useBlockColors(worldPath)
  const { data: blockNames }  = useBlockNames(worldPath)
  const { data: textureKeys } = useTextureKeys(worldPath)
  const { data: dimensions }  = useDimensions(worldPath)
  const { data: regionData }  = useRegions(dimensionPath ?? '')

  // ── Texture preloading ──────────────────────────────────────────────────
  // Only preload textures for blocks registered in this world — not all mod textures.
  // `textureKeys` already contains only the blocks present in this world's FML registry,
  // so Object.values(textureKeys) is a bounded set (typically 200-600 keys for GTNH).
  const tex = useTexturePreloader(textureKeys, worldPath)

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

  // ── Auto-select single dimension ───────────────────────────────────────
  useEffect(() => {
    if (!isScanning && dimensions?.length === 1 && !dimensionPath) {
      setDimensionPath(dimensions[0].path)
    }
  }, [isScanning, dimensions, dimensionPath])

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

  // ── Track whether vanilla JAR textures are resolving ──────────────────
  useEffect(() => {
    if (!textureKeys) { setVanillaJarFound(null); return }
    const stoneKey = textureKeys[1]
    if (!stoneKey) { setVanillaJarFound(false); return }
    const state = getTextureState(stoneKey)
    if (state === 'loaded') setVanillaJarFound(true)
    else if (state === 'missing') setVanillaJarFound(false)
  }, [textureKeys, tex.loaded, tex.missing])

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
        inspectOpen={inspectOpen}
        onToggleInspect={worldPath ? handleToggleInspect : undefined}
        debugOpen={debugOpen}
        onToggleDebug={worldPath ? handleToggleDebug : undefined}
        showFallbackMagenta={showFallbackMagenta}
        onToggleFallbackMagenta={worldPath ? () => setShowFallbackMagenta((v) => !v) : undefined}
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
              worldPath={worldPath ?? undefined}
              blockNames={blockNames}
              debugMode={debugOpen}
              showFallbackMagenta={showFallbackMagenta}
            />
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
            <TextureDebugPanel worldPath={worldPath ?? undefined} onClose={() => setDebugOpen(false)} />
          )}
        </div>
      )}

    </div>
  )
}
