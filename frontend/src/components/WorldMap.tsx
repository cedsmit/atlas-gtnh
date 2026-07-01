import { useEffect, useRef } from 'react'
import * as THREE from 'three'

import type { BlockColorMap } from '../api/blockColors'
import type { ChunkData } from '../api/chunks'
import { fetchChunkBatch } from '../api/chunks'
import type { RegionSummary, RegionSurface } from '../api/regions'
import { fetchRegionSurface } from '../api/regions'
import { renderRegionTile } from '../lib/regionTileRenderer'
import { TileImageCache } from '../lib/tileImageCache'
import { VIEWER_CONFIG } from '../lib/viewerConfig'
import { textureDebugStore } from '../lib/textureDebugStore'
import {
  type BlockRenderRegistry,
  createResolvedRegistry,
} from '../lib/blockRenderRegistry'
import { type RenderConfig, type TextureFilter, presetToConfig, BUILT_IN_PRESETS } from '../lib/renderPresets'
import { onTextureLoad } from '../lib/textureLoader'
import {
  canvasDiagnostics,
  makeChunkTexture,
  renderChunkImage,
  upscaleCanvas,
} from '../lib/chunkTileRenderer'
import { FilterPipelineInfo } from './FilterPipelineInfo'
import { ChunkOutlineOverlay, type ChunkOutlineState } from './chunkOutline'
import { showBlockInspector } from './blockInspector'
import { attachMapInput } from './mapInput'
import { MapScene } from './mapScene'

const DEFAULT_CONFIG: RenderConfig = presetToConfig(BUILT_IN_PRESETS[0])

// ── Constants ──────────────────────────────────────────────────────────────
// All tunables live in lib/viewerConfig.ts; aliased here to short local names.
const {
  minScale:                   MIN_SCALE,
  maxScale:                   MAX_SCALE,
  chunkLodScale:              CHUNK_LOD_SCALE,
  chunkPreloadMargin:         CHUNK_PRELOAD_MARGIN,
  chunkEvictMargin:           CHUNK_EVICT_MARGIN,
  maxLiveChunksPixel:         MAX_LIVE_CHUNKS_PIXEL,
  maxLiveChunksJourneymap:    MAX_LIVE_CHUNKS_JOURNEYMAP,
  maxRegionTiles:             MAX_REGION_TILES,
  tileCacheMax:               TILE_CACHE_MAX,
  batchSize:                  BATCH_SIZE,
  maxConcurrentBatches:       MAX_CONCURRENT_BATCHES,
  maxConcurrentRegionFetches: MAX_CONCURRENT_REGION_FETCHES,
  renderBudgetMs:             RENDER_BUDGET_MS,
} = VIEWER_CONFIG

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

  // Enable/disable debug store when prop changes
  useEffect(() => {
    if (debugMode) textureDebugStore.enable()
    else textureDebugStore.disable()
  }, [debugMode])

  // ── Main Three.js effect ────────────────────────────────────────────────
  useEffect(() => {
    const container = containerRef.current!
    const hud       = hudRef.current!
    const inspector = inspectorRef.current!
    inspector.addEventListener('mousedown', (e) => e.stopPropagation())

    // Set in cleanup; async continuations (fetches, createImageBitmap) check it
    // so they don't write to torn-down state after unmount / dimension change.
    let destroyed = false

    let W = container.clientWidth  || 800
    let H = container.clientHeight || 600

    const st = {
      cam:                { cx: 0, cz: 0, scale: 1 },
      cache:              new Map<string, 'empty' | 'error' | THREE.Mesh>(),
      dataCache:          new Map<string, ChunkData>(),
      texVersion:         0,
      texVersionAtRender: new Map<string, number>(),
      lastBcCount:        0,
      lastConfig:         null as RenderConfig | null,
      lastDebugMode:      false,
      chunkPixels:        new Map<string, number>(),
      resolving:          new Set<string>(),
      pendingSet:         new Set<string>(),
      pending:            [] as Array<[number, number, string]>,
      // Chunks awaiting time-sliced placement: either freshly fetched (data) or
      // restored from the CPU tile cache (bitmap).
      renderQueue:        [] as Array<{ key: string; mcx: number; mcz: number; data?: ChunkData; bitmap?: ImageBitmap }>,
      renderSet:          new Set<string>(),
      sorted:             [] as [number, number][],
      sortBounds:         null as { L: number; R: number; T: number; B: number } | null,
      activeBatches:      0,
      liveChunks:         0,  // count of chunk meshes currently in the scene (GPU budget)
      // ── Region-tile LOD (zoomed-out overview) ──
      regionTiled:        new Set<string>(),   // regions with a rendered tile applied
      regionFailed:       new Set<string>(),   // empty/error regions — don't retry
      regionResolving:    new Set<string>(),   // surface fetch in flight
      regionPending:      [] as Array<[number, number, string]>,
      regionPendingSet:   new Set<string>(),
      regionRenderQueue:  [] as Array<{ key: string; rx: number; rz: number; surface: RegionSurface }>,
      regionRenderSet:    new Set<string>(),
      activeRegionFetches: 0,
      // Bumped only on colour-map / render-config changes (not texture loads), so
      // region tiles re-render when the look changes without thrashing on every
      // texture that streams in.
      lodVersion:         0,
      regionLodVersion:   0,
      regionSet:          new Set<string>(),
      isDragging:         false,
      lastMouse:          null as { x: number; y: number } | null,
      mouseWorldX:        null as number | null,
      mouseWorldZ:        null as number | null,
      firstChunkLogged:   false,
      // ── Render gate ── skip the RAF heavy passes + GPU draw when the view is
      // idle (camera still, nothing loading, no re-render pending).
      lastCam:            { cx: NaN, cz: NaN, scale: NaN },
      forceFrame:         true,   // one-shot: force a render next frame
      staleWork:          false,  // chunk re-renders still catching up to texVersion
      lastTexKeysRef:     undefined as Record<number, string> | undefined,
      texKeyCount:        0,      // cached for the HUD (no per-frame Object.keys)
      lastHud:            '',     // last HUD string (skip redundant DOM writes)
    }

    const unsubTextures = onTextureLoad(() => { st.texVersion++; st.forceFrame = true })

    const mapScene = new MapScene(container, W, H)
    const { scene, chunkGeo, regionGeo, regionMat, chunkGroup } = mapScene
    const updateCam  = () => mapScene.updateCam(st.cam, W, H)
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
      st.resolving.clear()
      st.pendingSet.clear()
      st.pending.length = 0
      for (const item of st.renderQueue) item.bitmap?.close()  // orphaned restores
      st.renderQueue.length = 0
      st.renderSet.clear()
      st.activeBatches  = 0
      st.liveChunks     = 0
      tileCache.clear()
    }

    function fitCamera() {
      const regs = regionsRef.current
      if (regs.length === 0) return

      // Compute median X and Z so a single distant outlier region (e.g. a mod dimension
      // that wrote chunks at extreme coordinates) cannot pull the initial view off into space.
      const xs = regs.map(r => r.region_x).sort((a, b) => a - b)
      const zs = regs.map(r => r.region_z).sort((a, b) => a - b)
      const mid = Math.floor(xs.length / 2)
      const medX = xs.length % 2 === 0 ? (xs[mid - 1] + xs[mid]) / 2 : xs[mid]
      const medZ = zs.length % 2 === 0 ? (zs[mid - 1] + zs[mid]) / 2 : zs[mid]

      // Drop regions more than 200 region-units (~100 km) from the median.
      // This removes genuine outliers while preserving any legitimately large world.
      const MAX_DIST = 200
      const core = regs.filter(
        r => Math.abs(r.region_x - medX) <= MAX_DIST && Math.abs(r.region_z - medZ) <= MAX_DIST
      )
      const active = core.length > 0 ? core : regs

      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
      for (const r of active) {
        if (r.region_x < minX) minX = r.region_x
        if (r.region_x > maxX) maxX = r.region_x
        if (r.region_z < minZ) minZ = r.region_z
        if (r.region_z > maxZ) maxZ = r.region_z
      }
      st.cam.cx    = ((minX + maxX) / 2) * 512 + 256
      st.cam.cz    = ((minZ + maxZ) / 2) * 512 + 256
      const worldW = (maxX - minX + 1) * 512
      const worldH = (maxZ - minZ + 1) * 512
      st.cam.scale = Math.max(MIN_SCALE, Math.min(W / worldW, H / worldH, 2))
      updateCam()
    }

    function syncRegions() {
      for (const [key, m] of regionMeshes) {
        revertRegionTile(key, m)  // dispose any per-region tile material
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
      st.forceFrame = true   // region meshes changed — render even if fitCamera no-ops
    }

    syncRegionsRef.current = syncRegions
    fitCameraRef.current   = fitCamera
    syncRegions()

    // ── Chunk rendering (time-sliced; called from the RAF loop) ──
    // Paints one fetched chunk's canvas, uploads it, and places its mesh.
    // Heavy: capped per frame by the loop so a burst of arrivals doesn't stall.
    function renderAndPlaceChunk(key: string, mcx: number, mcz: number, data: ChunkData) {
      const dbg = debugModeRef.current
      st.renderSet.delete(key)

      if (!st.firstChunkLogged) {
        st.firstChunkLogged = true
        const s0      = data.sections[0]
        const nonzero = s0 ? s0.blocks.filter((b) => b !== 0).length : 0
        console.log(
          `[atlas] first chunk ${mcx},${mcz}: ${data.sections.length} sections, ` +
            `section[0].y=${s0?.y}, nonzero=${nonzero}`,
        )
      }
      if (dbg) {
        const s0 = data.sections[0]
        console.log(
          `[atlas:chunk] parsed    ${mcx},${mcz}` +
          ` — ${data.sections.length} sections` +
          ` biomes=${data.biomes.length}` +
          ` s0.y=${s0?.y ?? 'none'}`,
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
      )
      textureDebugStore.addChunkStats(stats)

      // ── Canvas pixel diagnostic ──
      let pixels = -2  // -2 = not checked
      if (dbg) {
        const ms  = (performance.now() - t0).toFixed(1)
        const pct = stats.drawImage + stats.fillRect > 0
          ? ((stats.drawImage / (stats.drawImage + stats.fillRect)) * 100).toFixed(0)
          : '0'
        pixels = canvasDiagnostics(image)
        const pixStr =
          pixels === -1 ? '⚠ TAINTED (cross-origin — WebGL upload blocked)' :
          pixels === 0  ? '⚠ EMPTY (drawImage ran but canvas has no pixels)' :
          `${pixels} non-black pixels`
        console.log(
          `[atlas:chunk] canvas    ${mcx},${mcz}` +
          ` | ${ms}ms` +
          ` | drawImage=${stats.drawImage} (${pct}%) fillRect=${stats.fillRect}` +
          ` | pixels=${pixStr}`,
        )
        st.chunkPixels.set(key, pixels)
      }

      // ── Upload to GPU ──
      st.dataCache.set(key, data)
      const texFilter = configRef.current.textureFilter ?? 'pixel'
      const uploadCanvas = texFilter === 'journeymap' ? upscaleCanvas(image, 512) : image
      const chunkTex = makeChunkTexture(uploadCanvas, texFilter)
      if (dbg) {
        console.log(
          `[atlas:chunk] texture   ${mcx},${mcz}` +
          ` — needsUpdate=${chunkTex.needsUpdate}` +
          ` uuid=${chunkTex.uuid}`,
        )
      }

      const mat  = new THREE.MeshBasicMaterial({ map: chunkTex })
      const mesh = new THREE.Mesh(chunkGeo, mat)
      mesh.position.set(mcx * 16 + 8, -(mcz * 16 + 8), 0)
      chunkGroup.add(mesh)

      if (dbg) {
        const outlineState: ChunkOutlineState =
          pixels === -1 ? 'tainted' :
          pixels ===  0 ? 'empty'   :
          'loaded'
        console.log(
          `[atlas:chunk] mesh      ${mcx},${mcz}` +
          ` — visible=${mesh.visible}` +
          ` pos=(${mesh.position.x},${mesh.position.y},${mesh.position.z})` +
          ` tex=${chunkTex.uuid}` +
          ` → outline=${outlineState}`,
        )
        outlines.set(key, mcx, mcz, outlineState, debugModeRef.current)
      }

      st.cache.set(key, mesh)
      st.texVersionAtRender.set(key, st.texVersion)
      st.liveChunks++
    }

    function makeBitmapTexture(bitmap: ImageBitmap, filter: TextureFilter): THREE.Texture {
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
    function placeRestoredChunk(key: string, mcx: number, mcz: number, bitmap: ImageBitmap) {
      st.renderSet.delete(key)
      const filter = configRef.current.textureFilter ?? 'pixel'
      const mesh = new THREE.Mesh(chunkGeo, new THREE.MeshBasicMaterial({ map: makeBitmapTexture(bitmap, filter) }))
      mesh.position.set(mcx * 16 + 8, -(mcz * 16 + 8), 0)
      chunkGroup.add(mesh)
      st.cache.set(key, mesh)
      // Tagged valid at the version the cache hit matched, so the stale-render
      // pass leaves it alone until the look actually changes.
      st.texVersionAtRender.set(key, st.texVersion)
      st.liveChunks++
      if (debugModeRef.current) outlines.set(key, mcx, mcz, 'loaded', debugModeRef.current)
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
      const src = mat.map?.image  // canvas (cold) or ImageBitmap (restored)
      const ver = st.texVersionAtRender.get(key) ?? st.texVersion
      if (src) {
        // Bake the vertical flip into the cached bitmap when capturing from a
        // canvas (CanvasTexture uploads with flipY=true). A bitmap source is
        // already in this orientation, so copy it as-is.
        const opts: ImageBitmapOptions | undefined =
          src instanceof HTMLCanvasElement ? { imageOrientation: 'flipY' } : undefined
        createImageBitmap(src, opts)
          .then((bmp) => {
            // The effect may have torn down (and cleared the cache) while we
            // decoded — drop the bitmap instead of leaking it into a dead cache.
            if (destroyed) { bmp.close(); return }
            tileCache.put(key, bmp, ver)
          })
          .catch(() => {})
          .finally(() => { if (src instanceof ImageBitmap) src.close() })
      }
      mat.map?.dispose()
      mat.dispose()
      st.cache.delete(key)
      st.dataCache.delete(key)
      st.texVersionAtRender.delete(key)
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
      live.sort((a, b) => b.d - a.d)  // farthest first
      const evictCount = st.liveChunks - maxLive
      for (let i = 0; i < evictCount && i < live.length; i++) {
        evictChunkToCache(live[i].key, live[i].mesh)
      }
    }

    // Recentre the live detail set on the camera: evict live chunks outside the
    // keep region (viewport + evict margin), freeing GPU budget so the detail
    // layer follows the view.  The margin gives hysteresis so chunks just off the
    // edge linger — panning back restores them with no reload.
    function reconcileLiveChunks(kL: number, kR: number, kT: number, kB: number) {
      for (const [key, entry] of st.cache) {
        if (!(entry instanceof THREE.Mesh)) continue
        const ci = key.indexOf(',')
        const mcx = +key.slice(0, ci), mcz = +key.slice(ci + 1)
        if (mcx < kL || mcx > kR || mcz < kT || mcz > kB) evictChunkToCache(key, entry)
      }
    }

    // Render queued chunks until the per-frame time budget is spent (at least
    // one, so progress is always made even if a single render is expensive).
    function drainRenderQueue() {
      if (st.renderQueue.length === 0) return
      const deadline = performance.now() + RENDER_BUDGET_MS
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
        for (const [mcx, mcz, key] of items) outlines.set(key, mcx, mcz, 'rendering', debugModeRef.current)
      }
      try {
        const coords = items.map(([mcx, mcz]) => [mcx, mcz] as [number, number])
        const chunks = await fetchChunkBatch(dimensionPath, coords)

        const returned = new Set<string>()
        for (const data of chunks) {
          const key = `${data.chunk_x},${data.chunk_z}`
          returned.add(key)
          st.resolving.delete(key)
          st.renderSet.add(key)
          st.renderQueue.push({ key, mcx: data.chunk_x, mcz: data.chunk_z, data })
        }
        // Requested-but-not-returned chunks have no terrain yet.
        for (const [mcx, mcz, key] of items) {
          if (returned.has(key)) continue
          st.resolving.delete(key)
          st.cache.set(key, 'empty')
          if (dbg) outlines.set(key, mcx, mcz, 'empty', debugModeRef.current)
        }
      } catch (err) {
        for (const [mcx, mcz, key] of items) {
          st.resolving.delete(key)
          st.cache.set(key, 'error')
          if (dbg) outlines.set(key, mcx, mcz, 'error', debugModeRef.current)
        }
        if (dbg) console.error('[atlas:chunk] batch exception', err)
      } finally {
        st.activeBatches--
        drainQueue()
      }
    }

    function drainQueue() {
      while (st.activeBatches < MAX_CONCURRENT_BATCHES && st.pending.length > 0) {
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
      const rx = mcx >> 5, rz = mcz >> 5
      if (!st.regionSet.has(`${rx},${rz}`)) { st.cache.set(key, 'empty'); return false }

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
      st.activeRegionFetches = 0
    }

    function renderAndPlaceRegionTile(key: string, _rx: number, _rz: number, surface: RegionSurface) {
      st.regionRenderSet.delete(key)
      const mesh = regionMeshes.get(key)
      if (!mesh) return  // region no longer present (world changed)
      const canvas = renderRegionTile(
        surface,
        blockColorsRef.current,
        registryRef.current,
        configRef.current,
      )
      if (mesh.material !== regionMat) {
        const old = mesh.material as THREE.MeshBasicMaterial
        old.map?.dispose(); old.dispose()
      }
      mesh.material = new THREE.MeshBasicMaterial({ map: makeRegionTexture(canvas) })
      st.regionTiled.add(key)
    }

    function drainRegionRenderQueue() {
      if (st.regionRenderQueue.length === 0) return
      const deadline = performance.now() + RENDER_BUDGET_MS
      do {
        const item = st.regionRenderQueue.shift()!
        if (st.regionRenderSet.has(item.key)) {
          renderAndPlaceRegionTile(item.key, item.rx, item.rz, item.surface)
        }
      } while (st.regionRenderQueue.length > 0 && performance.now() < deadline)
    }

    async function fetchRegionTile(rx: number, rz: number, key: string) {
      try {
        const surface = await fetchRegionSurface(dimensionPath, rx, rz)
        if (surface.chunks.length === 0) {
          st.regionFailed.add(key)
        } else {
          st.regionRenderSet.add(key)
          st.regionRenderQueue.push({ key, rx, rz, surface })
        }
      } catch {
        st.regionFailed.add(key)
      } finally {
        st.regionResolving.delete(key)
        st.activeRegionFetches--
        drainRegionQueue()
      }
    }

    function drainRegionQueue() {
      while (
        st.activeRegionFetches < MAX_CONCURRENT_REGION_FETCHES &&
        st.regionPending.length > 0
      ) {
        const item = st.regionPending.shift()!
        const key  = item[2]
        st.regionPendingSet.delete(key)
        st.regionResolving.add(key)
        st.activeRegionFetches++
        void fetchRegionTile(item[0], item[1], key)
      }
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
      live.sort((a, b) => b.d - a.d)  // farthest first
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
      const rt = debugModeRef.current ? textureDebugStore.getRenderTotals() : null
      const hudX = st.mouseWorldX !== null ? Math.round(st.mouseWorldX) : Math.round(st.cam.cx)
      const hudZ = st.mouseWorldZ !== null ? Math.round(st.mouseWorldZ) : Math.round(st.cam.cz)
      const text =
        `X ${hudX}  Z ${hudZ}  ×${st.cam.scale.toFixed(2)}` +
        `  |  ${st.liveChunks} chunks` +
        (bcCountRef.current > 0 ? `  |  ${bcCountRef.current} colors` : '') +
        (st.texKeyCount > 0 ? `  |  ${st.texKeyCount} tex-keys` : '') +
        (rt
          ? `  |  drawImage=${rt.drawImage} fillRect=${rt.fillRect}` +
            ` miss=${rt.missingTexKey} fail=${rt.failedTexLoad}`
          : '')
      if (text !== st.lastHud) {
        hud.textContent = text
        st.lastHud = text
      }
    }

    function loop() {
      const { cx, cz, scale } = st.cam
      const halfW = W / (2 * scale), halfH = H / (2 * scale)

      // Detect color-map or render-config changes and trigger re-render.
      // lodVersion also bumps so region tiles re-render (texVersion alone can't —
      // it also fires on every streamed texture, which tiles don't use).
      const bcCount = bcCountRef.current
      if (bcCount !== st.lastBcCount) {
        st.lastBcCount = bcCount
        st.texVersion++
        st.lodVersion++
        st.forceFrame = true
      }
      const cfg = configRef.current
      if (cfg !== st.lastConfig) {
        st.lastConfig = cfg
        st.texVersion++
        st.lodVersion++
        st.forceFrame = true
      }

      // Detect debug mode toggle — add/remove outlines for existing chunks
      const dbgNow = debugModeRef.current
      if (dbgNow !== st.lastDebugMode) {
        st.lastDebugMode = dbgNow
        st.forceFrame = true
        if (dbgNow) {
          for (const [key, entry] of st.cache) {
            const [mxs, mzs] = key.split(',')
            const mcx = parseInt(mxs), mcz = parseInt(mzs)
            if (entry instanceof THREE.Mesh) {
              const px = st.chunkPixels.get(key) ?? -2
              const s: ChunkOutlineState = px === -1 ? 'tainted' : px === 0 ? 'empty' : 'loaded'
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
        cx !== st.lastCam.cx || cz !== st.lastCam.cz || scale !== st.lastCam.scale
      const pendingWork =
        st.renderQueue.length > 0 || st.regionRenderQueue.length > 0 ||
        st.pending.length > 0 || st.resolving.size > 0 || st.renderSet.size > 0 ||
        st.regionPending.length > 0 || st.regionResolving.size > 0 ||
        st.regionRenderSet.size > 0 || st.activeBatches > 0 || st.activeRegionFetches > 0
      if (!(st.forceFrame || camMoved || st.staleWork || pendingWork)) {
        updateHud()
        rafId = requestAnimationFrame(loop)
        return
      }

      // Re-render stale chunks (max 4 per frame) when textures or colors changed
      if (st.texVersion > 0) {
        let rerendered = 0
        let moreStale = false
        const staleNoData: string[] = []
        for (const [key, entry] of st.cache) {
          if (!(entry instanceof THREE.Mesh)) continue
          if ((st.texVersionAtRender.get(key) ?? 0) >= st.texVersion) continue
          const chunkData = st.dataCache.get(key)
          if (chunkData) {
            if (rerendered >= 4) { moreStale = true; continue }
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
            )
            textureDebugStore.addChunkStats(reStats)
            if (debugModeRef.current) {
              const px = canvasDiagnostics(newImg)
              st.chunkPixels.set(key, px)
              const [mxs, mzs] = key.split(',')
              const s: ChunkOutlineState = px === -1 ? 'tainted' : px === 0 ? 'empty' : 'loaded'
              outlines.set(key, parseInt(mxs), parseInt(mzs), s, debugModeRef.current)
            }
            const mat = entry.material as THREE.MeshBasicMaterial
            mat.map?.dispose()
            const texFilter = configRef.current.textureFilter ?? 'pixel'
            const uploadCanvas = texFilter === 'journeymap' ? upscaleCanvas(newImg, 512) : newImg
            mat.map = makeChunkTexture(uploadCanvas, texFilter)
            mat.needsUpdate = true
            st.texVersionAtRender.set(key, st.texVersion)
            rerendered++
          } else {
            staleNoData.push(key)
          }
        }
        // Restored tiles have no block data to re-render — drop them so they
        // reload at the new version (from the cache if revalidated, else fetch).
        for (const key of staleNoData) {
          const entry = st.cache.get(key)
          if (entry instanceof THREE.Mesh) disposeLiveChunk(key, entry)
        }
        // Keep frames coming until the re-render backlog is cleared.
        st.staleWork = moreStale
      }

      // Render freshly-fetched chunks and region tiles, time-sliced, for a smooth UI.
      drainRenderQueue()
      drainRegionRenderQueue()

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
        const cCx = Math.round(cx / 16), cCz = Math.round(cz / 16)
        const maxLive =
          (configRef.current.textureFilter ?? 'pixel') === 'journeymap'
            ? MAX_LIVE_CHUNKS_JOURNEYMAP
            : MAX_LIVE_CHUNKS_PIXEL

        // Distance-evict to stay within the GPU budget (runs in both modes so
        // panning the overview still bounds VRAM).
        enforceChunkBudget(cCx, cCz, maxLive)

        if (chunkActive) {
          const cL = Math.floor((cx - halfW) / 16), cR = Math.floor((cx + halfW) / 16)
          const cT = Math.floor((cz - halfH) / 16), cB = Math.floor((cz + halfH) / 16)

          const bv = st.sortBounds
          if (!bv || bv.L !== cL || bv.R !== cR || bv.T !== cT || bv.B !== cB) {
            // Queue region = viewport + preload margin (load ahead of the view).
            const qL = cL - CHUNK_PRELOAD_MARGIN, qR = cR + CHUNK_PRELOAD_MARGIN
            const qT = cT - CHUNK_PRELOAD_MARGIN, qB = cB + CHUNK_PRELOAD_MARGIN
            st.sorted.length = 0
            for (let z2 = qT; z2 <= qB; z2++)
              for (let x2 = qL; x2 <= qR; x2++)
                st.sorted.push([x2, z2])
            st.sorted.sort(
              (a, bsv) =>
                (a[0]-cCx)**2+(a[1]-cCz)**2 - ((bsv[0]-cCx)**2+(bsv[1]-cCz)**2),
            )
            st.sortBounds = { L: cL, R: cR, T: cT, B: cB }
            // Recentre the detail layer: evict chunks outside the keep region
            // (viewport + larger evict margin) so it follows the view smoothly.
            reconcileLiveChunks(
              cL - CHUNK_EVICT_MARGIN, cR + CHUNK_EVICT_MARGIN,
              cT - CHUNK_EVICT_MARGIN, cB + CHUNK_EVICT_MARGIN,
            )
          }

          // Queue nearest-first, but never commit more chunks than the GPU budget
          // allows — chunks beyond the cap would only be evicted, causing thrash.
          let committed =
            st.liveChunks + st.renderQueue.length + st.resolving.size + st.pending.length
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
        const rCx = Math.round(cx / 512), rCz = Math.round(cz / 512)
        enforceRegionBudget(rCx, rCz)

        const rL = Math.floor((cx - halfW) / 512), rR = Math.floor((cx + halfW) / 512)
        const rT = Math.floor((cz - halfH) / 512), rB = Math.floor((cz + halfH) / 512)
        const vis: Array<[number, number]> = []
        for (let z2 = rT; z2 <= rB; z2++)
          for (let x2 = rL; x2 <= rR; x2++)
            vis.push([x2, z2])
        vis.sort(
          (a, bsv) =>
            (a[0]-rCx)**2+(a[1]-rCz)**2 - ((bsv[0]-rCx)**2+(bsv[1]-rCz)**2),
        )

        let committed =
          st.regionTiled.size + st.regionResolving.size +
          st.regionPending.length + st.regionRenderSet.size
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

    async function onContextMenu(e: MouseEvent) {
      await showBlockInspector({
        event: e, el, inspector, w: W, h: H,
        cam: st.cam, dataCache: st.dataCache, dimensionPath,
        isDestroyed: () => destroyed,
        registry: registryRef.current,
        blockColors: blockColorsRef.current,
        blockNames: blockNamesRef.current,
        textureKeys: textureKeysRef.current,
        metaTextureKeys: metaTextureKeysRef.current,
      })
    }

    const resizeObs = new ResizeObserver(() => {
      W = container.clientWidth || 800; H = container.clientHeight || 600
      mapScene.resize(W, H); updateCam(); st.forceFrame = true
    })
    resizeObs.observe(container)
    updateCam()

    const detachInput = attachMapInput({
      el, inspector, state: st, updateCam, fitCamera,
      getDims: () => ({ w: W, h: H }),
      minScale: MIN_SCALE, maxScale: MAX_SCALE, onContextMenu,
    })

    return () => {
      destroyed = true
      unsubTextures()
      syncRegionsRef.current = null
      fitCameraRef.current   = null
      cancelAnimationFrame(rafId)
      resizeObs.disconnect()
      detachInput()
      clearChunkCache()   // also removes outlines and clears chunkPixels
      for (const [key, m] of regionMeshes) revertRegionTile(key, m)  // dispose tile materials
      mapScene.dispose()
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
        className="absolute right-2 top-2 rounded bg-black/60 px-2 py-1 font-mono text-xs text-zinc-300 hover:bg-black/80"
        title="Fit camera to world (F / Home)"
      >
        ⌖ fit
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
