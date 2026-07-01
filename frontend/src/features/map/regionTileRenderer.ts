/**
 * Region-tile renderer for the zoomed-out overview (LOD).
 *
 * Paints a single downsampled canvas for an entire region (32×32 chunks) from
 * the compact surface summary returned by the backend, instead of one
 * full-resolution texture per chunk.  One block = one pixel (512×512 tile).
 *
 * Coloring mirrors the base-color resolution of the full chunk renderer
 * (biome tint → metadata color → scanned color map → fallback), minus textures,
 * water depth, transparency, and overlays — detail that only matters up close.
 */

import type { BlockColorMap } from '../blocks/api/blockColors'
import type { RegionSurface } from './api/regions'
import { biomeTints, blockColorRGB, metaBlockColorRGB, resolveMetadataTint } from '../blocks/blockColors'
import type { BlockRenderRegistry } from '../blocks/blockRenderRegistry'
import type { RenderConfig } from '../blocks/renderPresets'

const REGION_BLOCKS = 512 // 32 chunks × 16 blocks
export const REGION_TILE_PX = REGION_BLOCKS // 1 px per block

export function renderRegionTile(
  surface: RegionSurface,
  colorMap: BlockColorMap | undefined,
  registry: BlockRenderRegistry,
  config: RenderConfig,
): HTMLCanvasElement {
  const N = REGION_BLOCKS

  // ── Build region-wide column maps so shading can sample across chunk seams ──
  const idMap = new Uint16Array(N * N)
  const metaMap = new Uint8Array(N * N)
  const heightMap = new Int16Array(N * N).fill(-1)
  const biomeMap = new Uint16Array(N * N).fill(1) // default: plains

  for (const ch of surface.chunks) {
    const baseX = (((ch.chunk_x % 32) + 32) % 32) * 16
    const baseZ = (((ch.chunk_z % 32) + 32) % 32) * 16
    const hasBiome = ch.biomes.length === 256
    for (let i = 0; i < 256; i++) {
      const X = baseX + (i & 15)
      const Z = baseZ + (i >> 4)
      const idx = Z * N + X
      idMap[idx] = ch.ids[i]
      metaMap[idx] = ch.metas[i]
      heightMap[idx] = ch.heights[i]
      if (hasBiome) biomeMap[idx] = ch.biomes[i]
    }
  }

  // ── Color pass ──
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = REGION_TILE_PX
  const ctx = canvas.getContext('2d')!
  const img = ctx.createImageData(N, N)
  const px = img.data

  const sat = config.colorSaturation
  const elevOn = config.elevationMode !== 'off'
  const elevStrength = config.elevationStrength

  for (let idx = 0; idx < N * N; idx++) {
    const o = idx * 4
    const id = idMap[idx]
    const h = heightMap[idx]
    if (id === 0 || h < 0) {
      px[o] = 10; px[o + 1] = 10; px[o + 2] = 10; px[o + 3] = 255
      continue
    }

    const meta = metaMap[idx]
    const def = registry.lookup(id)
    let r: number, g: number, b: number

    if (def.tint === 'grass' && config.biomeTint) {
      ;[r, g, b] = biomeTints(biomeMap[idx]).grass
    } else if (def.tint === 'foliage' && config.biomeTint) {
      ;[r, g, b] = biomeTints(biomeMap[idx]).foliage
    } else if (def.category === 'fluid' && def.tint === 'water') {
      r = 40; g = 80; b = 170
    } else if (def.textureTint === 'metadata16' || def.textureTint === 'custom') {
      ;[r, g, b] = resolveMetadataTint(meta, def.textureTintColors)
    } else {
      const metaColor = metaBlockColorRGB(id, meta)
      if (metaColor) {
        r = metaColor[0]; g = metaColor[1]; b = metaColor[2]
      } else {
        const mapped = colorMap?.[id]
        const raw = mapped ?? blockColorRGB(id, meta)
        r = raw[0]; g = raw[1]; b = raw[2]
        if (mapped) {
          const maxCh = Math.max(r, g, b)
          if (maxCh === 0) { r = g = b = 130 }
          else if (maxCh < 80) {
            const boost = 80 / maxCh
            r = Math.min(255, Math.round(r * boost))
            g = Math.min(255, Math.round(g * boost))
            b = Math.min(255, Math.round(b * boost))
          }
        }
      }
    }

    if (sat < 1.0) {
      const lum = 0.299 * r + 0.587 * g + 0.114 * b
      r = Math.round(lum + (r - lum) * sat)
      g = Math.round(lum + (g - lum) * sat)
      b = Math.round(lum + (b - lum) * sat)
    }

    // ── Elevation shading: lighten north/west-facing slopes, darken the rest ──
    if (elevOn) {
      const nH = idx >= N ? heightMap[idx - N] : -1
      const wH = idx % N > 0 ? heightMap[idx - 1] : -1
      let shade = 0
      if (nH >= 0) shade += Math.sign(h - nH)
      if (wH >= 0) shade += Math.sign(h - wH)
      if (shade !== 0) {
        const f = 1 + shade * 0.1 * elevStrength
        r = Math.max(0, Math.min(255, Math.round(r * f)))
        g = Math.max(0, Math.min(255, Math.round(g * f)))
        b = Math.max(0, Math.min(255, Math.round(b * f)))
      }
    }

    px[o] = r; px[o + 1] = g; px[o + 2] = b; px[o + 3] = 255
  }

  ctx.putImageData(img, 0, 0)
  return canvas
}
