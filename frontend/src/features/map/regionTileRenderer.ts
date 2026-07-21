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
import { computeHillshade, WATER_DEEP, waterBlend } from './chunkTileRenderer'
import {
  biomeTints,
  hardcodedBlockColor,
  metaBlockColorRGB,
  resolveMetadataTint,
  UNKNOWN_COLOR,
} from '../blocks/blockColors'
import type { BlockRenderRegistry } from '../blocks/blockRenderRegistry'
import type { RenderConfig } from '../blocks/renderPresets'
import { averageTextureColor } from '../textures/textureAverage'

const REGION_BLOCKS = 512 // 32 chunks × 16 blocks
export const REGION_TILE_PX = REGION_BLOCKS // 1 px per block

// ── Biome-tint blend ──────────────────────────────────────────────────────────
// Grass/foliage tints are per-column, so biome borders step hard. Precomputing a
// tint map and box-blurring it (radius BIOME_BLEND_R) smooths those borders into
// gradients like JourneyMap. Reused scratch avoids per-tile allocation (renders
// are single-threaded).
const BIOME_BLEND_R = 3
interface TintScratch {
  grR: Uint8Array
  grG: Uint8Array
  grB: Uint8Array
  fR: Uint8Array
  fG: Uint8Array
  fB: Uint8Array
  tmp: Uint8Array
}
let _tintScratch: TintScratch | null = null
function tintScratch(n: number): TintScratch {
  if (!_tintScratch || _tintScratch.tmp.length !== n) {
    _tintScratch = {
      grR: new Uint8Array(n),
      grG: new Uint8Array(n),
      grB: new Uint8Array(n),
      fR: new Uint8Array(n),
      fG: new Uint8Array(n),
      fB: new Uint8Array(n),
      tmp: new Uint8Array(n),
    }
  }
  return _tintScratch
}

/**
 * Separable box blur (radius R) of an N×N Uint8 channel, in place via tmp.
 *
 * Each pass carries a running window sum — adding the entering column and
 * dropping the leaving one — so the cost per pixel is constant instead of the
 * 2R+1 adds a re-summed window needs. At the sizes this runs on (512², six
 * channels per region tile) that is the difference between ~22M and ~3M adds
 * inside the frame's 12ms tile budget.
 *
 * The window still clamps at the edges and divides by its actual width, and the
 * sliding updates preserve that exactly — output is identical to re-summing,
 * which `regionTileRenderer.test.ts` pins against a naive reference.
 */
export function boxBlur(
  buf: Uint8Array,
  tmp: Uint8Array,
  N: number,
  R: number
): void {
  // Horizontal pass: buf → tmp.
  for (let z = 0; z < N; z++) {
    const row = z * N
    let lo = 0
    let hi = R < N ? R : N - 1
    let sum = 0
    for (let j = lo; j <= hi; j++) sum += buf[row + j]
    for (let x = 0; x < N; x++) {
      tmp[row + x] = (sum / (hi - lo + 1)) | 0
      const nlo = x + 1 - R > 0 ? x + 1 - R : 0
      const nhi = x + 1 + R < N ? x + 1 + R : N - 1
      if (nlo > lo) sum -= buf[row + lo++]
      if (nhi > hi) sum += buf[row + ++hi]
    }
  }
  // Vertical pass: tmp → buf (strided).
  for (let x = 0; x < N; x++) {
    let lo = 0
    let hi = R < N ? R : N - 1
    let sum = 0
    for (let j = lo; j <= hi; j++) sum += tmp[j * N + x]
    for (let z = 0; z < N; z++) {
      buf[z * N + x] = (sum / (hi - lo + 1)) | 0
      const nlo = z + 1 - R > 0 ? z + 1 - R : 0
      const nhi = z + 1 + R < N ? z + 1 + R : N - 1
      if (nlo > lo) sum -= tmp[lo++ * N + x]
      if (nhi > hi) sum += tmp[++hi * N + x]
    }
  }
}

export function renderRegionTile(
  surface: RegionSurface,
  colorMap: BlockColorMap | undefined,
  registry: BlockRenderRegistry,
  config: RenderConfig,
  textureKeys?: Record<number, string>,
  metaTextureKeys?: Record<string, string>
): HTMLCanvasElement {
  const N = REGION_BLOCKS

  // ── Build region-wide column maps so shading can sample across chunk seams ──
  const idMap = new Uint16Array(N * N)
  const metaMap = new Uint8Array(N * N)
  const heightMap = new Int16Array(N * N).fill(-1)
  const biomeMap = new Uint16Array(N * N).fill(1) // default: plains
  // Seabed block + water depth per column (for translucent water); 0 = none.
  const floorMap = new Uint16Array(N * N)
  const depthMap = new Uint8Array(N * N)

  for (const ch of surface.chunks) {
    const baseX = (((ch.chunk_x % 32) + 32) % 32) * 16
    const baseZ = (((ch.chunk_z % 32) + 32) % 32) * 16
    const hasBiome = ch.biomes.length === 256
    const fids = ch.floor_ids
    const wdepth = ch.water_depth
    for (let i = 0; i < 256; i++) {
      const X = baseX + (i & 15)
      const Z = baseZ + (i >> 4)
      const idx = Z * N + X
      idMap[idx] = ch.ids[i]
      metaMap[idx] = ch.metas[i]
      heightMap[idx] = ch.heights[i]
      if (hasBiome) biomeMap[idx] = ch.biomes[i]
      if (fids) floorMap[idx] = fids[i]
      if (wdepth) depthMap[idx] = wdepth[i]
    }
  }

  // ── Biome-tint blend ── precompute per-column grass/foliage tints, then box-
  // blur them to smooth biome borders. Only when tinting is on and the region
  // spans >1 biome (a single-biome region has nothing to blend). `sc` is null
  // when tinting is off, which the grass/foliage branches below check.
  const sc = config.biomeTint ? tintScratch(N * N) : null
  if (sc) {
    const tintById = new Map<number, ReturnType<typeof biomeTints>>()
    let firstBid = -1
    let multiBiome = false
    for (let idx = 0; idx < N * N; idx++) {
      const bid = biomeMap[idx]
      if (firstBid < 0) firstBid = bid
      else if (bid !== firstBid) multiBiome = true
      let t = tintById.get(bid)
      if (!t) {
        t = biomeTints(bid)
        tintById.set(bid, t)
      }
      sc.grR[idx] = t.grass[0]
      sc.grG[idx] = t.grass[1]
      sc.grB[idx] = t.grass[2]
      sc.fR[idx] = t.foliage[0]
      sc.fG[idx] = t.foliage[1]
      sc.fB[idx] = t.foliage[2]
    }
    if (multiBiome) {
      boxBlur(sc.grR, sc.tmp, N, BIOME_BLEND_R)
      boxBlur(sc.grG, sc.tmp, N, BIOME_BLEND_R)
      boxBlur(sc.grB, sc.tmp, N, BIOME_BLEND_R)
      boxBlur(sc.fR, sc.tmp, N, BIOME_BLEND_R)
      boxBlur(sc.fG, sc.tmp, N, BIOME_BLEND_R)
      boxBlur(sc.fB, sc.tmp, N, BIOME_BLEND_R)
    }
  }

  // ── Color pass ──
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = REGION_TILE_PX
  const ctx = canvas.getContext('2d')!
  const img = ctx.createImageData(N, N)
  const px = img.data

  const sat = config.colorSaturation
  const contourMode = config.contourMode

  for (let idx = 0; idx < N * N; idx++) {
    const o = idx * 4
    const id = idMap[idx]
    const h = heightMap[idx]
    if (id === 0 || h < 0) {
      px[o] = 10
      px[o + 1] = 10
      px[o + 2] = 10
      px[o + 3] = 255
      continue
    }

    const meta = metaMap[idx]
    const def = registry.lookup(id)
    let r: number, g: number, b: number

    // Resolve the texture the detailed renderer would draw for this block, and
    // its average colour — so the overview shows what a mip-collapsed detail tile
    // shows (the texture, for opaque blocks) instead of a generic per-id colour
    // that ignores per-metadata textures. Keeps the LOD swap seamless and, for
    // modded blocks absent from the colour map, avoids the arbitrary hashed
    // fallback colour.
    const texKey =
      metaTextureKeys?.[`${id}:${meta}`] ?? textureKeys?.[id] ?? null
    const texAvg = texKey ? averageTextureColor(texKey) : null

    if (def.tint === 'grass' && sc) {
      // Blended biome grass tint (sc is populated whenever biomeTint is on).
      const gr = sc.grR[idx]
      const gg = sc.grG[idx]
      const gb = sc.grB[idx]
      // The detailed renderer fills the biome tint then MULTIPLIES the grass
      // texture over it. Replicate so overview grass isn't the raw (too-bright)
      // tint but the darker tinted-texture colour.
      if (texAvg) {
        r = (gr * texAvg[0]) / 255
        g = (gg * texAvg[1]) / 255
        b = (gb * texAvg[2]) / 255
      } else {
        r = gr
        g = gg
        b = gb
      }
    } else if (def.tint === 'foliage' && sc) {
      const fr = sc.fR[idx]
      const fg = sc.fG[idx]
      const fb = sc.fB[idx]
      if (texAvg) {
        r = (fr * texAvg[0]) / 255
        g = (fg * texAvg[1]) / 255
        b = (fb * texAvg[2]) / 255
      } else {
        r = fr
        g = fg
        b = fb
      }
    } else if (def.category === 'fluid' && def.tint === 'water') {
      // Translucent water: show the seabed blended toward deep-water blue by
      // depth, so shallow water reveals the floor (sand/dirt/gravel) and deep
      // water reads as ocean. Falls back to plain deep water with no floor data.
      const fid = floorMap[idx]
      const depth = depthMap[idx]
      if (fid && depth) {
        const fKey = textureKeys?.[fid] ?? null
        const fAvg = fKey ? averageTextureColor(fKey) : null
        const fc =
          fAvg ?? colorMap?.[fid] ?? hardcodedBlockColor(fid) ?? UNKNOWN_COLOR
        const t = waterBlend(depth)
        r = fc[0] * (1 - t) + WATER_DEEP[0] * t
        g = fc[1] * (1 - t) + WATER_DEEP[1] * t
        b = fc[2] * (1 - t) + WATER_DEEP[2] * t
      } else {
        r = WATER_DEEP[0]
        g = WATER_DEEP[1]
        b = WATER_DEEP[2]
      }
    } else if (
      def.textureTint === 'metadata16' ||
      def.textureTint === 'custom'
    ) {
      // Per-metadata tinted blocks: keep the dye/tint colour (the detailed
      // renderer's flat/tinted paths show this, not the raw base texture).
      ;[r, g, b] = resolveMetadataTint(meta, def.textureTintColors)
    } else if (texAvg) {
      // Opaque block: the detailed renderer draws the texture source-over the
      // fill, so the visible colour is the texture's average.
      ;[r, g, b] = texAvg
    } else {
      const metaColor = metaBlockColorRGB(id, meta)
      if (metaColor) {
        r = metaColor[0]
        g = metaColor[1]
        b = metaColor[2]
      } else {
        const mapped = colorMap?.[id]
        if (mapped) {
          r = mapped[0]
          g = mapped[1]
          b = mapped[2]
          const maxCh = Math.max(r, g, b)
          if (maxCh === 0) {
            r = g = b = 130
          } else if (maxCh < 80) {
            const boost = 80 / maxCh
            r = Math.min(255, Math.round(r * boost))
            g = Math.min(255, Math.round(g * boost))
            b = Math.min(255, Math.round(b * boost))
          }
        } else {
          // No scanned colour: a hardcoded colour if we have one, else a neutral
          // 'unknown' grey instead of a random hash (matches the chunk renderer;
          // the overview can't scan down for a textured block below).
          const raw = hardcodedBlockColor(id) ?? UNKNOWN_COLOR
          r = raw[0]
          g = raw[1]
          b = raw[2]
        }
      }
    }

    if (sat < 1.0) {
      const lum = 0.299 * r + 0.587 * g + 0.114 * b
      r = Math.round(lum + (r - lum) * sat)
      g = Math.round(lum + (g - lum) * sat)
      b = Math.round(lum + (b - lum) * sat)
    }

    // ── Elevation shading ──
    // Identical NW-light hillshade to the detailed chunk renderer
    // (computeHillshade), applied the same way it composites there: a white
    // overlay at brightA, then a black overlay at darkA. This is what makes the
    // LOD swap between the overview and the full-detail tiles seamless — the two
    // layers shade terrain the same instead of the overview reading punchier.
    // Sample all four neighbors from the region-wide height map (−1 at the
    // region edge = no neighbor, matching an unloaded chunk edge).
    const nY = idx >= N ? heightMap[idx - N] : -1
    const sY = idx < N * (N - 1) ? heightMap[idx + N] : -1
    const wY = idx % N > 0 ? heightMap[idx - 1] : -1
    const eY = idx % N < N - 1 ? heightMap[idx + 1] : -1
    const { brightA, darkA } = computeHillshade(h, nY, sY, wY, eY, config)
    if (brightA > 0.01) {
      r = r * (1 - brightA) + 255 * brightA
      g = g * (1 - brightA) + 255 * brightA
      b = b * (1 - brightA) + 255 * brightA
    }
    if (darkA > 0.01) {
      r *= 1 - darkA
      g *= 1 - darkA
      b *= 1 - darkA
    }

    // ── Contour lines ── same interval + alpha as the detailed renderer, so
    // relief/topo/explorer presets stay seamless across the swap too.
    if (contourMode !== 'off') {
      const shift = contourMode === 'strong' ? 2 : 3
      const band = h >> shift
      const atContour =
        (sY >= 0 && sY >> shift !== band) ||
        (nY >= 0 && nY >> shift !== band) ||
        (eY >= 0 && eY >> shift !== band) ||
        (wY >= 0 && wY >> shift !== band)
      if (atContour) {
        const cAlpha =
          contourMode === 'subtle'
            ? 0.18
            : contourMode === 'normal'
              ? 0.32
              : 0.5
        r *= 1 - cAlpha
        g *= 1 - cAlpha
        b *= 1 - cAlpha
      }
    }

    px[o] = r
    px[o + 1] = g
    px[o + 2] = b
    px[o + 3] = 255
  }

  ctx.putImageData(img, 0, 0)
  return canvas
}
