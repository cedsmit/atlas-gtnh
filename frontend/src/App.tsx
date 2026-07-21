import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Home, Loader2, Search, Trash2 } from 'lucide-react'

import { useBlockColors } from './features/blocks/api/blockColors'
import { useBiomeColors } from './features/blocks/api/biomeColors'
import { useBlockNames } from './features/blocks/api/blockNames'
import {
  type DimensionInfo,
  useDimensions,
} from './features/world/api/dimensions'
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
import { GridLabels } from './features/map/GridLabels'
import { useOreVeins } from './features/ore-veins/api/oreVeins'
import {
  OreVeinLabels,
  type OreVeinView,
} from './features/ore-veins/OreVeinLabels'
import { veinDisplay } from './features/ore-veins/oreVeinRegistry'
import { OreVeinSearchPanel } from './features/ore-veins/OreVeinSearchPanel'
import type {
  BlockColumn,
  ChunkCoord,
  MapContextInfo,
  MapEngine,
} from './features/map/mapEngine'
import { MapContextMenu } from './features/map/MapContextMenu'
import {
  clearHome,
  type HomePos,
  loadHome,
  saveHome,
} from './features/map/homeWaypoint'
import { SearchPanel } from './features/search/SearchPanel'
import { BiomeSearchPanel } from './features/search/BiomeSearchPanel'
import { LootGamesPanel } from './features/lootgames/LootGamesPanel'
import { useBiomeNames } from './features/blocks/api/biomeNames'
import { useChunkStats } from './features/search/api/chunkStats'
import { WorldPicker } from './features/world/WorldPicker'
import { useTexturePreloader } from './features/textures/useTexturePreloader'
import { createResolvedRegistry } from './features/blocks/blockRenderRegistry'
import { useRenderOverrides } from './features/blocks/api/renderOverrides'
import { columnTally } from './features/map/columnTally'
import { VIEWER_CONFIG } from './features/map/viewerConfig'
import { pipeSystemName } from './features/blocks/pipeSystems'
import {
  type ElevationMode,
  type ContourMode,
  type LayerOverrides,
  BUILT_IN_PRESETS,
  applyLayerOverrides,
  presetToConfig,
} from './features/blocks/renderPresets'
import {
  type ElevOverride,
  loadRenderPrefs,
  saveRenderPrefs,
} from './features/blocks/renderPrefs'
import {
  type UserPreset,
  deleteUserPreset,
  loadUserPresets,
  saveUserPreset,
} from './features/blocks/userPresets'
import {
  clearTextures,
  getTextureState,
} from './features/textures/textureLoader'
import { clearTextureAverages } from './features/textures/textureAverage'
import { textureDebugStore } from './features/textures/textureDebugStore'

import atlasIcon from './assets/atlas-icon.png'

const LAST_WORLD_KEY = 'atlas:lastWorldPath'

/** The side panels, which are mutually exclusive — at most one is open. */
type PanelId =
  | 'inspect'
  | 'debug'
  | 'search'
  | 'lootGames'
  | 'biomeSearch'
  | 'oreVeinSearch'

export default function App() {
  // Restore last session's world on startup so the loading screen runs immediately
  const [worldPath, setWorldPath] = useState<string | null>(() =>
    localStorage.getItem(LAST_WORLD_KEY)
  )
  const [dimensionPath, setDimensionPath] = useState<string | null>(null)
  // Only one side panel is open at a time, so a single "which one" beats a
  // boolean per panel that every toggle has to remember to clear.
  const [activePanel, setActivePanel] = useState<PanelId | null>(null)
  const inspectOpen = activePanel === 'inspect'
  const debugOpen = activePanel === 'debug'
  const searchOpen = activePanel === 'search'
  const lootGamesOpen = activePanel === 'lootGames'
  const biomeSearchOpen = activePanel === 'biomeSearch'
  const oreVeinSearchOpen = activePanel === 'oreVeinSearch'
  const closePanel = useCallback(() => setActivePanel(null), [])
  const togglePanel = (id: PanelId) =>
    setActivePanel((cur) => (cur === id ? null : id))
  const [heatmapOn, setHeatmapOn] = useState(false)
  const [gridOn, setGridOn] = useState(false)
  const [oreVeinsOn, setOreVeinsOn] = useState(false)
  // The ore the map overlay is narrowed to (null = every vein), driven by the
  // ore-vein search panel drilling into one ore.
  const [selectedVeinKind, setSelectedVeinKind] = useState<string | null>(null)
  const [infraViewOn, setInfraViewOn] = useState(false)
  // Texture diagnostics: magenta-flag blocks whose texture never resolved, and
  // reveal debug-only blocks. Used to ride on the `debug` render preset; now an
  // independent Debug-menu toggle so it composes with any preset. Session-only.
  const [diagnosticRender, setDiagnosticRender] = useState(false)
  // Infrastructure-View systems toggled off (empty = show all). Session-only.
  const [hiddenPipeSystems, setHiddenPipeSystems] = useState<Set<string>>(
    () => new Set()
  )
  // Include cables in the Infra network (off by default — cabling is noisiest).
  const [showInfraCables, setShowInfraCables] = useState(false)
  // The render view (preset + overrides) is restored from localStorage on startup
  // and written back on change (Stage 3.3), so a customized view sticks across sessions.
  const [selectedPresetId, setSelectedPresetId] = useState(
    () => loadRenderPrefs().presetId
  )
  const [elevOverride, setElevOverride] = useState<ElevOverride>(
    () => loadRenderPrefs().elevOverride
  )
  // User layer toggles that override the active preset's category visibility (3.1).
  const [layerOverrides, setLayerOverrides] = useState<LayerOverrides>(
    () => loadRenderPrefs().layerOverrides
  )

  useEffect(() => {
    saveRenderPrefs({
      presetId: selectedPresetId,
      elevOverride,
      layerOverrides,
    })
  }, [selectedPresetId, elevOverride, layerOverrides])

  // Named user presets (Stage 3.3) — saved snapshots of a render view. The map
  // engine lives inside WorldMap; this lifted ref lets us read the camera when
  // saving a view and move it when applying one.
  const [userPresets, setUserPresets] = useState(loadUserPresets)
  const engineRef = useRef<MapEngine | null>(null)
  const chunkStats = useChunkStats(dimensionPath ?? '')

  // Home waypoint (your base) for the current dimension: drives the map marker and
  // is the reference point search panels sort dungeons by distance from. The map
  // marker itself is restored inside the engine (WorldMap → initialHome); this
  // mirror in React state feeds the panels and the context-menu labels.
  const [homePos, setHomePos] = useState<HomePos | null>(null)
  useEffect(() => {
    setHomePos(dimensionPath ? loadHome(dimensionPath) : null)
  }, [dimensionPath])

  // Right-click context menu on the map. The engine reports the click via this
  // ref; App owns the menu so it can compose actions (set/clear home, inspect…).
  const [mapContext, setMapContext] = useState<MapContextInfo | null>(null)
  const mapContextRef = useRef<((info: MapContextInfo) => void) | null>(null)
  mapContextRef.current = setMapContext

  function setHomeHere() {
    if (!dimensionPath || !mapContext) return
    const pos = { x: mapContext.worldX, z: mapContext.worldZ }
    saveHome(dimensionPath, pos)
    setHomePos(pos)
    engineRef.current?.setHomeMarker(pos)
  }

  function clearHomeMarker() {
    if (!dimensionPath) return
    clearHome(dimensionPath)
    setHomePos(null)
    engineRef.current?.setHomeMarker(null)
  }

  function applyUserPreset(p: UserPreset) {
    setSelectedPresetId(p.presetId)
    setElevOverride(p.elevOverride)
    setLayerOverrides(p.layerOverrides)
    // Restore the saved location — but only in the dimension it was saved in,
    // since map coords are per-dimension. Views saved before 3.3.1 have no camera.
    if (p.camera && p.dimensionPath === dimensionPath) {
      engineRef.current?.setCamera(p.camera)
    }
  }

  // ── Data fetching ──────────────────────────────────────────────────────
  const {
    data: blockColors,
    isLoading: isScanning,
    isError: worldError,
  } = useBlockColors(worldPath)
  const { data: blockNames } = useBlockNames(worldPath)
  const { data: biomeNames } = useBiomeNames(worldPath)
  const { data: biomeColors } = useBiomeColors(worldPath)
  const { data: textureKeys } = useTextureKeys(worldPath)
  const { data: metaTextureKeys } = useMetaTextureKeys(worldPath)
  const { data: dimensions } = useDimensions(worldPath)
  const { data: regionData } = useRegions(dimensionPath ?? '')
  const { data: renderOverrides } = useRenderOverrides()

  // ── Render registry ────────────────────────────────────────────────────
  // Rebuilt when blockNames changes (new world = new FML ID mapping) or when the
  // user saves a render override (Stage 2.3) — the override wins over bundled rules.
  const registry = useMemo(
    () => createResolvedRegistry(blockNames, renderOverrides),
    [blockNames, renderOverrides]
  )

  // ── Render config ───────────────────────────────────────────────────────
  // Derived from the active preset plus per-session elevation / texture-filter overrides.
  const preset =
    BUILT_IN_PRESETS.find((p) => p.id === selectedPresetId) ??
    BUILT_IN_PRESETS[0]
  const config = useMemo(() => {
    const base = presetToConfig(preset)
    let elevationMode = base.elevationMode
    let elevationStrength = base.elevationStrength
    let contourMode = base.contourMode
    if (elevOverride !== 'preset') {
      const overrides: Record<string, [ElevationMode, number, ContourMode]> = {
        off: ['off', base.elevationStrength, 'off'],
        subtle: ['subtle', base.elevationStrength, 'off'],
        strong: ['strong', base.elevationStrength, 'off'],
        relief: ['strong', 1.5, 'normal'],
        heightmap: ['debug-heightmap', base.elevationStrength, 'off'],
        contours: ['off', base.elevationStrength, 'strong'],
      }
      const ov = overrides[elevOverride]
      if (ov) {
        elevationMode = ov[0]
        elevationStrength = ov[1]
        contourMode = ov[2]
      }
    }
    return {
      ...base,
      hiddenTags: applyLayerOverrides(base.hiddenTags, layerOverrides),
      elevationMode,
      elevationStrength,
      contourMode,
      infraView: infraViewOn,
      hiddenPipeSystems,
      showCables: showInfraCables,
      showDebugBlocks: diagnosticRender,
      showFallbackMagenta: diagnosticRender,
      // textureFilter is preset-owned (base already carries it) — there is no
      // user override. See RenderPreset.textureFilter for why JourneyMap uses
      // the crisp 'pixel' filter rather than the blurrier 'journeymap' one.
    }
  }, [
    preset,
    elevOverride,
    layerOverrides,
    infraViewOn,
    hiddenPipeSystems,
    showInfraCables,
    diagnosticRender,
  ])

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

  // The tools row only appears once the map is actually on screen. Every control
  // in it either renders into the map or opens a panel beside it (the panels are
  // rendered in the map branch below), so showing a partially-populated bar over
  // the loading screen or the dimension picker offers nothing but dead buttons.
  const mapReady = !!dimensionPath && loadingStage === null

  // Poll mod-JAR scan progress only while the scanning stage is on screen.
  const { data: scanProgress } = useScanProgress(
    worldPath,
    loadingStage === 'scanning'
  )

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
      `[atlas:textures] ${tex.loaded} / ${total} loaded, ${tex.missing} missing`
    )
    if (debugOpen) {
      console.group(
        '[atlas:debug] Texture preload complete — missing mappings:'
      )
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
      clearTextures()
      clearTextureAverages()
      setWorldPath(null)
      setDimensionPath(null)
    }
  }, [worldError])

  // ── World picker handlers ──────────────────────────────────────────────
  function handleWorldSelected(path: string) {
    localStorage.setItem(LAST_WORLD_KEY, path)
    textureDebugStore.clear()
    clearTextures()
    clearTextureAverages()
    setWorldPath(path)
    setDimensionPath(null)
    closePanel()
  }

  function handleCloseWorld() {
    localStorage.removeItem(LAST_WORLD_KEY)
    textureDebugStore.clear()
    clearTextures()
    clearTextureAverages()
    setWorldPath(null)
    setDimensionPath(null)
    closePanel()
  }

  function handleSelectDimension(dim: DimensionInfo) {
    setDimensionPath(dim.path)
  }

  // Per-chunk heatmap overlay (Stage 5 stats prototype) — an independent map layer.
  // Metric: machine/infrastructure density (GT machines + casings + tagged
  // pipes/cables), so factories light up and natural terrain stays unpainted.
  function handleToggleHeatmap() {
    if (heatmapOn) {
      setHeatmapOn(false)
      engineRef.current?.setHeatmap(null)
      return
    }
    const ids = new Set<number>(
      registry.hiddenTaggedIds(new Set(['pipe', 'cable', 'machine']))
    )
    if (blockNames) {
      for (const [id, name] of Object.entries(blockNames)) {
        if (/gt\.blockmachines|gt\.blockcasings/i.test(name))
          ids.add(Number(id))
      }
    }
    setHeatmapOn(true)
    chunkStats.mutate(
      { metric: 'density', ids: [...ids] },
      {
        onSuccess: (d) =>
          engineRef.current?.setHeatmap({
            cells: d.cells,
            vmin: d.vmin,
            vmax: d.vmax,
          }),
        onError: () => setHeatmapOn(false),
      }
    )
  }

  // The heatmap's cell data is computed per-dimension and fed straight into the
  // engine (never held in React state), so it can't be re-pushed onto the fresh
  // engine WorldMap builds on a dimension change. Clear it instead: the new
  // engine starts with no heatmap, and resetting heatmapOn keeps the lit button
  // in sync. (Also tidies up when the world closes: dimensionPath → null.)
  useEffect(() => {
    setHeatmapOn(false)
  }, [dimensionPath])

  // Chunk/region reference grid + coordinate labels (Stage 5).
  function handleToggleGrid() {
    setGridOn((o) => !o)
  }

  // Reconcile the grid overlay to the engine (mirrors oreVeinsOn below). The
  // engine is recreated on a dimension change (WorldMap keys it on dimensionPath)
  // and defaults grid to off, so a bare imperative push in the handler would
  // leave the lit button and GridLabels disagreeing with the faint default grid
  // until toggled twice. Keying on dimensionPath re-pushes the state onto each
  // new engine; WorldMap (a child) rebuilds the engine before this parent effect
  // runs, so engineRef already points at the new one.
  useEffect(() => {
    engineRef.current?.setGrid(gridOn)
  }, [gridOn, dimensionPath])

  // Ore-vein overlay (from Visual Prospecting). Fetched lazily — once the overlay
  // is toggled on, or the search panel opens to browse the veins with the overlay
  // still off. The effect below pushes the dots into the engine once data arrives.
  const oreVeins = useOreVeins(dimensionPath, oreVeinsOn || oreVeinSearchOpen)
  const oreVeinViews = useMemo<OreVeinView[]>(() => {
    if (!oreVeins.data) return []
    return oreVeins.data.veins.map((v) => {
      const { name, color } = veinDisplay(v.kind, v.name, v.rgb)
      return {
        x: v.x,
        z: v.z,
        kind: v.kind,
        name,
        color,
        depleted: v.depleted,
        spriteKey: v.texture ?? undefined,
      }
    })
  }, [oreVeins.data])
  // What the map draws: every vein, or just the ore the search panel drilled into.
  const visibleVeins = useMemo<OreVeinView[]>(
    () =>
      selectedVeinKind
        ? oreVeinViews.filter((v) => v.kind === selectedVeinKind)
        : oreVeinViews,
    [oreVeinViews, selectedVeinKind]
  )
  // Ore-overlay sprites (base64 PNG → data URL), keyed by the vein `texture`; the
  // engine tints each by the vein colour. Empty on an old (pre-sprite) dump.
  const veinSprites = useMemo<Record<string, string>>(() => {
    const raw = oreVeins.data?.sprites
    if (!raw) return {}
    const out: Record<string, string> = {}
    for (const [key, b64] of Object.entries(raw)) {
      out[key] = `data:image/png;base64,${b64}`
    }
    return out
  }, [oreVeins.data])
  // Sprite keys whose art is already coloured (gold/iron/…): the map marker draws
  // them as-is (white tint = identity) rather than multiplying by the material rgb.
  const veinPrecolored = useMemo(
    () => new Set(oreVeins.data?.sprites_precolored ?? []),
    [oreVeins.data]
  )
  useEffect(() => {
    engineRef.current?.setOreVeins(
      oreVeinsOn
        ? visibleVeins.map((v) => ({
            ...v,
            // Pre-coloured sprites keep their own colour; grayscale sprites (and the
            // no-sprite fallback dot) tint by the material colour. Labels use the
            // material colour regardless (OreVeinView.color, untouched here).
            color:
              v.spriteKey && veinPrecolored.has(v.spriteKey)
                ? '#ffffff'
                : v.color,
          }))
        : null,
      veinSprites
    )
  }, [oreVeinsOn, visibleVeins, veinSprites, veinPrecolored])

  // Drilling into an ore narrows the map to it — and turns the overlay on, since a
  // list of veins over an empty map (and a jump landing on nothing) is no use.
  const handleSelectVeinKind = useCallback((kind: string | null) => {
    setSelectedVeinKind(kind)
    if (kind) setOreVeinsOn(true)
  }, [])

  // Map coords are per-dimension, so a filter pinned to one dimension's ore has no
  // meaning in the next — and WorldMap rebuilds the engine on the change anyway.
  useEffect(() => {
    setSelectedVeinKind(null)
  }, [dimensionPath])

  // Infrastructure View (Stage 5): draw pipe/cable runs as a connected network.
  // It's a render-config flag, so the map re-renders chunks when it flips.
  function handleToggleInfra() {
    setInfraViewOn((o) => !o)
  }

  // Pipe/cable systems present in this world (by mod), for the Infra per-system
  // filter — derived from the pipe/cable-tagged blocks in the registry.
  const pipeSystems = useMemo(() => {
    if (!blockNames) return []
    const set = new Set<string>()
    for (const id of registry.hiddenTaggedIds(new Set(['pipe', 'cable']))) {
      set.add(pipeSystemName(blockNames[id]))
    }
    return [...set].sort()
  }, [registry, blockNames])

  function handleToggleInfraSystem(system: string, show: boolean) {
    setHiddenPipeSystems((prev) => {
      const next = new Set(prev)
      if (show) next.delete(system)
      else next.add(system)
      return next
    })
  }

  function handleToggleInfraCables() {
    setShowInfraCables((o) => !o)
  }

  // Paint the map highlight over the exact blocks the current search matched
  // (Stage 5). Stable so the SearchPanel effect driving it doesn't re-fire.
  const handleSearchHighlight = useCallback((columns: BlockColumn[] | null) => {
    engineRef.current?.setSearchHighlight(columns)
  }, [])

  // Outline a searched biome region (translucent fill + border) over its chunks;
  // `pulse` animates the glow on hover. Stable so the BiomeSearchPanel effect
  // driving it doesn't re-fire.
  const handleBiomeHighlight = useCallback(
    (chunks: ChunkCoord[] | null, pulse?: boolean) => {
      engineRef.current?.setBiomeHighlight(chunks, pulse)
    },
    []
  )

  // Fly to frame a biome region's full extent (so its highlight fills the view).
  const handleFrameBounds = useCallback(
    (bounds: { minX: number; minZ: number; maxX: number; maxZ: number }) => {
      engineRef.current?.animateCameraToBounds(bounds)
    },
    []
  )

  // ── InspectPanel: pass textureKeys for accurate source classification ──
  // We also compute the effective texture key per block-id here so InspectPanel
  // can show 'texture' only for blocks that truly have a PNG key (not just a
  // vanilla fallback color from _VANILLA_COLORS).
  const textureKeysForInspect = useMemo<Record<number, string> | undefined>(
    () => textureKeys,
    [textureKeys]
  )

  return (
    <div className="flex h-screen flex-col bg-atlas-bg text-zinc-100">
      <MenuBar
        worldPath={worldPath}
        onWorldSelected={handleWorldSelected}
        onCloseWorld={handleCloseWorld}
        view={
          mapReady
            ? {
                selectedPresetId,
                onSetPreset: setSelectedPresetId,
                elevOverride,
                onSetElevOverride: setElevOverride,
                layerOverrides,
                onSetLayer: (tag, show) =>
                  setLayerOverrides((prev) => ({ ...prev, [tag]: show })),
                onResetLayers: () => setLayerOverrides({}),
              }
            : undefined
        }
        overlays={
          mapReady
            ? {
                items: {
                  grid: { on: gridOn, onToggle: handleToggleGrid },
                  oreVeins: {
                    on: oreVeinsOn,
                    loading: oreVeins.isFetching,
                    onToggle: () => setOreVeinsOn((o) => !o),
                  },
                  heatmap: {
                    on: heatmapOn,
                    loading: chunkStats.isPending,
                    onToggle: handleToggleHeatmap,
                  },
                  infra: { on: infraViewOn, onToggle: handleToggleInfra },
                },
                infraDetail: {
                  systems: pipeSystems,
                  hidden: hiddenPipeSystems,
                  onToggleSystem: handleToggleInfraSystem,
                  showCables: showInfraCables,
                  onToggleCables: handleToggleInfraCables,
                },
              }
            : undefined
        }
        search={
          mapReady
            ? {
                search: {
                  open: searchOpen,
                  onSelect: () => togglePanel('search'),
                },
                lootGames: {
                  open: lootGamesOpen,
                  onSelect: () => togglePanel('lootGames'),
                },
                biomeSearch: {
                  open: biomeSearchOpen,
                  onSelect: () => togglePanel('biomeSearch'),
                },
                oreVeinSearch: {
                  open: oreVeinSearchOpen,
                  onSelect: () => togglePanel('oreVeinSearch'),
                },
              }
            : undefined
        }
        saved={
          mapReady
            ? {
                userPresets,
                onSavePreset: (name) => {
                  // Capture the current map location + zoom so the view is a
                  // location bookmark, not just a render-settings snapshot.
                  const vp = engineRef.current?.getViewport()
                  setUserPresets(
                    saveUserPreset({
                      name,
                      presetId: selectedPresetId,
                      elevOverride,
                      layerOverrides,
                      camera: vp
                        ? { cx: vp.cx, cz: vp.cz, scale: vp.scale }
                        : undefined,
                      dimensionPath: dimensionPath ?? undefined,
                    })
                  )
                },
                onApplyPreset: applyUserPreset,
                onDeletePreset: (id) => setUserPresets(deleteUserPreset(id)),
              }
            : undefined
        }
        debug={
          mapReady
            ? {
                inspectOpen,
                onToggleInspect: () => togglePanel('inspect'),
                debugOpen,
                onToggleDebug: () => togglePanel('debug'),
                diagnosticRender,
                onToggleDiagnosticRender: () => setDiagnosticRender((o) => !o),
              }
            : undefined
        }
      />

      {!worldPath ? (
        /* ── No world selected ── */
        <div className="flex flex-1 flex-col items-center justify-center px-6">
          <img
            src={atlasIcon}
            alt=""
            width={112}
            height={112}
            className="mb-6 h-28 w-28 select-none drop-shadow-[0_12px_32px_rgba(52,211,153,0.18)]"
            draggable={false}
          />
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-100">
            Atlas GTNH
          </h1>
          {/* No dash: at this width the wrap orphaned it onto the next line,
              and a dash should never open a line. `text-balance` also evens the
              two lines out instead of leaving a long one over a short one. */}
          <p className="mb-7 mt-2 max-w-sm text-balance text-center text-sm text-zinc-500">
            Open a GregTech: New Horizons save and explore it as a map, without
            launching the game.
          </p>
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
              biomeColors={biomeColors}
              textureKeys={textureKeys}
              metaTextureKeys={metaTextureKeys}
              worldPath={worldPath ?? undefined}
              blockNames={blockNames}
              registry={registry}
              config={config}
              debugMode={debugOpen}
              engineRef={engineRef}
              onMapContextRef={mapContextRef}
            />
            {gridOn && <GridLabels engineRef={engineRef} />}
            {oreVeinsOn && (
              <OreVeinLabels engineRef={engineRef} veins={visibleVeins} />
            )}
            {oreVeinsOn &&
              oreVeins.data &&
              oreVeins.data.veins.length === 0 && (
                <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-lg border border-zinc-800 bg-atlas-bar/90 px-3 py-2 text-xs text-zinc-300 backdrop-blur">
                  {oreVeins.data.available
                    ? 'No ore veins cached here yet — explore/prospect in-game, or run Visual Prospecting’s vein cache.'
                    : 'No Visual Prospecting data for this world.'}
                </div>
              )}
            <DumpMismatchBanner worldPath={worldPath} />
            {mapContext && (
              <MapContextMenu
                x={mapContext.screenX}
                y={mapContext.screenY}
                items={[
                  {
                    label: homePos ? 'Move home here' : 'Set home here',
                    icon: <Home className="h-3.5 w-3.5 shrink-0" aria-hidden />,
                    onClick: setHomeHere,
                  },
                  ...(homePos
                    ? [
                        {
                          label: 'Clear home',
                          icon: (
                            <Trash2
                              className="h-3.5 w-3.5 shrink-0"
                              aria-hidden
                            />
                          ),
                          onClick: clearHomeMarker,
                          danger: true,
                        },
                      ]
                    : []),
                  {
                    label: 'Inspect block',
                    icon: (
                      <Search className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    ),
                    onClick: () => engineRef.current?.inspectAt(),
                  },
                ]}
                onClose={() => setMapContext(null)}
              />
            )}
          </div>

          {/* Inspect panel */}
          {inspectOpen &&
            (blockColors && blockNames ? (
              <InspectPanel
                blockColors={blockColors}
                blockNames={blockNames}
                textureKeys={textureKeysForInspect}
                onClose={closePanel}
              />
            ) : (
              <div className="flex h-full w-96 shrink-0 flex-col items-center justify-center gap-1.5 border-l border-zinc-800 bg-zinc-950 text-xs text-zinc-500">
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                Loading block data…
              </div>
            ))}

          {/* Texture debug panel */}
          {debugOpen && (
            <TextureDebugPanel
              worldPath={worldPath ?? undefined}
              registry={registry}
              onClose={closePanel}
            />
          )}

          {/* Block search panel */}
          {searchOpen && dimensionPath && blockNames && (
            <SearchPanel
              blockNames={blockNames}
              dimensionPath={dimensionPath}
              home={homePos}
              onJump={(x, z) =>
                engineRef.current?.animateCameraTo({
                  cx: x,
                  cz: z,
                  scale: VIEWER_CONFIG.maxScale,
                })
              }
              onHighlight={handleSearchHighlight}
              onClose={closePanel}
            />
          )}

          {/* LootGames dungeon locator */}
          {lootGamesOpen && dimensionPath && blockNames && (
            <LootGamesPanel
              blockNames={blockNames}
              dimensionPath={dimensionPath}
              home={homePos}
              onJump={(x, z) =>
                engineRef.current?.animateCameraTo({
                  cx: x,
                  cz: z,
                  scale: VIEWER_CONFIG.maxScale,
                })
              }
              onHighlight={handleSearchHighlight}
              onClose={closePanel}
            />
          )}

          {/* Biome search panel */}
          {biomeSearchOpen && dimensionPath && (
            <BiomeSearchPanel
              biomeNames={biomeNames ?? {}}
              dimensionPath={dimensionPath}
              home={homePos}
              onFrame={handleFrameBounds}
              onHighlight={handleBiomeHighlight}
              onClose={closePanel}
            />
          )}

          {/* Ore vein search panel */}
          {oreVeinSearchOpen && dimensionPath && (
            <OreVeinSearchPanel
              veins={oreVeinViews}
              loading={oreVeins.isPending}
              available={oreVeins.data?.available ?? false}
              overlayOn={oreVeinsOn}
              onToggleOverlay={() => setOreVeinsOn((o) => !o)}
              selectedKind={selectedVeinKind}
              onSelectKind={handleSelectVeinKind}
              home={homePos}
              onJump={(x, z) =>
                engineRef.current?.animateCameraTo({
                  cx: x,
                  cz: z,
                  scale: VIEWER_CONFIG.maxScale,
                })
              }
              onClose={closePanel}
            />
          )}
        </div>
      )}
    </div>
  )
}
