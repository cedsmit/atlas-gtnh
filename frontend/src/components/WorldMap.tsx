import { useEffect, useRef } from 'react'

import type { ChunkData } from '../api/chunks'
import type { RegionSummary } from '../api/regions'
import { API_BASE } from '../lib/api'
import { blockColorRGB } from '../lib/blockColors'
import { loadCachedChunk, saveCachedChunk } from '../lib/chunkCache'

interface Camera {
  cx: number // world block X at center of view
  cz: number // world block Z at center of view
  scale: number // pixels per block
}

type CacheEntry = HTMLCanvasElement | 'loading' | 'empty' | 'error'

interface Props {
  dimensionPath: string
  regions: RegionSummary[]
}

const MAX_CONCURRENT = 4
const MIN_SCALE = 0.125
const MAX_SCALE = 16
// Only fetch chunk block data when zoomed in enough to see it
const FETCH_MIN_SCALE = 1

function renderChunkImage(data: ChunkData): HTMLCanvasElement {
  const offscreen = document.createElement('canvas')
  offscreen.width = 16
  offscreen.height = 16
  const ctx = offscreen.getContext('2d')!
  const imageData = ctx.createImageData(16, 16)
  const pixels = imageData.data

  const sections = [...data.sections].sort((a, b) => b.y - a.y)

  for (let z = 0; z < 16; z++) {
    for (let x = 0; x < 16; x++) {
      let found = false
      for (const section of sections) {
        if (found) break
        for (let y = 15; y >= 0; y--) {
          const idx = (y << 8) | (z << 4) | x
          const id = section.blocks[idx]
          if (id !== 0) {
            const [r, g, b] = blockColorRGB(id, section.data[idx])
            const p = (z * 16 + x) * 4
            pixels[p] = r
            pixels[p + 1] = g
            pixels[p + 2] = b
            pixels[p + 3] = 255
            found = true
            break
          }
        }
      }
      if (!found) {
        const p = (z * 16 + x) * 4
        pixels[p] = 15
        pixels[p + 1] = 15
        pixels[p + 2] = 15
        pixels[p + 3] = 255
      }
    }
  }

  ctx.putImageData(imageData, 0, 0)
  return offscreen
}

export function WorldMap({ dimensionPath, regions }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const stateRef = useRef({
    camera: { cx: 0, cz: 0, scale: 4 } as Camera,
    cache: new Map<string, CacheEntry>(),
    resolving: new Set<string>(),
    activeFetches: 0,
    regionSet: new Set<string>(),
    isDragging: false,
    lastMouse: null as { x: number; y: number } | null,
    dimensionPath: '',
  })

  useEffect(() => {
    const s = stateRef.current
    s.dimensionPath = dimensionPath
    s.regionSet = new Set(regions.map((r) => `${r.region_x},${r.region_z}`))
    s.cache.clear()
    s.resolving.clear()
    s.activeFetches = 0

    if (regions.length > 0) {
      const xs = [...regions.map((r) => r.region_x)].sort((a, b) => a - b)
      const zs = [...regions.map((r) => r.region_z)].sort((a, b) => a - b)
      const medX = xs[Math.floor(xs.length / 2)]
      const medZ = zs[Math.floor(zs.length / 2)]
      s.camera = { cx: medX * 512 + 256, cz: medZ * 512 + 256, scale: 4 }
    }
  }, [dimensionPath, regions])

  useEffect(() => {
    const _canvas = canvasRef.current
    if (!_canvas) return
    const _ctx = _canvas.getContext('2d')
    if (!_ctx) return
    const canvas: HTMLCanvasElement = _canvas
    const ctx: CanvasRenderingContext2D = _ctx

    const s = stateRef.current

    async function resolveChunk(cx: number, cz: number, key: string) {
      // Check IndexedDB first
      const idbKey = `${s.dimensionPath}:${cx},${cz}`
      const cached = await loadCachedChunk(idbKey)
      if (cached) {
        s.resolving.delete(key)
        s.cache.set(key, cached)
        return
      }

      // Rate-limit server fetches
      if (s.activeFetches >= MAX_CONCURRENT) {
        s.resolving.delete(key)
        return
      }
      s.activeFetches++
      try {
        const res = await fetch(
          `${API_BASE}/worlds/chunks/${cx}/${cz}?world_path=${encodeURIComponent(s.dimensionPath)}`
        )
        if (res.status === 404) {
          s.cache.set(key, 'empty')
        } else if (!res.ok) {
          s.cache.set(key, 'error')
        } else {
          const data = (await res.json()) as ChunkData
          const image = renderChunkImage(data)
          s.cache.set(key, image)
          void saveCachedChunk(idbKey, image)
        }
      } catch {
        s.cache.set(key, 'error')
      } finally {
        s.resolving.delete(key)
        s.activeFetches--
      }
    }

    function maybeQueue(cx: number, cz: number) {
      const key = `${cx},${cz}`
      if (s.cache.has(key) || s.resolving.has(key)) return
      const rx = cx >> 5
      const rz = cz >> 5
      if (!s.regionSet.has(`${rx},${rz}`)) {
        s.cache.set(key, 'empty')
        return
      }
      s.resolving.add(key)
      void resolveChunk(cx, cz, key)
    }

    function render() {
      const { camera } = s
      const { width, height } = canvas

      ctx.imageSmoothingEnabled = false
      ctx.fillStyle = '#0f0f0f'
      ctx.fillRect(0, 0, width, height)

      const blockLeft = camera.cx - width / (2 * camera.scale)
      const blockTop = camera.cz - height / (2 * camera.scale)

      const regLeft = Math.floor(blockLeft / 512) - 1
      const regRight = Math.ceil((blockLeft + width / camera.scale) / 512) + 1
      const regTop = Math.floor(blockTop / 512) - 1
      const regBottom = Math.ceil((blockTop + height / camera.scale) / 512) + 1

      // Highlight regions that have data so the user can find the world at any zoom
      for (let rx = regLeft; rx <= regRight; rx++) {
        for (let rz = regTop; rz <= regBottom; rz++) {
          if (!s.regionSet.has(`${rx},${rz}`)) continue
          const px = Math.round((rx * 512 - blockLeft) * camera.scale)
          const pz = Math.round((rz * 512 - blockTop) * camera.scale)
          const size = Math.round(512 * camera.scale)
          ctx.fillStyle = '#1a1a24'
          ctx.fillRect(px, pz, size, size)
        }
      }

      // Chunk tiles — only fetched at FETCH_MIN_SCALE or above
      if (camera.scale >= FETCH_MIN_SCALE) {
        const chunkLeft = Math.floor(blockLeft / 16) - 1
        const chunkRight =
          Math.ceil((blockLeft + width / camera.scale) / 16) + 1
        const chunkTop = Math.floor(blockTop / 16) - 1
        const chunkBottom =
          Math.ceil((blockTop + height / camera.scale) / 16) + 1

        for (let cz = chunkTop; cz <= chunkBottom; cz++) {
          for (let cx = chunkLeft; cx <= chunkRight; cx++) {
            const key = `${cx},${cz}`
            const entry = s.cache.get(key)
            const px = Math.round((cx * 16 - blockLeft) * camera.scale)
            const pz = Math.round((cz * 16 - blockTop) * camera.scale)
            const size = Math.round(16 * camera.scale)

            if (!entry) {
              maybeQueue(cx, cz)
            } else if (entry === 'loading' || entry === 'empty') {
              // nothing
            } else if (entry === 'error') {
              ctx.fillStyle = '#2a0a0a'
              ctx.fillRect(px, pz, size, size)
            } else {
              ctx.drawImage(entry, px, pz, size, size)
            }
          }
        }
      }

      // Chunk grid at scale >= 3
      if (camera.scale >= 3) {
        const chunkLeft = Math.floor(blockLeft / 16) - 1
        const chunkRight =
          Math.ceil((blockLeft + width / camera.scale) / 16) + 1
        const chunkTop = Math.floor(blockTop / 16) - 1
        const chunkBottom =
          Math.ceil((blockTop + height / camera.scale) / 16) + 1
        ctx.strokeStyle = 'rgba(255,255,255,0.06)'
        ctx.lineWidth = 1
        for (let cx = chunkLeft; cx <= chunkRight; cx++) {
          const px = Math.round((cx * 16 - blockLeft) * camera.scale) + 0.5
          ctx.beginPath()
          ctx.moveTo(px, 0)
          ctx.lineTo(px, height)
          ctx.stroke()
        }
        for (let cz = chunkTop; cz <= chunkBottom; cz++) {
          const pz = Math.round((cz * 16 - blockTop) * camera.scale) + 0.5
          ctx.beginPath()
          ctx.moveTo(0, pz)
          ctx.lineTo(width, pz)
          ctx.stroke()
        }
      }

      // Region grid always
      ctx.strokeStyle = 'rgba(255,255,255,0.18)'
      ctx.lineWidth = 1
      for (let rx = regLeft; rx <= regRight; rx++) {
        const px = Math.round((rx * 512 - blockLeft) * camera.scale) + 0.5
        ctx.beginPath()
        ctx.moveTo(px, 0)
        ctx.lineTo(px, height)
        ctx.stroke()
      }
      for (let rz = regTop; rz <= regBottom; rz++) {
        const pz = Math.round((rz * 512 - blockTop) * camera.scale) + 0.5
        ctx.beginPath()
        ctx.moveTo(0, pz)
        ctx.lineTo(width, pz)
        ctx.stroke()
      }

      // HUD
      ctx.fillStyle = 'rgba(0,0,0,0.55)'
      ctx.fillRect(8, height - 28, 190, 20)
      ctx.fillStyle = '#a1a1aa'
      ctx.font = '11px monospace'
      ctx.fillText(
        `X ${Math.round(camera.cx)}  Z ${Math.round(camera.cz)}  ×${camera.scale.toFixed(2)}`,
        14,
        height - 13
      )
    }

    let rafId: number
    function loop() {
      render()
      rafId = requestAnimationFrame(loop)
    }
    rafId = requestAnimationFrame(loop)

    function onMouseDown(e: MouseEvent) {
      s.isDragging = true
      s.lastMouse = { x: e.clientX, y: e.clientY }
      canvas.style.cursor = 'grabbing'
    }
    function onMouseMove(e: MouseEvent) {
      if (!s.isDragging || !s.lastMouse) return
      s.camera.cx -= (e.clientX - s.lastMouse.x) / s.camera.scale
      s.camera.cz -= (e.clientY - s.lastMouse.y) / s.camera.scale
      s.lastMouse = { x: e.clientX, y: e.clientY }
    }
    function onMouseUp() {
      s.isDragging = false
      s.lastMouse = null
      canvas.style.cursor = 'grab'
    }
    function onWheel(e: WheelEvent) {
      e.preventDefault()
      const rect = canvas.getBoundingClientRect()
      const mouseX = e.clientX - rect.left
      const mouseY = e.clientY - rect.top
      const worldX = s.camera.cx + (mouseX - canvas.width / 2) / s.camera.scale
      const worldZ = s.camera.cz + (mouseY - canvas.height / 2) / s.camera.scale
      const factor = e.deltaY < 0 ? 1.25 : 1 / 1.25
      s.camera.scale = Math.max(
        MIN_SCALE,
        Math.min(MAX_SCALE, s.camera.scale * factor)
      )
      s.camera.cx = worldX - (mouseX - canvas.width / 2) / s.camera.scale
      s.camera.cz = worldZ - (mouseY - canvas.height / 2) / s.camera.scale
    }

    const resizeObs = new ResizeObserver(() => {
      canvas.width = canvas.clientWidth || 800
      canvas.height = canvas.clientHeight || 600
    })
    resizeObs.observe(canvas)
    canvas.width = canvas.clientWidth || 800
    canvas.height = canvas.clientHeight || 600

    canvas.addEventListener('mousedown', onMouseDown)
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    canvas.addEventListener('wheel', onWheel, { passive: false })

    return () => {
      cancelAnimationFrame(rafId)
      resizeObs.disconnect()
      canvas.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
      canvas.removeEventListener('wheel', onWheel)
    }
  }, [dimensionPath])

  return (
    <canvas
      ref={canvasRef}
      className="h-full w-full"
      style={{ cursor: 'grab', imageRendering: 'pixelated' }}
    />
  )
}
