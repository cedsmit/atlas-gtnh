import { useEffect, useRef } from 'react'
import * as THREE from 'three'

import type { BlockColorMap } from '../api/blockColors'
import type { ChunkData } from '../api/chunks'
import type { RegionSummary } from '../api/regions'
import { API_BASE } from '../lib/api'
import { biomeTints, blockColorRGB, FOLIAGE_TINTED_IDS, GRASS_TINTED_IDS } from '../lib/blockColors'

const WATER_IDS = new Set([8, 9])

// ── Chunk pixel renderer ───────────────────────────────────────────────
function renderChunkImage(
  data: ChunkData,
  colorMap?: BlockColorMap
): HTMLCanvasElement {
  // Pre-compute biome tints for all 256 columns (x + z*16)
  const grassTints: Array<readonly [number, number, number]> = new Array(256)
  const foliageTints: Array<readonly [number, number, number]> = new Array(256)
  for (let i = 0; i < 256; i++) {
    const biomeId = data.biomes.length === 256 ? data.biomes[i] : 1 // default: Plains
    const t = biomeTints(biomeId)
    grassTints[i] = t.grass
    foliageTints[i] = t.foliage
  }

  const sections = [...data.sections].sort((a, b) => b.y - a.y)

  // ── Pass 1: find top block at every (x,z) ─────────────────────────
  // topY   = absolute world Y of the top solid block (-1 = void)
  // topId  = block ID at that position
  // topMeta = block metadata at that position
  // For water: topFloorY = Y of the first non-water block below the surface
  const topY    = new Int16Array(256).fill(-1)
  const topId   = new Uint16Array(256)
  const topMeta = new Uint8Array(256)
  const floorY  = new Int16Array(256).fill(-1) // only set when top is water

  for (let z = 0; z < 16; z++) {
    for (let x = 0; x < 16; x++) {
      const i = z * 16 + x
      let foundSurface = false
      let inWater = false

      outer: for (const section of sections) {
        for (let y = 15; y >= 0; y--) {
          const idx = (y << 8) | (z << 4) | x
          const id = section.blocks[idx]
          if (id === 0) continue

          const absY = section.y * 16 + y

          if (!foundSurface) {
            topY[i] = absY
            topId[i] = id
            topMeta[i] = section.data[idx]
            foundSurface = true
            inWater = WATER_IDS.has(id)
            if (!inWater) break outer
            // water surface found — keep scanning for the floor block
          } else if (inWater && !WATER_IDS.has(id)) {
            floorY[i] = absY
            break outer
          }
        }
      }
    }
  }

  // ── Pass 2: paint pixels with slope-based hill shading ────────────
  const offscreen = document.createElement('canvas')
  offscreen.width = 16
  offscreen.height = 16
  const ctx = offscreen.getContext('2d')!
  const imageData = ctx.createImageData(16, 16)
  const pixels = imageData.data

  for (let z = 0; z < 16; z++) {
    for (let x = 0; x < 16; x++) {
      const i = z * 16 + x
      const p = i * 4

      const blockY = topY[i]
      if (blockY < 0) {
        pixels[p] = 10; pixels[p+1] = 10; pixels[p+2] = 10; pixels[p+3] = 255
        continue
      }

      const id = topId[i]
      const meta = topMeta[i]
      let r: number, g: number, b: number

      // Biome-tinted blocks: grass and foliage colors come straight from the
      // biome tint table rather than the block color lookup.
      if (GRASS_TINTED_IDS.has(id)) {
        ;[r, g, b] = grassTints[i]
      } else if (FOLIAGE_TINTED_IDS.has(id)) {
        ;[r, g, b] = foliageTints[i]
      } else if (WATER_IDS.has(id)) {
        // Render water: floor color tinted blue, darkened by depth
        const floor = floorY[i]
        const depth = floor >= 0 ? Math.min(blockY - floor, 20) : 10
        // start from a medium blue and fade toward a deep navy with depth
        r = Math.max(10, 40 - depth * 1.5)
        g = Math.max(30, 80 - depth * 2)
        b = Math.min(255, 160 + depth * 3)
      } else {
        const mapped = colorMap?.[id]
        const raw = mapped ?? blockColorRGB(id, meta)
        r = raw[0]; g = raw[1]; b = raw[2]

        // Ensure texture-derived colors are visible (not pitch black)
        if (mapped) {
          const maxCh = Math.max(r, g, b)
          if (maxCh === 0) {
            r = g = b = 130
          } else if (maxCh < 80) {
            const boost = 80 / maxCh
            r = Math.min(255, Math.round(r * boost))
            g = Math.min(255, Math.round(g * boost))
            b = Math.min(255, Math.round(b * boost))
          }
        }
      }

      // Slope shading: compare Y to the south neighbor (z+1).
      // Positive diff = this block is higher → north-facing slope → brighter.
      // Negative diff = lower → south-facing slope → darker.
      let shade = 0
      if (z < 15) {
        const southY = topY[(z + 1) * 16 + x]
        if (southY >= 0) {
          shade = Math.max(-60, Math.min(60, (blockY - southY) * 5))
        }
      }
      // Subtle east–west component for extra depth
      if (x < 15) {
        const eastY = topY[z * 16 + (x + 1)]
        if (eastY >= 0) {
          shade += Math.max(-20, Math.min(20, (blockY - eastY) * 2))
        }
      }

      pixels[p]   = Math.max(0, Math.min(255, r + shade))
      pixels[p+1] = Math.max(0, Math.min(255, g + shade))
      pixels[p+2] = Math.max(0, Math.min(255, b + shade))
      pixels[p+3] = 255
    }
  }

  ctx.putImageData(imageData, 0, 0)
  return offscreen
}

// ── Constants ──────────────────────────────────────────────────────────
const MIN_SCALE = 0.04
const MAX_SCALE = 32
const FETCH_MIN_SCALE = 0.25
const MAX_CONCURRENT = 128
// Three.js coordinate convention used here:
//   Three.js X = Minecraft X
//   Three.js Y = -Minecraft Z   (so north/–Z is visual up)
//   Camera at (cx, -cz, 500) looking toward -Z

interface Props {
  dimensionPath: string
  regions: RegionSummary[]
  blockColors?: BlockColorMap
}

export function WorldMap({ dimensionPath, regions, blockColors }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const hudRef = useRef<HTMLDivElement>(null)

  const blockColorsRef = useRef(blockColors)
  blockColorsRef.current = blockColors
  const bcCountRef = useRef(0)
  bcCountRef.current = Object.keys(blockColors ?? {}).length
  const regionsRef = useRef(regions)
  regionsRef.current = regions

  // Expose a callback so the regions effect can update the live scene
  const syncRegionsRef = useRef<(() => void) | null>(null)

  // ── Main Three.js effect (runs once per dimensionPath) ─────────────
  useEffect(() => {
    const container = containerRef.current!
    const hud = hudRef.current!

    let W = container.clientWidth || 800
    let H = container.clientHeight || 600

    // ── Scene state ──
    const st = {
      cam: { cx: 0, cz: 0, scale: 1 },
      cache: new Map<string, 'empty' | 'error' | THREE.Mesh>(),
      resolving: new Set<string>(), // actually in-flight HTTP requests
      pendingSet: new Set<string>(), // queued but not yet fetching
      pending: [] as Array<[number, number, string]>,
      sorted: [] as [number, number][],
      sortBounds: null as { L: number; R: number; T: number; B: number } | null,
      activeFetches: 0,
      regionSet: new Set<string>(),
      isDragging: false,
      lastMouse: null as { x: number; y: number } | null,
      firstChunkLogged: false,
    }

    // ── Three.js renderer ──
    const renderer = new THREE.WebGLRenderer({ antialias: false })
    renderer.setSize(W, H)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    container.appendChild(renderer.domElement)
    renderer.domElement.style.cursor = 'grab'

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x0f0f0f)

    // OrthographicCamera frustum is set relative to world blocks; updated by updateCam()
    const cam = new THREE.OrthographicCamera(
      -W / 2,
      W / 2,
      H / 2,
      -H / 2,
      0.1,
      2000
    )

    // Shared chunk geometry (all chunk tiles reuse this)
    const chunkGeo = new THREE.PlaneGeometry(16, 16)

    // ── Camera helper ──
    function updateCam() {
      const { cx, cz, scale } = st.cam
      const halfW = W / (2 * scale)
      const halfH = H / (2 * scale)
      cam.left = -halfW
      cam.right = halfW
      cam.top = halfH
      cam.bottom = -halfH
      cam.position.set(cx, -cz, 500)
      cam.lookAt(cx, -cz, 0)
      cam.updateProjectionMatrix()
    }

    // ── Region meshes ──
    const regionMeshes = new Map<string, THREE.Mesh>()
    const regionGeo = new THREE.PlaneGeometry(512, 512)
    const regionMat = new THREE.MeshBasicMaterial({ color: 0x1a1a24 })

    function clearChunkCache() {
      for (const entry of st.cache.values()) {
        if (entry instanceof THREE.Mesh) {
          scene.remove(entry)
          ;(entry.material as THREE.MeshBasicMaterial).map?.dispose()
          ;(entry.material as THREE.MeshBasicMaterial).dispose()
        }
      }
      st.cache.clear()
      st.resolving.clear()
      st.pendingSet.clear()
      st.pending.length = 0
      st.activeFetches = 0
    }

    function syncRegions() {
      // Remove old region meshes
      for (const m of regionMeshes.values()) scene.remove(m)
      regionMeshes.clear()
      st.regionSet.clear()
      clearChunkCache()

      const regs = regionsRef.current // always up-to-date via ref
      for (const r of regs) {
        const key = `${r.region_x},${r.region_z}`
        st.regionSet.add(key)
        const mesh = new THREE.Mesh(regionGeo, regionMat)
        // Three.js position: (Minecraft X center, -Minecraft Z center, -1)
        mesh.position.set(r.region_x * 512 + 256, -(r.region_z * 512 + 256), -1)
        scene.add(mesh)
        regionMeshes.set(key, mesh)
      }

      // Auto-fit camera to all regions
      if (regs.length > 0) {
        let minX = Infinity,
          maxX = -Infinity,
          minZ = Infinity,
          maxZ = -Infinity
        for (const r of regs) {
          if (r.region_x < minX) minX = r.region_x
          if (r.region_x > maxX) maxX = r.region_x
          if (r.region_z < minZ) minZ = r.region_z
          if (r.region_z > maxZ) maxZ = r.region_z
        }
        st.cam.cx = ((minX + maxX) / 2) * 512 + 256
        st.cam.cz = ((minZ + maxZ) / 2) * 512 + 256
        const worldW = (maxX - minX + 1) * 512
        const worldH = (maxZ - minZ + 1) * 512
        st.cam.scale = Math.max(
          FETCH_MIN_SCALE,
          Math.min(W / worldW, H / worldH, 2)
        )
        updateCam()
      }
    }

    // Store callback so the regions useEffect can call it
    syncRegionsRef.current = syncRegions
    syncRegions()

    // ── Grid lines (updated each frame) ──
    const MAX_GRID_VERTS = 8000
    const gridBuf = new Float32Array(MAX_GRID_VERTS * 3)
    const gridAttr = new THREE.BufferAttribute(gridBuf, 3)
    gridAttr.setUsage(THREE.DynamicDrawUsage)
    const gridGeo = new THREE.BufferGeometry()
    gridGeo.setAttribute('position', gridAttr)

    // Region grid (always visible)
    const regionGridLines = new THREE.LineSegments(
      gridGeo,
      new THREE.LineBasicMaterial({ color: 0x2e2e48 })
    )
    regionGridLines.frustumCulled = false
    scene.add(regionGridLines)

    // Chunk grid (high zoom only) — separate geometry so it can be hidden
    const chunkGridBuf = new Float32Array(MAX_GRID_VERTS * 3)
    const chunkGridAttr = new THREE.BufferAttribute(chunkGridBuf, 3)
    chunkGridAttr.setUsage(THREE.DynamicDrawUsage)
    const chunkGridGeo = new THREE.BufferGeometry()
    chunkGridGeo.setAttribute('position', chunkGridAttr)
    const chunkGridLines = new THREE.LineSegments(
      chunkGridGeo,
      new THREE.LineBasicMaterial({ color: 0x1c1c2e })
    )
    chunkGridLines.frustumCulled = false
    scene.add(chunkGridLines)

    function updateGrid() {
      const { cx, cz, scale } = st.cam
      const halfW = W / (2 * scale)
      const halfH = H / (2 * scale)

      const rL = Math.floor((cx - halfW) / 512) - 1
      const rR = Math.ceil((cx + halfW) / 512) + 1
      const rT = Math.floor((cz - halfH) / 512) - 1
      const rB = Math.ceil((cz + halfH) / 512) + 1
      const yTop = -(rT * 512 - 512)
      const yBot = -(rB * 512 + 512)
      const xL = rL * 512 - 512
      const xR = rR * 512 + 512

      let vi = 0
      for (let rx = rL; rx <= rR && vi < MAX_GRID_VERTS - 6; rx++) {
        const x = rx * 512
        gridBuf[vi++] = x
        gridBuf[vi++] = yTop
        gridBuf[vi++] = 0.5
        gridBuf[vi++] = x
        gridBuf[vi++] = yBot
        gridBuf[vi++] = 0.5
      }
      for (let rz = rT; rz <= rB && vi < MAX_GRID_VERTS - 6; rz++) {
        const y = -(rz * 512)
        gridBuf[vi++] = xL
        gridBuf[vi++] = y
        gridBuf[vi++] = 0.5
        gridBuf[vi++] = xR
        gridBuf[vi++] = y
        gridBuf[vi++] = 0.5
      }
      gridAttr.needsUpdate = true
      gridGeo.setDrawRange(0, vi / 3)

      // Chunk grid
      let ci = 0
      if (scale >= 3) {
        const cL = Math.floor((cx - halfW) / 16) - 1
        const cR = Math.ceil((cx + halfW) / 16) + 1
        const cT = Math.floor((cz - halfH) / 16) - 1
        const cB = Math.ceil((cz + halfH) / 16) + 1
        const cyTop = -(cT * 16 - 16)
        const cyBot = -(cB * 16 + 16)
        const cxL = cL * 16 - 16
        const cxR = cR * 16 + 16
        for (let chx = cL; chx <= cR && ci < MAX_GRID_VERTS - 6; chx++) {
          const x = chx * 16
          chunkGridBuf[ci++] = x
          chunkGridBuf[ci++] = cyTop
          chunkGridBuf[ci++] = 0.5
          chunkGridBuf[ci++] = x
          chunkGridBuf[ci++] = cyBot
          chunkGridBuf[ci++] = 0.5
        }
        for (let chz = cT; chz <= cB && ci < MAX_GRID_VERTS - 6; chz++) {
          const y = -(chz * 16)
          chunkGridBuf[ci++] = cxL
          chunkGridBuf[ci++] = y
          chunkGridBuf[ci++] = 0.5
          chunkGridBuf[ci++] = cxR
          chunkGridBuf[ci++] = y
          chunkGridBuf[ci++] = 0.5
        }
      }
      chunkGridAttr.needsUpdate = true
      chunkGridGeo.setDrawRange(0, ci / 3)
    }

    // ── Chunk loading ──
    async function fetchChunk(mcx: number, mcz: number, key: string) {
      const colors = blockColorsRef.current
      try {
        const res = await fetch(
          `${API_BASE}/worlds/chunks/${mcx}/${mcz}?world_path=${encodeURIComponent(dimensionPath)}`
        )
        if (res.status === 404) {
          st.cache.set(key, 'empty')
        } else if (!res.ok) {
          st.cache.set(key, 'error')
        } else {
          const data = (await res.json()) as ChunkData
          if (!st.firstChunkLogged) {
            st.firstChunkLogged = true
            const s0 = data.sections[0]
            const nonzero = s0 ? s0.blocks.filter((b) => b !== 0).length : 0
            console.log(
              `[atlas] first chunk ${mcx},${mcz}: ${data.sections.length} sections, ` +
                `section[0].y=${s0?.y}, nonzero blocks=${nonzero}, ` +
                `sample=${s0?.blocks.slice(0, 8).join(',')}`
            )
          }
          const image = renderChunkImage(data, colors)
          const texture = new THREE.CanvasTexture(image)
          texture.colorSpace = THREE.SRGBColorSpace
          texture.magFilter = THREE.NearestFilter
          texture.minFilter = THREE.NearestFilter
          texture.generateMipmaps = false
          const mat = new THREE.MeshBasicMaterial({ map: texture })
          const mesh = new THREE.Mesh(chunkGeo, mat)
          // Three.js position: center of chunk tile
          mesh.position.set(mcx * 16 + 8, -(mcz * 16 + 8), 0)
          scene.add(mesh)
          st.cache.set(key, mesh)
        }
      } catch {
        st.cache.set(key, 'error')
      } finally {
        st.resolving.delete(key)
        st.activeFetches--
        drainQueue()
      }
    }

    function drainQueue() {
      while (st.activeFetches < MAX_CONCURRENT && st.pending.length > 0) {
        const item = st.pending.shift()!
        const key = item[2]
        st.pendingSet.delete(key)
        st.resolving.add(key)
        st.activeFetches++
        void fetchChunk(...item)
      }
    }

    function maybeQueue(mcx: number, mcz: number) {
      const key = `${mcx},${mcz}`
      if (st.cache.has(key) || st.resolving.has(key) || st.pendingSet.has(key))
        return
      const rx = mcx >> 5
      const rz = mcz >> 5
      if (!st.regionSet.has(`${rx},${rz}`)) {
        st.cache.set(key, 'empty')
        return
      }
      st.pendingSet.add(key)
      st.pending.push([mcx, mcz, key])
      drainQueue()
    }

    // ── RAF loop ──
    let rafId: number

    function loop() {
      const { cx, cz, scale } = st.cam
      const halfW = W / (2 * scale)
      const halfH = H / (2 * scale)

      if (scale >= FETCH_MIN_SCALE) {
        const cL = Math.floor((cx - halfW) / 16)
        const cR = Math.floor((cx + halfW) / 16)
        const cT = Math.floor((cz - halfH) / 16)
        const cB = Math.floor((cz + halfH) / 16)

        const b = st.sortBounds
        if (!b || b.L !== cL || b.R !== cR || b.T !== cT || b.B !== cB) {
          const cCx = Math.round(cx / 16)
          const cCz = Math.round(cz / 16)
          st.sorted.length = 0
          for (let z2 = cT; z2 <= cB; z2++) {
            for (let x2 = cL; x2 <= cR; x2++) {
              st.sorted.push([x2, z2])
            }
          }
          st.sorted.sort(
            (a, b) =>
              (a[0] - cCx) ** 2 +
              (a[1] - cCz) ** 2 -
              ((b[0] - cCx) ** 2 + (b[1] - cCz) ** 2)
          )
          st.sortBounds = { L: cL, R: cR, T: cT, B: cB }
        }

        for (const [cx2, cz2] of st.sorted) {
          maybeQueue(cx2, cz2)
        }
      }

      updateGrid()
      renderer.render(scene, cam)

      // HUD (direct DOM write — no React re-render)
      const bcCount = bcCountRef.current
      const loaded = [...st.cache.values()].filter(
        (e) => e instanceof THREE.Mesh
      ).length
      hud.textContent = `X ${Math.round(cx)}  Z ${Math.round(cz)}  ×${scale.toFixed(2)}  |  ${loaded} loaded${bcCount > 0 ? `  |  ${bcCount} block colors` : ''}`

      rafId = requestAnimationFrame(loop)
    }
    rafId = requestAnimationFrame(loop)

    // ── Mouse / wheel ──
    const el = renderer.domElement

    function onMouseDown(e: MouseEvent) {
      st.isDragging = true
      st.lastMouse = { x: e.clientX, y: e.clientY }
      el.style.cursor = 'grabbing'
    }
    function onMouseMove(e: MouseEvent) {
      if (!st.isDragging || !st.lastMouse) return
      st.cam.cx -= (e.clientX - st.lastMouse.x) / st.cam.scale
      st.cam.cz -= (e.clientY - st.lastMouse.y) / st.cam.scale
      st.lastMouse = { x: e.clientX, y: e.clientY }
      st.pending.length = 0
      st.pendingSet.clear()
      updateCam()
    }
    function onMouseUp() {
      st.isDragging = false
      st.lastMouse = null
      el.style.cursor = 'grab'
    }
    function onDblClick(e: MouseEvent) {
      e.preventDefault()
      const input = prompt('Go to coordinates — enter X, Z:')
      if (!input) return
      const parts = input.split(',').map((p) => parseFloat(p.trim()))
      if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
        st.cam.cx = parts[0]
        st.cam.cz = parts[1]
        st.cam.scale = Math.max(st.cam.scale, FETCH_MIN_SCALE)
        updateCam()
      }
    }
    function onWheel(e: WheelEvent) {
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top
      const worldX = st.cam.cx + (mx - W / 2) / st.cam.scale
      const worldZ = st.cam.cz + (my - H / 2) / st.cam.scale
      const factor = e.deltaY < 0 ? 1.25 : 1 / 1.25
      st.cam.scale = Math.max(
        MIN_SCALE,
        Math.min(MAX_SCALE, st.cam.scale * factor)
      )
      st.cam.cx = worldX - (mx - W / 2) / st.cam.scale
      st.cam.cz = worldZ - (my - H / 2) / st.cam.scale
      st.pending.length = 0
      st.pendingSet.clear()
      updateCam()
    }

    const resizeObs = new ResizeObserver(() => {
      W = container.clientWidth || 800
      H = container.clientHeight || 600
      renderer.setSize(W, H)
      updateCam()
    })
    resizeObs.observe(container)
    updateCam()

    el.addEventListener('mousedown', onMouseDown)
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    el.addEventListener('wheel', onWheel, { passive: false })
    el.addEventListener('dblclick', onDblClick)

    return () => {
      syncRegionsRef.current = null
      cancelAnimationFrame(rafId)
      resizeObs.disconnect()
      el.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('dblclick', onDblClick)
      clearChunkCache()
      chunkGeo.dispose()
      regionGeo.dispose()
      gridGeo.dispose()
      chunkGridGeo.dispose()
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [dimensionPath]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Update regions without tearing down the renderer ──────────────
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
    </div>
  )
}
