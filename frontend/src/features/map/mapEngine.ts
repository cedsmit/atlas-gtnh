/**
 * The world-map rendering engine: owns the chunk/region caches, the tile
 * scheduler, LOD, and the RAF loop, rendering through a MapScene. Created once
 * per dimension by the WorldMap component (given a deps object of live refs) and
 * torn down via dispose(). Living outside React is the seam where future data
 * ops (chunk copy/paste, regeneration) and a 3D view can slot in.
 */
import type { MutableRefObject } from 'react'
import * as THREE from 'three'

import type { BlockColorMap } from '../blocks/api/blockColors'
import type { ChunkData } from './api/chunks'
import { fetchChunkBatch } from './api/chunks'
import type { RegionSummary, RegionSurface } from './api/regions'
import { fetchRegionSurface } from './api/regions'
import { renderRegionTile } from './regionTileRenderer'
import { TileImageCache } from './tileImageCache'
import { VIEWER_CONFIG } from './viewerConfig'
import { collectStaleChunks } from './staleChunks'
import { flyDuration } from './flyDuration'
import { textureDebugStore } from '../textures/textureDebugStore'
import type { BlockRenderRegistry } from '../blocks/blockRenderRegistry'
import type { RenderConfig, TextureFilter } from '../blocks/renderPresets'
import { onTextureLoad } from '../textures/textureLoader'
import {
  canvasDiagnostics,
  computeEdgeHeights,
  computeEdgePipes,
  makeChunkTexture,
  renderChunkImage,
  upscaleCanvas,
  type NeighborHeights,
  type NeighborPipes,
} from './chunkTileRenderer'
import { ChunkOutlineOverlay, type ChunkOutlineState } from './chunkOutline'
import { showBlockInspector } from './blockInspector'
import { attachMapInput } from './mapInput'
import { MapScene } from './mapScene'
import type { SavedView } from './lastView'
import type { HomePos } from './homeWaypoint'

const {
  minScale: MIN_SCALE,
  maxScale: MAX_SCALE,
  chunkLodScale: CHUNK_LOD_SCALE,
  chunkPreloadMargin: CHUNK_PRELOAD_MARGIN,
  chunkEvictMargin: CHUNK_EVICT_MARGIN,
  maxLiveChunksPixel: MAX_LIVE_CHUNKS_PIXEL,
  maxLiveChunksJourneymap: MAX_LIVE_CHUNKS_JOURNEYMAP,
  maxRegionTiles: MAX_REGION_TILES,
  tileCacheMax: TILE_CACHE_MAX,
  batchSize: BATCH_SIZE,
  maxConcurrentBatches: MAX_CONCURRENT_BATCHES,
  maxConcurrentRegionFetches: MAX_CONCURRENT_REGION_FETCHES,
  renderBudgetMs: RENDER_BUDGET_MS,
  animRenderBudgetMs: ANIM_RENDER_BUDGET_MS,
} = VIEWER_CONFIG

/** A right-click on the map: viewport pixel position + the world block under it. */
export interface MapContextInfo {
  screenX: number
  screenY: number
  worldX: number
  worldZ: number
}

interface MapEngineDeps {
  container: HTMLDivElement
  hud: HTMLDivElement
  inspector: HTMLDivElement
  dimensionPath: string
  configRef: MutableRefObject<RenderConfig>
  debugModeRef: MutableRefObject<boolean>
  bcCountRef: MutableRefObject<number>
  blockColorsRef: MutableRefObject<BlockColorMap | undefined>
  textureKeysRef: MutableRefObject<Record<number, string> | undefined>
  metaTextureKeysRef: MutableRefObject<Record<string, string> | undefined>
  blockNamesRef: MutableRefObject<Record<number, string> | undefined>
  registryRef: MutableRefObject<BlockRenderRegistry>
  regionsRef: MutableRefObject<RegionSummary[]>
  syncRegionsRef: MutableRefObject<(() => void) | null>
  fitCameraRef: MutableRefObject<(() => void) | null>
  // Right-click handler: when set, the map opens this (a context menu) instead of
  // the block inspector, handing over the click position + world block. When
  // absent (standalone WorldMap), right-click falls back to the inspector.
  onContextRef?: MutableRefObject<((info: MapContextInfo) => void) | null>
  // Last camera for this dimension: restored instead of fitting on first load.
  initialView?: SavedView | null
  // Home waypoint for this dimension: rendered as a marker on first load.
  initialHome?: HomePos | null
}

export class MapEngine {
  private _cleanup!: () => void
  private _st!: {
    cam: { cx: number; cz: number; scale: number }
    forceFrame: boolean
    camAnim: {
      fromCx: number
      fromCz: number
      fromScale: number
      toCx: number
      toCz: number
      toScale: number
      start: number
      duration: number
    } | null
    biomePulse: boolean
    biomeFillMat: THREE.MeshBasicMaterial | null
    biomeBorderMat: THREE.LineBasicMaterial | null
    baseCursor: string
    isDragging: boolean
  }
  private _mapScene!: MapScene
  private _getDims!: () => { w: number; h: number }
  private _heatmap: THREE.Mesh | null = null
  private _highlight: THREE.Group | null = null
  private _homeMarker: THREE.Mesh | null = null
  private _biomeHighlight: THREE.Group | null = null
  private _oreVeins: THREE.Group | null = null
  /** Run the block inspector for the last right-clicked point. Set in constructor. */
  inspectAt!: () => void
  /** Drop cached state for the given chunks so the map re-fetches/redraws them
   *  live (e.g. after a delete), without a full reload. Set in the constructor. */
  invalidateChunks!: (chunks: [number, number][]) => void
  /** Re-fetch/redraw the whole visible map (chunks + region tiles) live, e.g.
   *  after a bulk delete-except. Keeps the current camera. Set in constructor. */
  refreshView!: () => void

  constructor(deps: MapEngineDeps) {
    const {
      container,
      hud,
      inspector,
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
      onContextRef,
      initialView,
      initialHome,
    } = deps

    inspector.addEventListener('mousedown', (e) => e.stopPropagation())

    // One-shot: on the first sync that has regions, restore the saved camera
    // (resume where the user left off) instead of fitting the whole world.
    let restorePending = !!initialView

    // Set in cleanup; async continuations (fetches, createImageBitmap) check it
    // so they don't write to torn-down state after unmount / dimension change.
    let destroyed = false
    // Aborted on teardown so in-flight chunk/region requests stop downloading
    // and decoding for an engine nobody is looking at any more. Deliberately not
    // aborted on pan: that data is still cached and useful when you pan back.
    const inFlight = new AbortController()
    // Trailing-debounce timer: refresh the overview tiles once texture loading
    // quiesces (they colour blocks from texture averages — see regionRestale).
    let regionRelodTimer: ReturnType<typeof setTimeout> | null = null

    let W = container.clientWidth || 800
    let H = container.clientHeight || 600

    const st = {
      cam: { cx: 0, cz: 0, scale: 1 },
      // Active camera fly-to (search jump / bookmark); the loop interpolates it.
      camAnim: null as null | {
        fromCx: number
        fromCz: number
        fromScale: number
        toCx: number
        toCz: number
        toScale: number
        start: number
        duration: number
      },
      // Biome-highlight pulse: when pulsing, the loop oscillates the overlay's
      // fill/border opacity (glow) and keeps rendering; steady = fixed opacity.
      biomePulse: false,
      biomeFillMat: null as THREE.MeshBasicMaterial | null,
      biomeBorderMat: null as THREE.LineBasicMaterial | null,
      cache: new Map<string, 'empty' | 'error' | THREE.Mesh>(),
      dataCache: new Map<string, ChunkData>(),
      texVersion: 0,
      texVersionAtRender: new Map<string, number>(),
      // Rendered chunks whose edge shading is stale because a neighbor's block
      // data arrived after they were drawn. Re-rendered in the frame loop.
      shadeStale: new Set<string>(),
      // Rendered chunks drawn before the current texVersion. Derived once per
      // texVersion bump rather than by re-scanning the whole cache every frame:
      // texVersion is > 0 from the first loaded texture onward, so a
      // `texVersion > 0` guard would never actually gate anything.
      texStale: new Set<string>(),
      texStaleDirty: false,
      lastBcCount: 0,
      lastConfig: null as RenderConfig | null,
      lastDebugMode: false,
      chunkPixels: new Map<string, number>(),
      resolving: new Set<string>(),
      pendingSet: new Set<string>(),
      pending: [] as Array<[number, number, string]>,
      // Chunks awaiting time-sliced placement: either freshly fetched (data) or
      // restored from the CPU tile cache (bitmap).
      renderQueue: [] as Array<{
        key: string
        mcx: number
        mcz: number
        data?: ChunkData
        bitmap?: ImageBitmap
      }>,
      renderSet: new Set<string>(),
      sorted: [] as [number, number][],
      sortBounds: null as { L: number; R: number; T: number; B: number } | null,
      activeBatches: 0,
      liveChunks: 0, // count of chunk meshes currently in the scene (GPU budget)
      // ── Region-tile LOD (zoomed-out overview) ──
      regionTiled: new Set<string>(), // regions with a rendered tile applied
      regionFailed: new Set<string>(), // empty/error regions — don't retry
      regionResolving: new Set<string>(), // surface fetch in flight
      regionPending: [] as Array<[number, number, string]>,
      regionPendingSet: new Set<string>(),
      regionRenderQueue: [] as Array<{
        key: string
        rx: number
        rz: number
        surface: RegionSurface
      }>,
      regionRenderSet: new Set<string>(),
      // Tiled regions queued for an in-place re-render because textures they
      // colour from finished loading after the tile was first drawn.
      regionRestale: new Set<string>(),
      activeRegionFetches: 0,
      // Bumped only on colour-map / render-config changes (not texture loads), so
      // region tiles re-render when the look changes without thrashing on every
      // texture that streams in.
      lodVersion: 0,
      regionLodVersion: 0,
      // Block ids dropped from the overview so it shows the terrain beneath them:
      // invisible 'ignore' blocks, preset-hidden overlays (torch/rail/redstone),
      // and plants (unless highlightPlants). Recomputed when the registry or
      // config changes; sent to the surface fetch.
      surfaceSkipIds: [] as number[],
      surfaceSkipCsv: '',
      lastRegistryForSkip: null as BlockRenderRegistry | null,
      lastConfigForSkip: null as RenderConfig | null,
      regionSet: new Set<string>(),
      baseCursor: 'grab', // what a released drag returns to; see setCursor
      isDragging: false,
      lastMouse: null as { x: number; y: number } | null,
      mouseWorldX: null as number | null,
      mouseWorldZ: null as number | null,
      firstChunkLogged: false,
      // ── Render gate ── skip the RAF heavy passes + GPU draw when the view is
      // idle (camera still, nothing loading, no re-render pending).
      lastCam: { cx: NaN, cz: NaN, scale: NaN },
      forceFrame: true, // one-shot: force a render next frame
      staleWork: false, // chunk re-renders still catching up to texVersion
      lastTexKeysRef: undefined as Record<number, string> | undefined,
      texKeyCount: 0, // cached for the HUD (no per-frame Object.keys)
      lastHud: '', // last HUD string (skip redundant DOM writes)
    }

    const unsubTextures = onTextureLoad(() => {
      st.texVersion++
      st.texStaleDirty = true
      st.forceFrame = true
      // Overview tiles colour blocks from texture averages, so they need a
      // refresh as textures stream in. Debounce on the trailing edge: re-render
      // the visible overview once loading has been quiet for a moment, instead
      // of thrashing on every batch (and avoiding a flash during the initial
      // burst — tiles keep their current colours until the refresh completes).
      if (regionRelodTimer !== null) clearTimeout(regionRelodTimer)
      regionRelodTimer = setTimeout(() => {
        regionRelodTimer = null
        if (destroyed) return
        for (const key of st.regionTiled) st.regionRestale.add(key)
        st.forceFrame = true
      }, 800)
    })

    const mapScene = new MapScene(container, W, H)
    const { scene, chunkGeo, regionGeo, regionMat, chunkGroup } = mapScene
    const updateCam = () => mapScene.updateCam(st.cam, W, H)
    const updateGrid = () => mapScene.updateGrid(st.cam, W, H)
    const outlines = new ChunkOutlineOverlay(scene)
    const regionMeshes = new Map<string, THREE.Mesh>()
    // CPU cache of rendered chunk tiles, demoted from the GPU on eviction.
    const tileCache = new TileImageCache(TILE_CACHE_MAX)

    function clearChunkCache() {
      for (const entry of st.cache.values()) {
        if (entry instanceof THREE.Mesh) {
          chunkGroup.remove(entry)
          ;(entry.material as THREE.MeshBasicMaterial).map?.dispose()
          ;(entry.material as THREE.MeshBasicMaterial).dispose()
        }
      }
      outlines.clear()
      st.chunkPixels.clear()
      st.cache.clear()
      st.texVersionAtRender.clear()
      st.texStale.clear()
      st.resolving.clear()
      st.pendingSet.clear()
      st.pending.length = 0
      for (const item of st.renderQueue) item.bitmap?.close() // orphaned restores
      st.renderQueue.length = 0
      st.renderSet.clear()
      st.activeBatches = 0
      st.liveChunks = 0
      tileCache.clear()
    }

    function fitCamera(force = false) {
      const regs = regionsRef.current
      if (regs.length === 0) return

      // Resume the saved camera for this dimension on first load, rather than
      // fitting the whole world. A user-triggered fit (force) always overrides.
      if (!force && restorePending && initialView) {
        restorePending = false
        st.cam.cx = initialView.cx
        st.cam.cz = initialView.cz
        st.cam.scale = Math.max(
          MIN_SCALE,
          Math.min(MAX_SCALE, initialView.scale)
        )
        updateCam()
        return
      }
      restorePending = false // a real fit also cancels any pending restore

      // Compute median X and Z so a single distant outlier region (e.g. a mod dimension
      // that wrote chunks at extreme coordinates) cannot pull the initial view off into space.
      const xs = regs.map((r) => r.region_x).sort((a, b) => a - b)
      const zs = regs.map((r) => r.region_z).sort((a, b) => a - b)
      const mid = Math.floor(xs.length / 2)
      const medX = xs.length % 2 === 0 ? (xs[mid - 1] + xs[mid]) / 2 : xs[mid]
      const medZ = zs.length % 2 === 0 ? (zs[mid - 1] + zs[mid]) / 2 : zs[mid]

      // Drop regions more than 200 region-units (~100 km) from the median.
      // This removes genuine outliers while preserving any legitimately large world.
      const MAX_DIST = 200
      const core = regs.filter(
        (r) =>
          Math.abs(r.region_x - medX) <= MAX_DIST &&
          Math.abs(r.region_z - medZ) <= MAX_DIST
      )
      const active = core.length > 0 ? core : regs

      let minX = Infinity,
        maxX = -Infinity,
        minZ = Infinity,
        maxZ = -Infinity
      for (const r of active) {
        if (r.region_x < minX) minX = r.region_x
        if (r.region_x > maxX) maxX = r.region_x
        if (r.region_z < minZ) minZ = r.region_z
        if (r.region_z > maxZ) maxZ = r.region_z
      }
      st.cam.cx = ((minX + maxX) / 2) * 512 + 256
      st.cam.cz = ((minZ + maxZ) / 2) * 512 + 256
      const worldW = (maxX - minX + 1) * 512
      const worldH = (maxZ - minZ + 1) * 512
      st.cam.scale = Math.max(MIN_SCALE, Math.min(W / worldW, H / worldH, 2))
      updateCam()
    }

    function syncRegions() {
      for (const [key, m] of regionMeshes) {
        revertRegionTile(key, m) // dispose any per-region tile material
        scene.remove(m)
      }
      regionMeshes.clear()
      st.regionSet.clear()
      clearChunkCache()
      clearRegionTiles()

      for (const r of regionsRef.current) {
        const key = `${r.region_x},${r.region_z}`
        st.regionSet.add(key)
        const mesh = new THREE.Mesh(regionGeo, regionMat)
        mesh.position.set(r.region_x * 512 + 256, -(r.region_z * 512 + 256), -1)
        scene.add(mesh)
        regionMeshes.set(key, mesh)
      }
      fitCamera()
      st.forceFrame = true // region meshes changed — render even if fitCamera no-ops
    }

    syncRegionsRef.current = syncRegions
    fitCameraRef.current = () => fitCamera(true) // the fit button always fits
    syncRegions()

    // ── Cross-chunk shading support ──
    // Edge heights of the four adjacent chunks (when their data is cached) so
    // elevation shading and contours are seamless across chunk borders.
    function neighborHeightsFor(mcx: number, mcz: number): NeighborHeights {
      const reg = registryRef.current
      const cfg = configRef.current
      const n = st.dataCache.get(`${mcx},${mcz - 1}`)
      const s = st.dataCache.get(`${mcx},${mcz + 1}`)
      const w = st.dataCache.get(`${mcx - 1},${mcz}`)
      const e = st.dataCache.get(`${mcx + 1},${mcz}`)
      return {
        n: n ? computeEdgeHeights(n, 'n', reg, cfg) : null,
        s: s ? computeEdgeHeights(s, 's', reg, cfg) : null,
        w: w ? computeEdgeHeights(w, 'w', reg, cfg) : null,
        e: e ? computeEdgeHeights(e, 'e', reg, cfg) : null,
      }
    }

    // Pipe/cable presence of the four adjacent chunks' facing edges (when their
    // data is cached), so Infrastructure-View network connectors join across
    // chunk borders. Only computed when infra view is on (see the call sites).
    function neighborPipesFor(mcx: number, mcz: number): NeighborPipes {
      const reg = registryRef.current
      const cfg = configRef.current
      const names = blockNamesRef.current
      const n = st.dataCache.get(`${mcx},${mcz - 1}`)
      const s = st.dataCache.get(`${mcx},${mcz + 1}`)
      const w = st.dataCache.get(`${mcx - 1},${mcz}`)
      const e = st.dataCache.get(`${mcx + 1},${mcz}`)
      return {
        n: n ? computeEdgePipes(n, 'n', reg, cfg, names) : null,
        s: s ? computeEdgePipes(s, 's', reg, cfg, names) : null,
        w: w ? computeEdgePipes(w, 'w', reg, cfg, names) : null,
        e: e ? computeEdgePipes(e, 'e', reg, cfg, names) : null,
      }
    }

    // Mark already-rendered neighbors of a freshly-arrived chunk for a shading
    // re-render (their shared edge was drawn without this chunk's heights).
    // Only neighbors with cached block data are marked — bitmap-restored tiles
    // can't re-render in place, and dropping them would cascade refetches.
    function markNeighborsShadeStale(mcx: number, mcz: number) {
      for (const [dx, dz] of [
        [0, -1],
        [0, 1],
        [-1, 0],
        [1, 0],
      ] as const) {
        const nk = `${mcx + dx},${mcz + dz}`
        if (
          st.dataCache.has(nk) &&
          st.cache.get(nk) instanceof THREE.Mesh &&
          !st.renderSet.has(nk)
        ) {
          st.shadeStale.add(nk)
        }
      }
      if (st.shadeStale.size > 0) st.staleWork = true
    }

    // ── Chunk rendering (time-sliced; called from the RAF loop) ──
    // Paints one fetched chunk's canvas, uploads it, and places its mesh.
    // Heavy: capped per frame by the loop so a burst of arrivals doesn't stall.
    function renderAndPlaceChunk(
      key: string,
      mcx: number,
      mcz: number,
      data: ChunkData
    ) {
      const dbg = debugModeRef.current
      st.renderSet.delete(key)

      if (!st.firstChunkLogged) {
        st.firstChunkLogged = true
        const s0 = data.sections[0]
        const nonzero = s0 ? s0.blocks.filter((b) => b !== 0).length : 0
        console.log(
          `[atlas] first chunk ${mcx},${mcz}: ${data.sections.length} sections, ` +
            `section[0].y=${s0?.y}, nonzero=${nonzero}`
        )
      }
      if (dbg) {
        const s0 = data.sections[0]
        console.log(
          `[atlas:chunk] parsed    ${mcx},${mcz}` +
            ` — ${data.sections.length} sections` +
            ` biomes=${data.biomes.length}` +
            ` s0.y=${s0?.y ?? 'none'}`
        )
      }

      // ── Render canvas ──
      const t0 = performance.now()
      const { canvas: image, stats } = renderChunkImage(
        data,
        blockColorsRef.current,
        textureKeysRef.current,
        metaTextureKeysRef.current,
        registryRef.current,
        configRef.current,
        true,
        debugModeRef.current,
        blockNamesRef.current,
        neighborHeightsFor(mcx, mcz),
        configRef.current.infraView ? neighborPipesFor(mcx, mcz) : undefined
      )
      textureDebugStore.addChunkStats(stats)

      // ── Canvas pixel diagnostic ──
      let pixels = -2 // -2 = not checked
      if (dbg) {
        const ms = (performance.now() - t0).toFixed(1)
        const pct =
          stats.drawImage + stats.fillRect > 0
            ? (
                (stats.drawImage / (stats.drawImage + stats.fillRect)) *
                100
              ).toFixed(0)
            : '0'
        pixels = canvasDiagnostics(image)
        const pixStr =
          pixels === -1
            ? '⚠ TAINTED (cross-origin — WebGL upload blocked)'
            : pixels === 0
              ? '⚠ EMPTY (drawImage ran but canvas has no pixels)'
              : `${pixels} non-black pixels`
        console.log(
          `[atlas:chunk] canvas    ${mcx},${mcz}` +
            ` | ${ms}ms` +
            ` | drawImage=${stats.drawImage} (${pct}%) fillRect=${stats.fillRect}` +
            ` | pixels=${pixStr}`
        )
        st.chunkPixels.set(key, pixels)
      }

      // ── Upload to GPU ──
      st.dataCache.set(key, data)
      const texFilter = configRef.current.textureFilter ?? 'pixel'
      const uploadCanvas =
        texFilter === 'journeymap' ? upscaleCanvas(image, 512) : image
      const chunkTex = makeChunkTexture(uploadCanvas, texFilter)
      if (dbg) {
        console.log(
          `[atlas:chunk] texture   ${mcx},${mcz}` +
            ` — needsUpdate=${chunkTex.needsUpdate}` +
            ` uuid=${chunkTex.uuid}`
        )
      }

      const mat = new THREE.MeshBasicMaterial({ map: chunkTex })
      const mesh = new THREE.Mesh(chunkGeo, mat)
      mesh.position.set(mcx * 16 + 8, -(mcz * 16 + 8), 0)
      chunkGroup.add(mesh)

      if (dbg) {
        const outlineState: ChunkOutlineState =
          pixels === -1 ? 'tainted' : pixels === 0 ? 'empty' : 'loaded'
        console.log(
          `[atlas:chunk] mesh      ${mcx},${mcz}` +
            ` — visible=${mesh.visible}` +
            ` pos=(${mesh.position.x},${mesh.position.y},${mesh.position.z})` +
            ` tex=${chunkTex.uuid}` +
            ` → outline=${outlineState}`
        )
        outlines.set(key, mcx, mcz, outlineState, debugModeRef.current)
      }

      st.cache.set(key, mesh)
      st.texVersionAtRender.set(key, st.texVersion)
      st.liveChunks++

      // Neighbors drawn before this chunk's data arrived have a stale shared
      // edge — queue them for a shading re-render.
      markNeighborsShadeStale(mcx, mcz)
    }

    function makeBitmapTexture(
      bitmap: ImageBitmap,
      filter: TextureFilter
    ): THREE.Texture {
      const tex = new THREE.Texture(bitmap)
      tex.colorSpace = THREE.SRGBColorSpace
      // WebGL ignores UNPACK_FLIP_Y for ImageBitmap, so we bake the flip into the
      // bitmap at capture time instead (see enforceChunkBudget) and disable it here.
      tex.flipY = false
      tex.generateMipmaps = true
      tex.needsUpdate = true
      if (filter === 'pixel') {
        tex.magFilter = THREE.NearestFilter
        tex.minFilter = THREE.NearestMipMapLinearFilter
      } else {
        tex.magFilter = THREE.LinearFilter
        tex.minFilter = THREE.LinearMipMapLinearFilter
      }
      return tex
    }

    // Place a chunk restored from the CPU tile cache — a cheap GPU upload, no
    // fetch and no canvas render.  Takes ownership of *bitmap*.
    function placeRestoredChunk(
      key: string,
      mcx: number,
      mcz: number,
      bitmap: ImageBitmap
    ) {
      st.renderSet.delete(key)
      const filter = configRef.current.textureFilter ?? 'pixel'
      const mesh = new THREE.Mesh(
        chunkGeo,
        new THREE.MeshBasicMaterial({ map: makeBitmapTexture(bitmap, filter) })
      )
      mesh.position.set(mcx * 16 + 8, -(mcz * 16 + 8), 0)
      chunkGroup.add(mesh)
      st.cache.set(key, mesh)
      // Tagged valid at the version the cache hit matched, so the stale-render
      // pass leaves it alone until the look actually changes.
      st.texVersionAtRender.set(key, st.texVersion)
      st.liveChunks++
      if (debugModeRef.current)
        outlines.set(key, mcx, mcz, 'loaded', debugModeRef.current)
    }

    // Drop a live chunk mesh without caching it (used for stale restored tiles
    // that can't be re-rendered in place because their block data isn't held).
    function disposeLiveChunk(key: string, mesh: THREE.Mesh) {
      chunkGroup.remove(mesh)
      const mat = mesh.material as THREE.MeshBasicMaterial
      const src = mat.map?.image
      mat.map?.dispose()
      mat.dispose()
      if (src instanceof ImageBitmap) src.close()
      st.cache.delete(key)
      st.dataCache.delete(key)
      st.texVersionAtRender.delete(key)
      st.texStale.delete(key)
      st.chunkPixels.delete(key)
      outlines.remove(key)
      st.liveChunks--
    }

    // Evict chunk meshes farthest from the camera until within the GPU budget.
    // Keeps cheap 'empty'/'error' markers so empty terrain isn't re-fetched.
    // Evict a live chunk, demoting its rendered pixels to the CPU cache first so
    // returning here is a re-upload rather than a re-fetch + re-render.
    function evictChunkToCache(key: string, mesh: THREE.Mesh) {
      chunkGroup.remove(mesh)
      const mat = mesh.material as THREE.MeshBasicMaterial
      const src = mat.map?.image // canvas (cold) or ImageBitmap (restored)
      const ver = st.texVersionAtRender.get(key) ?? st.texVersion
      if (src) {
        // Bake the vertical flip into the cached bitmap when capturing from a
        // canvas (CanvasTexture uploads with flipY=true). A bitmap source is
        // already in this orientation, so copy it as-is.
        const opts: ImageBitmapOptions | undefined =
          src instanceof HTMLCanvasElement
            ? { imageOrientation: 'flipY' }
            : undefined
        createImageBitmap(src, opts)
          .then((bmp) => {
            // The effect may have torn down (and cleared the cache) while we
            // decoded — drop the bitmap instead of leaking it into a dead cache.
            if (destroyed) {
              bmp.close()
              return
            }
            tileCache.put(key, bmp, ver)
          })
          .catch(() => {})
          .finally(() => {
            if (src instanceof ImageBitmap) src.close()
          })
      }
      mat.map?.dispose()
      mat.dispose()
      st.cache.delete(key)
      st.dataCache.delete(key)
      st.texVersionAtRender.delete(key)
      st.texStale.delete(key)
      st.chunkPixels.delete(key)
      outlines.remove(key)
      st.liveChunks--
    }

    // Hard VRAM backstop: evict the chunks farthest from the camera until within
    // the count cap.  The primary recentring happens in reconcileLiveChunks.
    function enforceChunkBudget(cCx: number, cCz: number, maxLive: number) {
      if (st.liveChunks <= maxLive) return
      const live: Array<{ key: string; mesh: THREE.Mesh; d: number }> = []
      for (const [key, entry] of st.cache) {
        if (!(entry instanceof THREE.Mesh)) continue
        const ci = key.indexOf(',')
        const dx = +key.slice(0, ci) - cCx
        const dz = +key.slice(ci + 1) - cCz
        live.push({ key, mesh: entry, d: dx * dx + dz * dz })
      }
      live.sort((a, b) => b.d - a.d) // farthest first
      const evictCount = st.liveChunks - maxLive
      for (let i = 0; i < evictCount && i < live.length; i++) {
        evictChunkToCache(live[i].key, live[i].mesh)
      }
    }

    // Recentre the live detail set on the camera: evict live chunks outside the
    // keep region (viewport + evict margin), freeing GPU budget so the detail
    // layer follows the view.  The margin gives hysteresis so chunks just off the
    // edge linger — panning back restores them with no reload.
    function reconcileLiveChunks(
      kL: number,
      kR: number,
      kT: number,
      kB: number
    ) {
      for (const [key, entry] of st.cache) {
        if (!(entry instanceof THREE.Mesh)) continue
        const ci = key.indexOf(',')
        const mcx = +key.slice(0, ci),
          mcz = +key.slice(ci + 1)
        if (mcx < kL || mcx > kR || mcz < kT || mcz > kB)
          evictChunkToCache(key, entry)
      }
    }

    // Render queued chunks until the per-frame time budget is spent (at least
    // one, so progress is always made even if a single render is expensive).
    /** Tile-work budget for this frame — tightened while the camera is flying. */
    function renderBudget(): number {
      return st.camAnim ? ANIM_RENDER_BUDGET_MS : RENDER_BUDGET_MS
    }

    function drainRenderQueue() {
      if (st.renderQueue.length === 0) return
      const deadline = performance.now() + renderBudget()
      do {
        const item = st.renderQueue.shift()!
        if (!st.renderSet.has(item.key)) {
          // Discarded by a cache clear; release any borrowed cache bitmap.
          item.bitmap?.close()
          continue
        }
        if (item.bitmap) {
          placeRestoredChunk(item.key, item.mcx, item.mcz, item.bitmap)
        } else if (item.data) {
          renderAndPlaceChunk(item.key, item.mcx, item.mcz, item.data)
        }
      } while (st.renderQueue.length > 0 && performance.now() < deadline)
    }

    // ── Chunk loading (bulk) ──
    // Fetch a batch of chunks in one request, then hand the results to the
    // time-sliced renderer.  Chunks absent from the response are empty terrain.
    async function fetchBatch(items: Array<[number, number, string]>) {
      const dbg = debugModeRef.current
      if (dbg) {
        console.log(`[atlas:chunk] fetching  batch ×${items.length}`)
        for (const [mcx, mcz, key] of items)
          outlines.set(key, mcx, mcz, 'rendering', debugModeRef.current)
      }
      try {
        const coords = items.map(([mcx, mcz]) => [mcx, mcz] as [number, number])
        const chunks = await fetchChunkBatch(
          dimensionPath,
          coords,
          inFlight.signal
        )
        // The engine can be torn down mid-flight (a dimension switch builds a
        // fresh one). Its successor is already fetching, so don't decode into
        // dead state — and above all don't let the `finally` queue more work.
        if (destroyed) return

        const returned = new Set<string>()
        for (const data of chunks) {
          const key = `${data.chunk_x},${data.chunk_z}`
          returned.add(key)
          st.resolving.delete(key)
          st.renderSet.add(key)
          st.renderQueue.push({
            key,
            mcx: data.chunk_x,
            mcz: data.chunk_z,
            data,
          })
        }
        // Requested-but-not-returned chunks have no terrain yet.
        for (const [mcx, mcz, key] of items) {
          if (returned.has(key)) continue
          st.resolving.delete(key)
          st.cache.set(key, 'empty')
          if (dbg) outlines.set(key, mcx, mcz, 'empty', debugModeRef.current)
        }
      } catch (err) {
        // A teardown abort is not a chunk failure — don't paint dead state.
        if (destroyed) return
        for (const [mcx, mcz, key] of items) {
          st.resolving.delete(key)
          st.cache.set(key, 'error')
          if (dbg) outlines.set(key, mcx, mcz, 'error', debugModeRef.current)
        }
        if (dbg) console.error('[atlas:chunk] batch exception', err)
      } finally {
        st.activeBatches--
        if (!destroyed) drainQueue()
      }
    }

    function drainQueue() {
      while (
        st.activeBatches < MAX_CONCURRENT_BATCHES &&
        st.pending.length > 0
      ) {
        const batch: Array<[number, number, string]> = []
        while (batch.length < BATCH_SIZE && st.pending.length > 0) {
          const item = st.pending.shift()!
          st.pendingSet.delete(item[2])
          st.resolving.add(item[2])
          batch.push(item)
        }
        if (batch.length === 0) break
        st.activeBatches++
        void fetchBatch(batch)
      }
    }

    // Returns true when it commits a new chunk fetch (used for budget accounting).
    function maybeQueue(mcx: number, mcz: number): boolean {
      const key = `${mcx},${mcz}`
      if (
        st.cache.has(key) ||
        st.resolving.has(key) ||
        st.pendingSet.has(key) ||
        st.renderSet.has(key)
      )
        return false
      const rx = mcx >> 5,
        rz = mcz >> 5
      if (!st.regionSet.has(`${rx},${rz}`)) {
        st.cache.set(key, 'empty')
        return false
      }

      // Warm path: restore a still-valid rendered tile from the CPU cache,
      // skipping the fetch + canvas render entirely.
      const cached = tileCache.take(key, st.texVersion)
      if (cached) {
        st.renderSet.add(key)
        st.renderQueue.push({ key, mcx, mcz, bitmap: cached })
        return true
      }

      st.pendingSet.add(key)
      st.pending.push([mcx, mcz, key])
      if (debugModeRef.current) {
        console.log(`[atlas:chunk] queued   ${mcx},${mcz}`)
        outlines.set(key, mcx, mcz, 'queued', debugModeRef.current)
      }
      drainQueue()
      return true
    }

    // ── Region-tile LOD (zoomed-out overview) ──
    function makeRegionTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
      const tex = new THREE.CanvasTexture(canvas)
      tex.colorSpace = THREE.SRGBColorSpace
      tex.generateMipmaps = true
      tex.magFilter = THREE.LinearFilter
      tex.minFilter = THREE.LinearMipMapLinearFilter
      return tex
    }

    // Revert a region mesh to the shared placeholder material, disposing its tile.
    function revertRegionTile(key: string, mesh: THREE.Mesh) {
      if (mesh.material !== regionMat) {
        const mat = mesh.material as THREE.MeshBasicMaterial
        mat.map?.dispose()
        mat.dispose()
        mesh.material = regionMat
      }
      st.regionTiled.delete(key)
    }

    function clearRegionTiles() {
      st.regionTiled.clear()
      st.regionFailed.clear()
      st.regionResolving.clear()
      st.regionPending.length = 0
      st.regionPendingSet.clear()
      st.regionRenderQueue.length = 0
      st.regionRenderSet.clear()
      st.regionRestale.clear()
      st.activeRegionFetches = 0
    }

    function renderAndPlaceRegionTile(
      key: string,
      _rx: number,
      _rz: number,
      surface: RegionSurface
    ) {
      st.regionRenderSet.delete(key)
      const mesh = regionMeshes.get(key)
      if (!mesh) return // region no longer present (world changed)
      const canvas = renderRegionTile(
        surface,
        blockColorsRef.current,
        registryRef.current,
        configRef.current,
        textureKeysRef.current,
        metaTextureKeysRef.current
      )
      if (mesh.material !== regionMat) {
        const old = mesh.material as THREE.MeshBasicMaterial
        old.map?.dispose()
        old.dispose()
      }
      mesh.material = new THREE.MeshBasicMaterial({
        map: makeRegionTexture(canvas),
      })
      st.regionTiled.add(key)
    }

    function drainRegionRenderQueue() {
      if (st.regionRenderQueue.length === 0) return
      const deadline = performance.now() + renderBudget()
      do {
        const item = st.regionRenderQueue.shift()!
        if (st.regionRenderSet.has(item.key)) {
          renderAndPlaceRegionTile(item.key, item.rx, item.rz, item.surface)
        }
      } while (st.regionRenderQueue.length > 0 && performance.now() < deadline)
    }

    async function fetchRegionTile(rx: number, rz: number, key: string) {
      try {
        const surface = await fetchRegionSurface(
          dimensionPath,
          rx,
          rz,
          st.surfaceSkipIds,
          inFlight.signal
        )
        if (destroyed) return // torn down mid-flight — see fetchBatch
        if (surface.chunks.length === 0) {
          st.regionFailed.add(key)
        } else {
          st.regionRenderSet.add(key)
          st.regionRenderQueue.push({ key, rx, rz, surface })
        }
      } catch {
        if (destroyed) return // teardown abort, not a region failure
        st.regionFailed.add(key)
      } finally {
        st.regionResolving.delete(key)
        st.activeRegionFetches--
        if (!destroyed) drainRegionQueue()
      }
    }

    function drainRegionQueue() {
      while (
        st.activeRegionFetches < MAX_CONCURRENT_REGION_FETCHES &&
        st.regionPending.length > 0
      ) {
        const item = st.regionPending.shift()!
        const key = item[2]
        st.regionPendingSet.delete(key)
        st.regionResolving.add(key)
        st.activeRegionFetches++
        void fetchRegionTile(item[0], item[1], key)
      }
    }

    // Re-queue tiled regions whose overview colours are stale (textures loaded
    // after they were drawn). Bypasses the 'already tiled' guard in
    // maybeQueueRegion; fetchRegionTile → renderAndPlaceRegionTile re-renders the
    // tile in place (material swap, no revert to placeholder → no flash).
    function drainRegionRestale() {
      if (st.regionRestale.size === 0) return
      for (const key of st.regionRestale) {
        st.regionRestale.delete(key)
        if (!st.regionTiled.has(key)) continue // evicted since being marked
        if (
          st.regionResolving.has(key) ||
          st.regionPendingSet.has(key) ||
          st.regionRenderSet.has(key)
        )
          continue // already re-rendering
        const ci = key.indexOf(',')
        st.regionPendingSet.add(key)
        st.regionPending.push([+key.slice(0, ci), +key.slice(ci + 1), key])
      }
      drainRegionQueue()
    }

    // Returns true if it committed a new region surface fetch.
    function maybeQueueRegion(rx: number, rz: number): boolean {
      const key = `${rx},${rz}`
      if (!st.regionSet.has(key)) return false
      if (
        st.regionTiled.has(key) ||
        st.regionResolving.has(key) ||
        st.regionPendingSet.has(key) ||
        st.regionRenderSet.has(key) ||
        st.regionFailed.has(key)
      )
        return false
      st.regionPendingSet.add(key)
      st.regionPending.push([rx, rz, key])
      drainRegionQueue()
      return true
    }

    // Evict region tiles farthest from the camera until within the VRAM budget.
    function enforceRegionBudget(rCx: number, rCz: number) {
      if (st.regionTiled.size <= MAX_REGION_TILES) return
      const live: Array<{ key: string; d: number }> = []
      for (const key of st.regionTiled) {
        const ci = key.indexOf(',')
        const dx = +key.slice(0, ci) - rCx
        const dz = +key.slice(ci + 1) - rCz
        live.push({ key, d: dx * dx + dz * dz })
      }
      live.sort((a, b) => b.d - a.d) // farthest first
      const evict = st.regionTiled.size - MAX_REGION_TILES
      for (let i = 0; i < evict && i < live.length; i++) {
        const mesh = regionMeshes.get(live[i].key)
        if (mesh) revertRegionTile(live[i].key, mesh)
        else st.regionTiled.delete(live[i].key)
      }
    }

    // ── RAF loop ──
    let rafId: number

    // Cheap HUD refresh — runs every frame (even when the scene is idle) so the
    // cursor coordinate readout stays live, but only touches the DOM when the
    // text actually changes. Uses the maintained liveChunks counter and a cached
    // tex-key count instead of spreading/filtering the whole chunk cache.
    function updateHud() {
      if (textureKeysRef.current !== st.lastTexKeysRef) {
        st.lastTexKeysRef = textureKeysRef.current
        st.texKeyCount = textureKeysRef.current
          ? Object.keys(textureKeysRef.current).length
          : 0
      }
      const dbg = debugModeRef.current
      const rt = dbg ? textureDebugStore.getRenderTotals() : null
      const hudX =
        st.mouseWorldX !== null
          ? Math.round(st.mouseWorldX)
          : Math.round(st.cam.cx)
      const hudZ =
        st.mouseWorldZ !== null
          ? Math.round(st.mouseWorldZ)
          : Math.round(st.cam.cz)
      // Where you are and how far in is all the readout owes a player. Live
      // chunk / colour / tex-key counts describe the renderer's internals, not
      // the world, so they ride along with the debug panel like the render
      // totals already did.
      const text =
        `X ${hudX}  Z ${hudZ}  ×${st.cam.scale.toFixed(2)}` +
        (dbg
          ? `  |  ${st.liveChunks} chunks` +
            (bcCountRef.current > 0
              ? `  |  ${bcCountRef.current} colors`
              : '') +
            (st.texKeyCount > 0 ? `  |  ${st.texKeyCount} tex-keys` : '') +
            (rt
              ? `  |  drawImage=${rt.drawImage} fillRect=${rt.fillRect}` +
                ` miss=${rt.missingTexKey} fail=${rt.failedTexLoad}`
              : '')
          : '')
      if (text !== st.lastHud) {
        hud.textContent = text
        st.lastHud = text
      }
    }

    function loop() {
      // Advance an active camera fly-to (search jump / bookmark) before reading
      // the camera, so this frame renders the interpolated position.
      if (st.camAnim) {
        const a = st.camAnim
        const t = Math.min(1, (performance.now() - a.start) / a.duration)
        const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2 // ease-in-out
        st.cam.cx = a.fromCx + (a.toCx - a.fromCx) * e
        st.cam.cz = a.fromCz + (a.toCz - a.fromCz) * e
        // interpolate zoom in log space so it reads as a steady glide
        st.cam.scale = a.fromScale * Math.pow(a.toScale / a.fromScale, e)
        if (t >= 1) {
          st.cam.cx = a.toCx
          st.cam.cz = a.toCz
          st.cam.scale = a.toScale
          st.camAnim = null
        }
        updateCam()
        st.forceFrame = true
      }

      // Pulse the biome-highlight glow while hovering a region: oscillate the
      // fill/border opacity and keep rendering. Steady (clicked) = no animation.
      if (st.biomePulse && st.biomeFillMat && st.biomeBorderMat) {
        const k = 0.5 + 0.5 * Math.sin(performance.now() / 450) // ~1.4s period
        st.biomeFillMat.opacity = BIOME_FILL_OPACITY * (0.4 + 0.9 * k)
        st.biomeBorderMat.opacity = BIOME_BORDER_OPACITY * (0.3 + 0.7 * k)
        st.forceFrame = true
      }

      const { cx, cz, scale } = st.cam
      const halfW = W / (2 * scale),
        halfH = H / (2 * scale)

      // Detect color-map or render-config changes and trigger re-render.
      // lodVersion also bumps so region tiles re-render (texVersion alone can't —
      // it also fires on every streamed texture, which tiles don't use).
      const bcCount = bcCountRef.current
      if (bcCount !== st.lastBcCount) {
        st.lastBcCount = bcCount
        st.texVersion++
        st.texStaleDirty = true
        st.lodVersion++
        st.forceFrame = true
      }
      const cfg = configRef.current
      if (cfg !== st.lastConfig) {
        st.lastConfig = cfg
        st.texVersion++
        st.texStaleDirty = true
        st.lodVersion++
        st.forceFrame = true
      }

      // Recompute the overview skip set when the registry (re)resolves — e.g.
      // once modded names load — or when the config changes (a different preset
      // hides different overlays). Skips invisible 'ignore' blocks, the preset's
      // hidden overlays, and plants (kept when highlightPlants is on). Bumping
      // lodVersion re-fetches overview tiles so they drop the newly-known ids.
      const reg = registryRef.current
      const regChanged = reg !== st.lastRegistryForSkip
      if (regChanged || cfg !== st.lastConfigForSkip) {
        st.lastRegistryForSkip = reg
        st.lastConfigForSkip = cfg
        // Plants are the flower/tallgrass-tagged (and grass/foliage-tinted)
        // overlays; when highlighting, keep them visible by not skipping them.
        const tags = new Set(cfg.hiddenTags)
        if (cfg.highlightPlants) {
          tags.delete('flower')
          tags.delete('tallgrass')
        }
        const set = new Set<number>(reg.ignoredIds())
        for (const id of reg.hiddenTaggedIds(tags)) set.add(id)
        if (!cfg.highlightPlants) for (const id of reg.plantIds()) set.add(id)
        const ids = [...set]
        const csv = ids.join(',')
        if (csv !== st.surfaceSkipCsv) {
          st.surfaceSkipIds = ids
          st.surfaceSkipCsv = csv
          st.lodVersion++
          st.forceFrame = true
        }
        // A registry change (e.g. a saved user override, solid→transparent) can
        // alter a block's category/tint/alpha without touching the skip set, so
        // force a re-render of BOTH LODs — cached detail tiles otherwise keep the
        // old look until they happen to be redrawn.
        if (regChanged) {
          st.texVersion++
          st.texStaleDirty = true
          st.lodVersion++
          st.forceFrame = true
        }
      }

      // Detect debug mode toggle — add/remove outlines for existing chunks
      const dbgNow = debugModeRef.current
      if (dbgNow !== st.lastDebugMode) {
        st.lastDebugMode = dbgNow
        st.forceFrame = true
        if (dbgNow) {
          for (const [key, entry] of st.cache) {
            const [mxs, mzs] = key.split(',')
            const mcx = parseInt(mxs),
              mcz = parseInt(mzs)
            if (entry instanceof THREE.Mesh) {
              const px = st.chunkPixels.get(key) ?? -2
              const s: ChunkOutlineState =
                px === -1 ? 'tainted' : px === 0 ? 'empty' : 'loaded'
              outlines.set(key, mcx, mcz, s, debugModeRef.current)
            } else if (entry === 'error') {
              outlines.set(key, mcx, mcz, 'error', debugModeRef.current)
            }
          }
        } else {
          outlines.clear()
        }
      }

      // ── Dirty gate ── when nothing visible changed, skip the heavy passes
      // (cache scans, LOD, grid rebuild) and the GPU draw; just keep the HUD
      // live and re-arm the RAF. Any source of change re-arms a frame:
      // camera move, a queued/in-flight load, a pending re-render, or forceFrame
      // (texture load, colour/config/debug change, resize, region sync).
      const camMoved =
        cx !== st.lastCam.cx ||
        cz !== st.lastCam.cz ||
        scale !== st.lastCam.scale
      const pendingWork =
        st.renderQueue.length > 0 ||
        st.regionRenderQueue.length > 0 ||
        st.pending.length > 0 ||
        st.resolving.size > 0 ||
        st.renderSet.size > 0 ||
        st.regionPending.length > 0 ||
        st.regionResolving.size > 0 ||
        st.regionRenderSet.size > 0 ||
        st.regionRestale.size > 0 ||
        st.activeBatches > 0 ||
        st.activeRegionFetches > 0
      if (!(st.forceFrame || camMoved || st.staleWork || pendingWork)) {
        updateHud()
        rafId = requestAnimationFrame(loop)
        return
      }

      // A texVersion bump makes every drawn tile stale at once, so collect the
      // affected keys once per bump. Deriving them by scanning the whole cache
      // each frame — as this used to — cost an instanceof + two map lookups per
      // live chunk (up to 3500) on every non-idle frame, including plain panning
      // where nothing was actually stale.
      if (st.texStaleDirty) {
        st.texStale = collectStaleChunks(
          st.cache,
          (entry) => entry instanceof THREE.Mesh,
          st.texVersionAtRender,
          st.texVersion
        )
        st.texStaleDirty = false
      }

      // Re-render stale chunks (max 4 per frame) when textures/colors changed
      // or a late-arriving neighbor invalidated their edge shading.
      if (st.texStale.size > 0 || st.shadeStale.size > 0) {
        // Both sets can name the same chunk; merge only when both are in play so
        // the common single-cause case iterates the live set directly.
        const candidates =
          st.shadeStale.size === 0
            ? st.texStale
            : st.texStale.size === 0
              ? st.shadeStale
              : new Set([...st.texStale, ...st.shadeStale])
        let rerendered = 0
        const staleNoData: string[] = []
        for (const key of candidates) {
          const entry = st.cache.get(key)
          // Evicted since being marked — drop it from both sets.
          if (!(entry instanceof THREE.Mesh)) {
            st.texStale.delete(key)
            st.shadeStale.delete(key)
            continue
          }
          const texCurrent =
            (st.texVersionAtRender.get(key) ?? 0) >= st.texVersion
          const chunkData = st.dataCache.get(key)
          if (chunkData) {
            // Budget spent — leave the rest marked for the next frame.
            if (rerendered >= 4) continue
            const [rmxs, rmzs] = key.split(',')
            const { canvas: newImg, stats: reStats } = renderChunkImage(
              chunkData,
              blockColorsRef.current,
              textureKeysRef.current,
              metaTextureKeysRef.current,
              registryRef.current,
              configRef.current,
              false,
              debugModeRef.current,
              blockNamesRef.current,
              neighborHeightsFor(parseInt(rmxs), parseInt(rmzs)),
              configRef.current.infraView
                ? neighborPipesFor(parseInt(rmxs), parseInt(rmzs))
                : undefined
            )
            textureDebugStore.addChunkStats(reStats)
            if (debugModeRef.current) {
              const px = canvasDiagnostics(newImg)
              st.chunkPixels.set(key, px)
              const [mxs, mzs] = key.split(',')
              const s: ChunkOutlineState =
                px === -1 ? 'tainted' : px === 0 ? 'empty' : 'loaded'
              outlines.set(
                key,
                parseInt(mxs),
                parseInt(mzs),
                s,
                debugModeRef.current
              )
            }
            const mat = entry.material as THREE.MeshBasicMaterial
            mat.map?.dispose()
            const texFilter = configRef.current.textureFilter ?? 'pixel'
            const uploadCanvas =
              texFilter === 'journeymap' ? upscaleCanvas(newImg, 512) : newImg
            mat.map = makeChunkTexture(uploadCanvas, texFilter)
            mat.needsUpdate = true
            st.texVersionAtRender.set(key, st.texVersion)
            st.texStale.delete(key)
            st.shadeStale.delete(key)
            rerendered++
          } else if (!texCurrent) {
            staleNoData.push(key)
          } else {
            // Shade-stale only, but the block data was evicted — can't
            // re-render in place; keep the tile rather than force a refetch.
            st.shadeStale.delete(key)
          }
        }
        // Restored tiles have no block data to re-render — drop them so they
        // reload at the new version (from the cache if revalidated, else fetch).
        for (const key of staleNoData) {
          const entry = st.cache.get(key)
          if (entry instanceof THREE.Mesh) disposeLiveChunk(key, entry)
        }
        // Keep frames coming until the re-render backlog is cleared. Reading the
        // sets directly also covers keys dropped above, so an evicted tile can't
        // leave the loop spinning on work that no longer exists.
        st.staleWork = st.texStale.size > 0 || st.shadeStale.size > 0
      }

      // Render freshly-fetched chunks and region tiles, time-sliced, for a smooth UI.
      drainRenderQueue()
      drainRegionRenderQueue()
      drainRegionRestale()

      const chunkActive = scale >= CHUNK_LOD_SCALE

      // Invalidate region tiles when the colour map / preset changed so the
      // overview reflects the new look (they re-render when next visible).
      if (st.lodVersion !== st.regionLodVersion) {
        st.regionLodVersion = st.lodVersion
        for (const [key, mesh] of regionMeshes) {
          if (st.regionTiled.has(key)) revertRegionTile(key, mesh)
        }
      }

      // ── Chunk LOD ── full detail when zoomed in. Zooming out hides the layer
      // (kept resident, so zoom-in is instant) rather than evicting it.
      chunkGroup.visible = chunkActive
      {
        const cCx = Math.round(cx / 16),
          cCz = Math.round(cz / 16)
        const maxLive =
          (configRef.current.textureFilter ?? 'pixel') === 'journeymap'
            ? MAX_LIVE_CHUNKS_JOURNEYMAP
            : MAX_LIVE_CHUNKS_PIXEL

        // Distance-evict to stay within the GPU budget (runs in both modes so
        // panning the overview still bounds VRAM).
        enforceChunkBudget(cCx, cCz, maxLive)

        if (chunkActive) {
          const cL = Math.floor((cx - halfW) / 16),
            cR = Math.floor((cx + halfW) / 16)
          const cT = Math.floor((cz - halfH) / 16),
            cB = Math.floor((cz + halfH) / 16)

          const bv = st.sortBounds
          if (!bv || bv.L !== cL || bv.R !== cR || bv.T !== cT || bv.B !== cB) {
            // Queue region = viewport + preload margin (load ahead of the view).
            const qL = cL - CHUNK_PRELOAD_MARGIN,
              qR = cR + CHUNK_PRELOAD_MARGIN
            const qT = cT - CHUNK_PRELOAD_MARGIN,
              qB = cB + CHUNK_PRELOAD_MARGIN
            st.sorted.length = 0
            for (let z2 = qT; z2 <= qB; z2++)
              for (let x2 = qL; x2 <= qR; x2++) st.sorted.push([x2, z2])
            st.sorted.sort(
              (a, bsv) =>
                (a[0] - cCx) ** 2 +
                (a[1] - cCz) ** 2 -
                ((bsv[0] - cCx) ** 2 + (bsv[1] - cCz) ** 2)
            )
            st.sortBounds = { L: cL, R: cR, T: cT, B: cB }
            // Recentre the detail layer: evict chunks outside the keep region
            // (viewport + larger evict margin) so it follows the view smoothly.
            reconcileLiveChunks(
              cL - CHUNK_EVICT_MARGIN,
              cR + CHUNK_EVICT_MARGIN,
              cT - CHUNK_EVICT_MARGIN,
              cB + CHUNK_EVICT_MARGIN
            )
          }

          // Queue nearest-first, but never commit more chunks than the GPU budget
          // allows — chunks beyond the cap would only be evicted, causing thrash.
          let committed =
            st.liveChunks +
            st.renderQueue.length +
            st.resolving.size +
            st.pending.length
          for (const [cx2, cz2] of st.sorted) {
            if (committed >= maxLive) break
            if (maybeQueue(cx2, cz2)) committed++
          }
        }
      }

      // ── Region-tile LOD ── always maintained: the overview when zoomed out, and
      // a base layer under the chunks when zoomed in so gaps in the detail layer
      // show the overview (sharpening into detail) instead of a black placeholder.
      {
        const rCx = Math.round(cx / 512),
          rCz = Math.round(cz / 512)
        enforceRegionBudget(rCx, rCz)

        const rL = Math.floor((cx - halfW) / 512),
          rR = Math.floor((cx + halfW) / 512)
        const rT = Math.floor((cz - halfH) / 512),
          rB = Math.floor((cz + halfH) / 512)
        const vis: Array<[number, number]> = []
        for (let z2 = rT; z2 <= rB; z2++)
          for (let x2 = rL; x2 <= rR; x2++) vis.push([x2, z2])
        vis.sort(
          (a, bsv) =>
            (a[0] - rCx) ** 2 +
            (a[1] - rCz) ** 2 -
            ((bsv[0] - rCx) ** 2 + (bsv[1] - rCz) ** 2)
        )

        let committed =
          st.regionTiled.size +
          st.regionResolving.size +
          st.regionPending.length +
          st.regionRenderSet.size
        for (const [x2, z2] of vis) {
          if (committed >= MAX_REGION_TILES) break
          if (maybeQueueRegion(x2, z2)) committed++
        }
      }

      updateGrid()
      mapScene.render()

      st.lastCam.cx = cx
      st.lastCam.cz = cz
      st.lastCam.scale = scale
      st.forceFrame = false

      updateHud()

      rafId = requestAnimationFrame(loop)
    }
    rafId = requestAnimationFrame(loop)

    // ── Input ──
    const el = mapScene.domElement

    // The block inspector, for the given right-click event. Reused both as the
    // standalone right-click action and as the "Inspect block" context-menu item.
    const showInspector = (ev: MouseEvent) =>
      showBlockInspector({
        event: ev,
        el,
        inspector,
        w: W,
        h: H,
        cam: st.cam,
        dataCache: st.dataCache,
        dimensionPath,
        isDestroyed: () => destroyed,
        registry: registryRef.current,
        config: configRef.current,
        blockColors: blockColorsRef.current,
        blockNames: blockNamesRef.current,
        textureKeys: textureKeysRef.current,
        metaTextureKeys: metaTextureKeysRef.current,
      })

    // The last right-clicked event, so a context-menu "Inspect block" item can run
    // the inspector at the point the menu was opened from.
    let lastContextEvent: MouseEvent | null = null

    function onContextMenu(e: MouseEvent) {
      e.preventDefault()
      lastContextEvent = e
      const openMenu = onContextRef?.current
      if (!openMenu) {
        void showInspector(e) // standalone: keep the classic instant inspector
        return
      }
      const rect = el.getBoundingClientRect()
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top
      const worldX = Math.floor(st.cam.cx + (mx - W / 2) / st.cam.scale)
      const worldZ = Math.floor(st.cam.cz + (my - H / 2) / st.cam.scale)
      openMenu({ screenX: e.clientX, screenY: e.clientY, worldX, worldZ })
    }

    this.inspectAt = () => {
      if (lastContextEvent) void showInspector(lastContextEvent)
    }

    const resizeObs = new ResizeObserver(() => {
      W = container.clientWidth || 800
      H = container.clientHeight || 600
      mapScene.resize(W, H)
      updateCam()
      st.forceFrame = true
    })
    resizeObs.observe(container)
    updateCam()

    const detachInput = attachMapInput({
      el,
      inspector,
      state: st,
      updateCam,
      fitCamera,
      getDims: () => ({ w: W, h: H }),
      minScale: MIN_SCALE,
      maxScale: MAX_SCALE,
      onContextMenu,
    })

    // Expose the bits the chunk-tools selection UI needs (screen↔world math and
    // the highlight overlay) without threading them through React.
    this._st = st
    this._mapScene = mapScene
    this._getDims = () => ({ w: W, h: H })
    if (initialHome) this.setHomeMarker(initialHome) // restore the saved home marker
    this.invalidateChunks = (chunks) => {
      const regions = new Set<string>()
      for (const [cx, cz] of chunks) {
        const key = `${cx},${cz}`
        const entry = st.cache.get(key)
        if (entry instanceof THREE.Mesh) {
          disposeLiveChunk(key, entry)
        } else {
          st.cache.delete(key)
          st.dataCache.delete(key)
          st.texVersionAtRender.delete(key)
          st.texStale.delete(key)
          st.chunkPixels.delete(key)
          outlines.remove(key)
        }
        tileCache.delete(key) // drop the stale CPU bitmap so it can't be restored
        regions.add(`${cx >> 5},${cz >> 5}`)
      }
      // Re-render each affected region's overview tile so it reflects the change.
      for (const rkey of regions) {
        const mesh = regionMeshes.get(rkey)
        if (mesh && st.regionTiled.has(rkey)) revertRegionTile(rkey, mesh)
        st.regionFailed.delete(rkey)
      }
      st.forceFrame = true
    }
    this.refreshView = () => {
      for (const [key, mesh] of regionMeshes) revertRegionTile(key, mesh)
      clearRegionTiles() // reset region scheduling so visible tiles re-queue fresh
      clearChunkCache() // drop the chunk layer; it re-fetches from the changed save
      st.forceFrame = true
    }

    this._cleanup = () => {
      destroyed = true
      inFlight.abort()
      if (regionRelodTimer !== null) clearTimeout(regionRelodTimer)
      unsubTextures()
      syncRegionsRef.current = null
      fitCameraRef.current = null
      cancelAnimationFrame(rafId)
      resizeObs.disconnect()
      detachInput()
      clearChunkCache() // also removes outlines and clears chunkPixels
      for (const [key, m] of regionMeshes) revertRegionTile(key, m) // dispose tile materials
      this.setHeatmap(null) // drop overlay meshes/textures before the renderer goes
      this.setSearchHighlight(null)
      this.setHomeMarker(null)
      this.setBiomeHighlight(null)
      this.setOreVeins(null)
      mapScene.dispose()
    }
  }

  dispose(): void {
    this._cleanup()
  }

  /** Current camera centre/zoom + viewport size, for screen↔world conversion. */
  getViewport(): {
    cx: number
    cz: number
    scale: number
    w: number
    h: number
  } {
    const { w, h } = this._getDims()
    return {
      cx: this._st.cam.cx,
      cz: this._st.cam.cz,
      scale: this._st.cam.scale,
      w,
      h,
    }
  }

  /** Highlight the selected chunks, or clear with null/empty. */
  setSelection(chunks: readonly [number, number][] | null): void {
    this._mapScene.setSelectionChunks(chunks)
    this._st.forceFrame = true
  }

  /**
   * Set the map's resting cursor — a tool's affordance, e.g. a crosshair while
   * the chunk selector is up. Null restores the default grab. Panning still
   * shows the grabbing hand and returns here on release.
   */
  setCursor(cursor: string | null): void {
    this._st.baseCursor = cursor ?? 'grab'
    if (!this._st.isDragging)
      this._mapScene.domElement.style.cursor = this._st.baseCursor
  }

  /** Highlight the chunks a paste would land on, or clear with null/empty. */
  setPreview(chunks: readonly [number, number][] | null): void {
    this._mapScene.setPreviewChunks(chunks)
    this._st.forceFrame = true
  }

  /**
   * Jump the camera to a saved centre + zoom (a saved-view bookmark). Scale is
   * clamped to the engine's zoom range; the world centre is set as-is.
   */
  setCamera(cam: { cx: number; cz: number; scale: number }): void {
    const st = this._st
    st.camAnim = null // an instant set cancels any in-flight fly-to
    st.cam.cx = cam.cx
    st.cam.cz = cam.cz
    st.cam.scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, cam.scale))
    st.forceFrame = true
  }

  /**
   * Smoothly fly the camera to a centre + zoom over ~`duration` ms (search jump).
   * Cancels any in-flight fly-to; scale is clamped to the engine's zoom range.
   */
  animateCameraTo(
    cam: { cx: number; cz: number; scale: number },
    duration?: number
  ): void {
    const st = this._st
    st.camAnim = {
      fromCx: st.cam.cx,
      fromCz: st.cam.cz,
      fromScale: st.cam.scale,
      toCx: cam.cx,
      toCz: cam.cz,
      toScale: Math.max(MIN_SCALE, Math.min(MAX_SCALE, cam.scale)),
      start: performance.now(),
      duration: duration ?? flyDuration(st.cam, cam),
    }
    st.forceFrame = true
  }

  /**
   * Fly the camera to frame a world-space area — centre it and zoom so the whole
   * box fits the viewport (with a margin). Used to frame a clicked biome region so
   * its highlight is fully in view instead of zooming past it.
   */
  animateCameraToBounds(
    bounds: { minX: number; minZ: number; maxX: number; maxZ: number },
    duration?: number
  ): void {
    const { w, h } = this._getDims()
    const worldW = Math.max(16, bounds.maxX - bounds.minX)
    const worldH = Math.max(16, bounds.maxZ - bounds.minZ)
    const margin = 1.3 // leave a little breathing room around the region
    const scale = Math.min(w / (worldW * margin), h / (worldH * margin))
    this.animateCameraTo(
      {
        cx: (bounds.minX + bounds.maxX) / 2,
        cz: (bounds.minZ + bounds.maxZ) / 2,
        scale,
      },
      duration
    )
  }

  /**
   * Show a per-chunk heatmap overlay (Stage 5 stats prototype) in world space, or
   * clear it with null. Values are normalised across vmin..vmax to a colour ramp.
   */
  setHeatmap(data: HeatmapData | null): void {
    const scene = this._mapScene.scene
    if (this._heatmap) {
      scene.remove(this._heatmap)
      const mat = this._heatmap.material as THREE.MeshBasicMaterial
      mat.map?.dispose()
      mat.dispose()
      this._heatmap.geometry.dispose()
      this._heatmap = null
    }
    if (data && data.cells.length) {
      this._heatmap = buildHeatmapMesh(data)
      scene.add(this._heatmap)
    }
    this._st.forceFrame = true
  }

  /**
   * Highlight the exact blocks a search matched (Stage 5): a bright amber marker
   * on each matched block column, grouped per chunk so the overlay stays cheap no
   * matter how far the matches spread. Pass null to clear. World-space, so each
   * marker stays pinned to its block as the view pans and zooms.
   */
  setSearchHighlight(columns: BlockColumn[] | null): void {
    const scene = this._mapScene.scene
    if (this._highlight) {
      scene.remove(this._highlight)
      disposeHighlightGroup(this._highlight)
      this._highlight = null
    }
    if (columns && columns.length) {
      this._highlight = buildHighlightGroup(columns)
      scene.add(this._highlight)
    }
    this._st.forceFrame = true
  }

  /**
   * Highlight a biome region as a set of chunks: a faint translucent blue wash
   * over the area with a softer blue outline on its border, so you can read where
   * it starts and stops. `pulse` animates the glow (for hover); steady is a fixed
   * opacity (for a clicked/locked region). Pass null to clear. World-space; the
   * fill and border are each one merged draw call, so it scales to thousands of
   * chunks.
   */
  setBiomeHighlight(chunks: ChunkCoord[] | null, pulse = false): void {
    const st = this._st
    const scene = this._mapScene.scene
    if (this._biomeHighlight) {
      scene.remove(this._biomeHighlight)
      disposeBiomeHighlight(this._biomeHighlight)
      this._biomeHighlight = null
    }
    st.biomeFillMat = null
    st.biomeBorderMat = null
    st.biomePulse = false
    if (chunks && chunks.length) {
      const group = buildBiomeHighlight(chunks)
      this._biomeHighlight = group
      scene.add(group)
      const [fill, border] = group.children as [THREE.Mesh, THREE.LineSegments]
      st.biomeFillMat = fill.material as THREE.MeshBasicMaterial
      st.biomeBorderMat = border.material as THREE.LineBasicMaterial
      st.biomePulse = pulse
      // Steady shows the base opacity; the pulse animates it from the loop.
      if (!pulse) {
        st.biomeFillMat.opacity = BIOME_FILL_OPACITY
        st.biomeBorderMat.opacity = BIOME_BORDER_OPACITY
      }
    }
    st.forceFrame = true
  }

  /**
   * Show (or clear, with null) the ore-vein overlay: each vein rendered as its GT
   * ore sprite tinted by the material colour (a dark halo behind for contrast), at
   * a constant pixel size so they stay visible at any zoom. Batched by sprite, so it
   * scales to thousands of veins. ``sprites`` maps a marker's ``spriteKey`` to a PNG
   * data URL; a marker with no (or unknown) sprite falls back to a coloured disc.
   * Labels are a separate DOM overlay.
   */
  setOreVeins(
    veins: OreVeinMarker[] | null,
    sprites?: Record<string, string>
  ): void {
    const scene = this._mapScene.scene
    if (this._oreVeins) {
      scene.remove(this._oreVeins)
      disposeOreVeins(this._oreVeins)
      this._oreVeins = null
    }
    if (veins && veins.length) {
      this._oreVeins = buildOreVeins(veins, sprites ?? {}, () => {
        this._st.forceFrame = true
      })
      scene.add(this._oreVeins)
    }
    this._st.forceFrame = true
  }

  /**
   * Pin (or clear, with null) the home-waypoint marker at a world block. Like the
   * other overlays it lives in world space, so it stays fixed to its block as the
   * view pans and zooms, drawn on top of everything else.
   */
  setHomeMarker(pos: HomePos | null): void {
    const scene = this._mapScene.scene
    if (this._homeMarker) {
      scene.remove(this._homeMarker)
      const mat = this._homeMarker.material as THREE.MeshBasicMaterial
      mat.map?.dispose()
      mat.dispose()
      this._homeMarker.geometry.dispose()
      this._homeMarker = null
    }
    if (pos) {
      this._homeMarker = buildHomeMarker(pos)
      scene.add(this._homeMarker)
    }
    this._st.forceFrame = true
  }

  /** Brighten the reference grid (paired with the coordinate-label overlay). */
  setGrid(visible: boolean): void {
    this._mapScene.setGridVisible(visible)
    this._st.forceFrame = true
  }
}

// ── Heatmap overlay (Stage 5) ────────────────────────────────────────────────
// Paints one pixel per chunk onto a world-space plane (value → cool-warm ramp).
// The search highlight is a separate, block-resolution layer — see further down.

interface CellXZ {
  cx: number
  cz: number
}

/**
 * Paint a 1px-per-chunk plane over the cells' bounding box: *color* returns the
 * RGBA for each cell, un-hit cells stay transparent. Nearest-filtered so chunks
 * read as crisp squares; drawn on top (depthTest off) at the given render order.
 */
function paintCellMesh<T extends CellXZ>(
  cells: T[],
  color: (c: T) => [number, number, number, number],
  opacity: number,
  z: number,
  renderOrder: number
): THREE.Mesh {
  let minCx = Infinity,
    minCz = Infinity,
    maxCx = -Infinity,
    maxCz = -Infinity
  for (const c of cells) {
    if (c.cx < minCx) minCx = c.cx
    if (c.cx > maxCx) maxCx = c.cx
    if (c.cz < minCz) minCz = c.cz
    if (c.cz > maxCz) maxCz = c.cz
  }
  const w = maxCx - minCx + 1
  const h = maxCz - minCz + 1
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  const img = ctx.createImageData(w, h)
  for (const c of cells) {
    const [r, g, b, a] = color(c)
    const o = ((c.cz - minCz) * w + (c.cx - minCx)) * 4
    img.data[o] = r
    img.data[o + 1] = g
    img.data[o + 2] = b
    img.data[o + 3] = a
  }
  ctx.putImageData(img, 0, 0)

  const tex = new THREE.CanvasTexture(canvas)
  tex.magFilter = THREE.NearestFilter
  tex.minFilter = THREE.NearestFilter
  tex.colorSpace = THREE.SRGBColorSpace

  const geo = new THREE.PlaneGeometry(w * 16, h * 16)
  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    opacity,
    depthTest: false,
  })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.position.set(
    (minCx * 16 + (maxCx + 1) * 16) / 2,
    -((minCz * 16 + (maxCz + 1) * 16) / 2),
    z
  )
  mesh.renderOrder = renderOrder
  return mesh
}

export interface HeatmapCell {
  cx: number
  cz: number
  v: number
}
export interface HeatmapData {
  cells: HeatmapCell[]
  vmin: number
  vmax: number
}

/** Build the heatmap plane: value → cool-warm ramp, log-scaled across the range. */
function buildHeatmapMesh(data: HeatmapData): THREE.Mesh {
  // Log scale so the whole cluster reads warm rather than one dense core chunk
  // maxing out the ramp and leaving the rest blue.
  const logMax = Math.log1p(Math.max(1, data.vmax - data.vmin))
  return paintCellMesh(
    data.cells,
    (c) => {
      const [r, g, b] = heatColor(Math.log1p(c.v - data.vmin) / logMax)
      return [r, g, b, 255]
    },
    0.6,
    10,
    999
  )
}

// ── Search highlight (Stage 5) ───────────────────────────────────────────────
// Marks the exact blocks a search matched. One 16×16 mask texture per hit chunk
// (a bright amber pixel on each matched column), grouped so a wide spread of
// matches never balloons into one giant canvas. Aligned to blocks exactly like a
// chunk tile: canvas row = local z, plane centred on the chunk (plain
// CanvasTexture, matching makeChunkTexture).

/** A matched block's world column (x, z); the map is top-down, so one per column. */
export interface BlockColumn {
  x: number
  z: number
}

const HIGHLIGHT_RGBA: [number, number, number, number] = [255, 178, 36, 235] // amber

/** Build the highlight as a group of per-chunk 16×16 marker planes. */
function buildHighlightGroup(columns: BlockColumn[]): THREE.Group {
  // Bucket matched columns by chunk, recording each block's local pixel index.
  const byChunk = new Map<string, { cx: number; cz: number; local: number[] }>()
  for (const { x, z } of columns) {
    const cx = Math.floor(x / 16)
    const cz = Math.floor(z / 16)
    const key = `${cx},${cz}`
    let e = byChunk.get(key)
    if (!e) {
      e = { cx, cz, local: [] }
      byChunk.set(key, e)
    }
    const lx = ((x % 16) + 16) % 16
    const lz = ((z % 16) + 16) % 16
    e.local.push((lz << 4) | lx) // row-major pixel index into a 16×16 canvas
  }

  const [r, g, b, a] = HIGHLIGHT_RGBA
  const group = new THREE.Group()
  for (const { cx, cz, local } of byChunk.values()) {
    const canvas = document.createElement('canvas')
    canvas.width = 16
    canvas.height = 16
    const ctx = canvas.getContext('2d')!
    const img = ctx.createImageData(16, 16)
    for (const li of local) {
      const o = li * 4
      img.data[o] = r
      img.data[o + 1] = g
      img.data[o + 2] = b
      img.data[o + 3] = a
    }
    ctx.putImageData(img, 0, 0)

    const tex = new THREE.CanvasTexture(canvas)
    tex.magFilter = THREE.NearestFilter
    tex.minFilter = THREE.NearestFilter
    tex.colorSpace = THREE.SRGBColorSpace

    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      depthTest: false,
    })
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(16, 16), mat)
    mesh.position.set(cx * 16 + 8, -(cz * 16 + 8), 11)
    mesh.renderOrder = 1000 // above chunk tiles and the heatmap
    group.add(mesh)
  }
  return group
}

/** Side of the home marker in world blocks — big enough to spot when zoomed out. */
const HOME_MARKER_WORLD = 12

/**
 * Build the home-waypoint marker: an emerald map-pin drawn onto a canvas plane,
 * centred on its block and tinted distinctly from the amber search highlight. The
 * pin's tip points at the block; the plane is offset up by half its height so the
 * tip (not the centre) lands on the target column.
 */
function buildHomeMarker(pos: HomePos): THREE.Mesh {
  const S = 64 // canvas resolution
  const canvas = document.createElement('canvas')
  canvas.width = S
  canvas.height = S
  const ctx = canvas.getContext('2d')!
  const cx = S / 2
  const headR = S * 0.26
  const headY = S * 0.32
  const tipY = S * 0.94

  // Teardrop pin: a circular head tapering to a point at the bottom.
  ctx.beginPath()
  ctx.moveTo(cx, tipY)
  ctx.quadraticCurveTo(cx - headR, headY + headR * 0.9, cx - headR, headY)
  ctx.arc(cx, headY, headR, Math.PI, 0, false)
  ctx.quadraticCurveTo(cx + headR, headY + headR * 0.9, cx, tipY)
  ctx.closePath()
  ctx.fillStyle = '#10b981' // emerald-500
  ctx.fill()
  ctx.lineWidth = S * 0.05
  ctx.strokeStyle = '#ffffff'
  ctx.stroke()

  // Inner hole.
  ctx.beginPath()
  ctx.arc(cx, headY, headR * 0.42, 0, Math.PI * 2)
  ctx.fillStyle = '#ffffff'
  ctx.fill()

  const tex = new THREE.CanvasTexture(canvas)
  tex.magFilter = THREE.LinearFilter
  tex.minFilter = THREE.LinearFilter
  tex.colorSpace = THREE.SRGBColorSpace

  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    depthTest: false,
  })
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(HOME_MARKER_WORLD, HOME_MARKER_WORLD),
    mat
  )
  // World→GL is Z-flipped (y = -z). The tip sits at the block centre; the canvas
  // tip is near its bottom edge, so raise the plane by ~half its height in GL-y.
  mesh.position.set(pos.x + 0.5, -(pos.z + 0.5) + HOME_MARKER_WORLD * 0.44, 12)
  mesh.renderOrder = 1001 // above the search highlight (1000)
  return mesh
}

/** Dispose every per-chunk marker plane's texture, material, and geometry. */
function disposeHighlightGroup(group: THREE.Group): void {
  for (const child of group.children) {
    const mesh = child as THREE.Mesh
    const mat = mesh.material as THREE.MeshBasicMaterial
    mat.map?.dispose()
    mat.dispose()
    mesh.geometry.dispose()
  }
}

// ── Biome highlight ──────────────────────────────────────────────────────────
// A translucent blue fill over a biome's chunks with a stronger blue outline on
// its border, so the extent (and where it starts/stops) reads at a glance. Fill
// and border are each a single merged draw call, so thousands of chunks are cheap.

/** A chunk coordinate (16-block cell) — the granularity of the biome index. */
export interface ChunkCoord {
  cx: number
  cz: number
}

// Fill and outline share one blue; the fill is a translucent wash, the outline a
// stronger edge so the region's extent reads clearly.
const BIOME_COLOR = 0x6db3ff
const BIOME_FILL_OPACITY = 0.4
const BIOME_BORDER_OPACITY = 0.95

function buildBiomeHighlight(chunks: ChunkCoord[]): THREE.Group {
  const present = new Set(chunks.map((c) => `${c.cx},${c.cz}`))
  const fill: number[] = [] // two triangles per chunk
  const edges: number[] = [] // one segment per exposed chunk side

  for (const { cx, cz } of chunks) {
    // World→GL is Z-flipped (y = -z); a chunk spans [cx*16, cx*16+16].
    const x0 = cx * 16
    const x1 = x0 + 16
    const y0 = -(cz * 16)
    const y1 = -(cz * 16 + 16)
    fill.push(x0, y0, 0, x1, y0, 0, x1, y1, 0, x0, y0, 0, x1, y1, 0, x0, y1, 0)
    // A side is a border wherever the neighbouring chunk isn't in the biome.
    if (!present.has(`${cx - 1},${cz}`)) edges.push(x0, y0, 0, x0, y1, 0)
    if (!present.has(`${cx + 1},${cz}`)) edges.push(x1, y0, 0, x1, y1, 0)
    if (!present.has(`${cx},${cz - 1}`)) edges.push(x0, y0, 0, x1, y0, 0)
    if (!present.has(`${cx},${cz + 1}`)) edges.push(x0, y1, 0, x1, y1, 0)
  }

  const group = new THREE.Group()

  const fillGeo = new THREE.BufferGeometry()
  fillGeo.setAttribute('position', new THREE.Float32BufferAttribute(fill, 3))
  const fillMesh = new THREE.Mesh(
    fillGeo,
    new THREE.MeshBasicMaterial({
      color: BIOME_COLOR,
      transparent: true,
      opacity: BIOME_FILL_OPACITY,
      depthTest: false,
      // The hand-built quads aren't wound for front-face culling — draw both sides.
      side: THREE.DoubleSide,
    })
  )
  fillMesh.position.z = 10
  fillMesh.renderOrder = 999
  fillMesh.frustumCulled = false
  group.add(fillMesh)

  const edgeGeo = new THREE.BufferGeometry()
  edgeGeo.setAttribute('position', new THREE.Float32BufferAttribute(edges, 3))
  const edgeLines = new THREE.LineSegments(
    edgeGeo,
    new THREE.LineBasicMaterial({
      color: BIOME_COLOR,
      transparent: true,
      opacity: BIOME_BORDER_OPACITY,
      depthTest: false,
    })
  )
  edgeLines.position.z = 11
  edgeLines.renderOrder = 1001
  edgeLines.frustumCulled = false
  group.add(edgeLines)

  return group
}

function disposeBiomeHighlight(group: THREE.Group): void {
  for (const child of group.children) {
    const obj = child as THREE.Mesh | THREE.LineSegments
    ;(obj.material as THREE.Material).dispose()
    obj.geometry.dispose()
  }
}

// ── Ore-vein overlay ─────────────────────────────────────────────────────────
// One marker per Visual Prospecting vein: a stone base with GregTech's ore overlay
// on top (the ore-block look), tinted by the material colour (map × vertexColour, as
// GT renders it), at a constant pixel size. Veins are batched by sprite — one
// THREE.Points draw call per unique sprite, plus one shared stone layer — so it
// scales to thousands. A vein with no sprite falls back to a coloured disc. Depleted
// veins are dimmed. Labels are a separate DOM overlay.

/**
 * A vein to plot: world position, CSS colour (the material rgb, resolved by the
 * caller), depleted, and an optional sprite key (the vein's `texture` — an index
 * into the sprites map passed to setOreVeins). No sprite → a flat coloured disc.
 */
export interface OreVeinMarker {
  x: number
  z: number
  color: string
  depleted?: boolean
  spriteKey?: string
}

const VEIN_DOT_PX = 16 // plain fallback disc (no sprite)
const VEIN_SPRITE_PX = 44 // the ore sprite marker (constant pixel size)

let _veinSprite: THREE.CanvasTexture | null = null

// Ore-sprite textures, cached by data-URL (content-stable across dimensions), so
// toggling the overlay or switching dimensions never reloads the same PNG.
const _veinTexCache = new Map<string, THREE.Texture>()

/** Load (once) an ore-overlay sprite from a data URL; re-renders when it arrives. */
function veinTexture(dataUrl: string, onReady: () => void): THREE.Texture {
  const cached = _veinTexCache.get(dataUrl)
  if (cached) return cached
  const tex = new THREE.TextureLoader().load(dataUrl, () => onReady())
  tex.colorSpace = THREE.SRGBColorSpace
  tex.magFilter = THREE.NearestFilter // crisp pixel-art edges when enlarged
  tex.minFilter = THREE.NearestFilter
  tex.generateMipmaps = false
  _veinTexCache.set(dataUrl, tex)
  return tex
}

/** Shared soft-edged white disc sprite for the point dots (built once). */
function veinSprite(): THREE.CanvasTexture {
  if (_veinSprite) return _veinSprite
  const S = 64
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = S
  const ctx = canvas.getContext('2d')!
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.7, 'rgba(255,255,255,1)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2)
  ctx.fill()
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  _veinSprite = tex
  return tex
}

let _veinStone: THREE.CanvasTexture | null = null

/** Shared stone-grey square base (built once) — the ore overlay draws on top of it. */
function veinStoneSprite(): THREE.CanvasTexture {
  if (_veinStone) return _veinStone
  const S = 16
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = S
  const ctx = canvas.getContext('2d')!
  const img = ctx.createImageData(S, S)
  for (let i = 0; i < S * S; i++) {
    const n = 116 + Math.floor(Math.random() * 22) // stone speckle ~116–138
    img.data[i * 4] = n
    img.data[i * 4 + 1] = n
    img.data[i * 4 + 2] = n
    img.data[i * 4 + 3] = 255
  }
  ctx.putImageData(img, 0, 0)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.magFilter = THREE.NearestFilter
  tex.minFilter = THREE.NearestFilter
  tex.generateMipmaps = false
  _veinStone = tex
  return tex
}

/**
 * One THREE.Points for a set of veins: a shared `map` sprite sized in constant
 * pixels. With `vertexColors` the sprite is tinted per-vein by the material rgb
 * (map × colour); without it `color` tints the whole batch. Depleted veins are dimmed.
 */
function buildVeinPoints(
  veins: OreVeinMarker[],
  map: THREE.Texture,
  opts: {
    size: number
    renderOrder: number
    vertexColors: boolean
    color?: number
    opacity?: number
  }
): THREE.Points {
  const n = veins.length
  const positions = new Float32Array(n * 3)
  const colors = opts.vertexColors ? new Float32Array(n * 3) : null
  const c = new THREE.Color()
  for (let i = 0; i < n; i++) {
    const v = veins[i]
    positions[i * 3] = v.x + 0.5
    positions[i * 3 + 1] = -(v.z + 0.5) // world→GL Z-flip
    positions[i * 3 + 2] = 12
    if (colors) {
      c.set(v.color)
      if (v.depleted) c.multiplyScalar(0.4) // dim mined-out veins
      colors[i * 3] = c.r
      colors[i * 3 + 1] = c.g
      colors[i * 3 + 2] = c.b
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  if (colors)
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))

  const pts = new THREE.Points(
    geo,
    new THREE.PointsMaterial({
      size: opts.size,
      map,
      color: opts.color ?? 0xffffff,
      vertexColors: opts.vertexColors,
      transparent: true,
      opacity: opts.opacity ?? 1,
      sizeAttenuation: false, // constant pixel size, independent of zoom
      depthTest: false,
    })
  )
  pts.renderOrder = opts.renderOrder
  pts.frustumCulled = false
  return pts
}

function buildOreVeins(
  veins: OreVeinMarker[],
  sprites: Record<string, string>,
  requestFrame: () => void
): THREE.Group {
  const group = new THREE.Group()

  // Stone base behind every vein — the ore overlay draws on top (ore-block look).
  group.add(
    buildVeinPoints(veins, veinStoneSprite(), {
      size: VEIN_SPRITE_PX,
      renderOrder: 1002,
      vertexColors: false,
    })
  )

  // Batch veins by sprite (one draw call each), each drawn as its square ore overlay
  // tinted per-vein by rgb. Veins with no sprite fall back to the plain coloured disc.
  const bySprite = new Map<string, OreVeinMarker[]>()
  const noSprite: OreVeinMarker[] = []
  for (const v of veins) {
    const url = v.spriteKey ? sprites[v.spriteKey] : undefined
    if (url) {
      const arr = bySprite.get(url)
      if (arr) arr.push(v)
      else bySprite.set(url, [v])
    } else {
      noSprite.push(v)
    }
  }
  for (const [url, batch] of bySprite) {
    group.add(
      buildVeinPoints(batch, veinTexture(url, requestFrame), {
        size: VEIN_SPRITE_PX,
        renderOrder: 1003,
        vertexColors: true,
      })
    )
  }
  if (noSprite.length) {
    group.add(
      buildVeinPoints(noSprite, veinSprite(), {
        size: VEIN_DOT_PX,
        renderOrder: 1003,
        vertexColors: true,
      })
    )
  }
  return group
}

function disposeOreVeins(group: THREE.Group): void {
  // Each Points owns its geometry + material; dispose both. Sprite textures (the
  // shared white disc and the cached ore sprites) are shared singletons — leave them.
  for (const child of group.children) {
    const pts = child as THREE.Points
    pts.geometry.dispose()
    ;(pts.material as THREE.Material).dispose()
  }
}

/** Cool→warm ramp: blue (low) → green → yellow → red (high). */
function heatColor(t: number): [number, number, number] {
  const x = Math.max(0, Math.min(1, t))
  return hslToRgb(((1 - x) * 240) / 360, 1, 0.5)
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const k = (n: number) => (n + h * 12) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))
  return [
    Math.round(f(0) * 255),
    Math.round(f(8) * 255),
    Math.round(f(4) * 255),
  ]
}
