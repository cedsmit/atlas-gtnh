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
import { biomeTints, blockColorRGB, metaBlockColorRGB, resolveMetadataTint } from '../lib/blockColors'
import { columnTally } from '../lib/columnTally'
import { textureDebugStore } from '../lib/textureDebugStore'
import {
  type BlockRenderRegistry,
  createResolvedRegistry,
} from '../lib/blockRenderRegistry'
import { type RenderConfig, type TextureFilter, presetToConfig, shouldShowOverlay, BUILT_IN_PRESETS } from '../lib/renderPresets'

const DEFAULT_CONFIG: RenderConfig = presetToConfig(BUILT_IN_PRESETS[0])
import { getTexture, onTextureLoad } from '../lib/textureLoader'

const CELL = 16         // pixels per block column in chunk canvas
const CANVAS_SIZE = 256 // 16 blocks × 16 px

// ── Render counters ────────────────────────────────────────────────────────
export interface ChunkRenderStats {
  /** ctx.drawImage calls — textures actually rendered */
  drawImage: number
  /** ctx.fillRect calls as primary block paint (flat color / water / biome) */
  fillRect: number
  /** non-water blocks with no entry in textureKeys map */
  missingTexKey: number
  /** non-water blocks whose key is in textureKeys but image not yet loaded */
  failedTexLoad: number
}

// ── Chunk pixel renderer ───────────────────────────────────────────────────
function renderChunkImage(
  data: ChunkData,
  colorMap: BlockColorMap | undefined,
  textureKeys: Record<number, string> | undefined,
  metaTextureKeys: Record<string, string> | undefined,
  registry: BlockRenderRegistry,
  config: RenderConfig,
  recordDebug: boolean, // only true on first render to avoid double-counting
  debugMode: boolean,   // controls textureDebugStore recording
  blockNames: Record<number, string> | undefined,
): { canvas: HTMLCanvasElement; stats: ChunkRenderStats } {
  let drawImage = 0, fillRect = 0, missingTexKey = 0, failedTexLoad = 0
  const sections = [...data.sections].sort((a, b) => b.y - a.y)

  // ── Pass 1: classify every (x,z) column ─────────────────────────────
  // baseY/baseId/baseMeta: highest surface block (may be transparent).
  // underY/underId/underMeta: first solid block beneath a transparent surface.
  // overlayLists: OVERLAY blocks above the base, bottom-to-top draw order.
  // floorY: first solid block below a water surface (for depth shading).
  const baseY    = new Int16Array(256).fill(-1)
  const baseId   = new Uint16Array(256)
  const baseMeta = new Uint8Array(256)
  const floorY   = new Int16Array(256).fill(-1)
  const underY   = new Int16Array(256).fill(-1)  // block below a transparent surface
  const underId  = new Uint16Array(256)
  const underMeta = new Uint8Array(256)
  // Each entry is [id, meta] pairs accumulated top-down then reversed.
  const overlayLists: ([number, number][] | null)[] = new Array(256).fill(null)

  for (let z = 0; z < 16; z++) {
    for (let x = 0; x < 16; x++) {
      const i = z * 16 + x
      let foundBase  = false
      let inWater    = false
      let needUnder  = false  // scanning for block below a transparent surface
      let colOverlays: [number, number][] | null = null

      outer: for (const section of sections) {
        for (let y = 15; y >= 0; y--) {
          const idx = (y << 8) | (z << 4) | x
          const id  = section.blocks[idx]
          if (id === 0) continue
          const def = registry.lookup(id)
          if (def.category === 'ignore') continue
          const absY = section.y * 16 + y

          if (!foundBase) {
            if (def.category === 'overlay') {
              if (shouldShowOverlay(def, config)) {
                ;(colOverlays ??= []).push([id, section.data[idx]])
              }
            } else {
              // solid / fluid / transparent / partial: defines terrain height.
              // In foliage 'hidden' mode, skip foliage-tinted solids (leaves)
              // so the structure underneath is revealed.
              if (config.foliageMode === 'hidden' && def.tint === 'foliage') continue
              baseY[i]    = absY
              baseId[i]   = id
              baseMeta[i] = section.data[idx]
              foundBase   = true
              inWater     = def.category === 'fluid' && def.tint === 'water'
              needUnder   = def.category === 'transparent'
              if (!inWater && !needUnder) break outer
            }
          } else if (needUnder) {
            // Continue scanning below a transparent block to find the terrain.
            if (def.category !== 'overlay') {
              underY[i]    = absY
              underId[i]   = id
              underMeta[i] = section.data[idx]
              break outer
            }
          } else if (inWater && !(def.category === 'fluid' && def.tint === 'water')) {
            floorY[i] = absY
            break outer
          }
        }
      }

      // Store overlays in bottom-to-top draw order.
      if (colOverlays) overlayLists[i] = colOverlays.reverse()
    }
  }

  // ── Pass 2: draw 256×256 canvas ──────────────────────────────────────
  const offscreen = document.createElement('canvas')
  offscreen.width = CANVAS_SIZE
  offscreen.height = CANVAS_SIZE
  const ctx = offscreen.getContext('2d')!
  ctx.imageSmoothingEnabled = false

  // Pre-compute biome tints per column
  const grassTints: Array<readonly [number, number, number]> = new Array(256)
  const foliageTints: Array<readonly [number, number, number]> = new Array(256)
  for (let i = 0; i < 256; i++) {
    const biomeId = data.biomes.length === 256 ? data.biomes[i] : 1
    const t = biomeTints(biomeId)
    grassTints[i] = t.grass
    foliageTints[i] = t.foliage
  }

  // Reusable 16×16 scratch canvas for compositing biome-tinted overlay sprites.
  // Each tinted overlay is built here then source-over'd onto the chunk canvas.
  const mini = document.createElement('canvas')
  mini.width = 16; mini.height = 16
  const miniCtx = mini.getContext('2d')!
  miniCtx.imageSmoothingEnabled = false

  for (let z = 0; z < 16; z++) {
    for (let x = 0; x < 16; x++) {
      const i  = z * 16 + x
      const px = x * CELL
      const pz = z * CELL

      // No base block found — void cell
      if (baseY[i] < 0) {
        ctx.fillStyle = '#0a0a0a'
        ctx.fillRect(px, pz, CELL, CELL)
        continue
      }

      const id        = baseId[i]
      const meta      = baseMeta[i]
      const blockY    = baseY[i]
      const baseDef   = registry.lookup(id)
      const isWater       = baseDef.category === 'fluid' && baseDef.tint === 'water'
      const isTransparent = baseDef.category === 'transparent'
      const isGrass   = baseDef.tint === 'grass'
      const isFoliage = baseDef.tint === 'foliage'
      const isBiome   = (isGrass || isFoliage) && config.biomeTint
      const tintType  = baseDef.tint ?? (isWater ? 'water' : 'none')

      // ── Base color: biome tint or block color ──────────────────────
      let r: number, g: number, b: number
      if (isGrass) {
        ;[r, g, b] = grassTints[i]
      } else if (isFoliage) {
        ;[r, g, b] = foliageTints[i]
      } else if (isWater) {
        const floor = floorY[i]
        const depth = floor >= 0 ? Math.min(blockY - floor, 20) : 10
        r = Math.max(10, 40 - depth * 1.5)
        g = Math.max(30, 80 - depth * 2)
        b = Math.min(255, 160 + depth * 3)
      } else if (baseDef.textureTint === 'metadata16' || baseDef.textureTint === 'custom') {
        ;[r, g, b] = resolveMetadataTint(meta, baseDef.textureTintColors)
      } else {
        // Check meta-specific color first (wool, stained glass/clay, planks, logs)
        const metaColor = metaBlockColorRGB(id, meta)
        if (metaColor) {
          r = metaColor[0]; g = metaColor[1]; b = metaColor[2]
        } else {
          const mapped = colorMap?.[id]
          const raw    = mapped ?? blockColorRGB(id, meta)
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

      // ── Neighbor heights for elevation shading + contours ─────────
      // Edge columns stay -1; cross-chunk shading is a future improvement.
      const nY = z > 0  ? baseY[(z - 1) * 16 + x] : -1
      const sY = z < 15 ? baseY[(z + 1) * 16 + x] : -1
      const wY = x > 0  ? baseY[z * 16 + (x - 1)] : -1
      const eY = x < 15 ? baseY[z * 16 + (x + 1)] : -1

      // Color desaturation (Topo preset and any preset with colorSaturation < 1)
      const sat = config.colorSaturation
      if (sat < 1.0) {
        const lum = 0.299 * r + 0.587 * g + 0.114 * b
        r = Math.round(lum + (r - lum) * sat)
        g = Math.round(lum + (g - lum) * sat)
        b = Math.round(lum + (b - lum) * sat)
      }

      const texKey = !isWater ? (baseDef.textureAlias ?? metaTextureKeys?.[`${id}:${meta}`] ?? textureKeys?.[id] ?? null) : null
      // For 'simplified' foliage mode, skip the texture so only the biome fill renders.
      const skipTex = config.foliageMode === 'simplified' && isFoliage
      const texImg  = config.terrainTextures && !skipTex && texKey ? getTexture(texKey) : null

      // Counters (skip for flat-mode blocks — they intentionally have no texture)
      if (!isWater && baseDef.mapRenderMode !== 'flat') {
        if (!texKey)      missingTexKey++
        else if (!texImg) failedTexLoad++
      }

      // ── Step 1 + 2: background fill + base block ───────────────────
      //
      // Biome-tinted base (grass, leaves, …):
      //   Fill the biome color first so transparent texture pixels adopt it,
      //   then multiply-draw the texture to tint opaque pixels.
      //
      // Transparent base (glass, ice, stained glass):
      //   Draw the block below first, then composite the transparent block
      //   texture on top at ~50% alpha so terrain shows through.
      //
      // Non-biome base: fill block color, source-over texture.
      // Saturation filter string — set on ctx around texture draws to mute texture colours.
      const satFilter = sat < 1.0 ? `saturate(${Math.round(sat * 100)}%)` : ''

      if (isTransparent && underY[i] >= 0) {
        // ── Transparent block: render terrain below, then glass on top ──
        const uId   = underId[i]
        const uMeta = underMeta[i]
        const uDef  = registry.lookup(uId)
        const uIsGrass   = uDef.tint === 'grass'
        const uIsFoliage = uDef.tint === 'foliage'
        const uIsBiome   = (uIsGrass || uIsFoliage) && config.biomeTint

        let ur: number, ug: number, ub: number
        if (uIsGrass)        { ;[ur, ug, ub] = grassTints[i] }
        else if (uIsFoliage) { ;[ur, ug, ub] = foliageTints[i] }
        else {
          const uMeta2 = metaBlockColorRGB(uId, uMeta)
          if (uMeta2) {
            ur = uMeta2[0]; ug = uMeta2[1]; ub = uMeta2[2]
          } else {
            const uMapped = colorMap?.[uId]
            const uRaw    = uMapped ?? blockColorRGB(uId, uMeta)
            ur = uRaw[0]; ug = uRaw[1]; ub = uRaw[2]
            if (uMapped) {
              const maxCh = Math.max(ur, ug, ub)
              if (maxCh === 0) { ur = ug = ub = 130 }
              else if (maxCh < 80) {
                const boost = 80 / maxCh
                ur = Math.min(255, Math.round(ur * boost))
                ug = Math.min(255, Math.round(ug * boost))
                ub = Math.min(255, Math.round(ub * boost))
              }
            }
          }
        }
        if (sat < 1.0) {
          const lum = 0.299 * ur + 0.587 * ug + 0.114 * ub
          ur = Math.round(lum + (ur - lum) * sat)
          ug = Math.round(lum + (ug - lum) * sat)
          ub = Math.round(lum + (ub - lum) * sat)
        }

        const uTexKey = metaTextureKeys?.[`${uId}:${uMeta}`] ?? textureKeys?.[uId] ?? null
        const uTexImg = config.terrainTextures && uTexKey ? getTexture(uTexKey) : null

        // Draw under-block
        if (uIsBiome) {
          ctx.fillStyle = `rgb(${ur},${ug},${ub})`
          ctx.fillRect(px, pz, CELL, CELL)
          if (uTexImg) {
            if (satFilter) ctx.filter = satFilter
            ctx.globalCompositeOperation = 'multiply'
            ctx.drawImage(uTexImg, 0, 0, 16, 16, px, pz, CELL, CELL)
            ctx.globalCompositeOperation = 'source-over'
            if (satFilter) ctx.filter = 'none'
            drawImage++
          }
        } else {
          ctx.fillStyle = `rgb(${ur},${ug},${ub})`
          ctx.fillRect(px, pz, CELL, CELL)
          if (uTexImg) {
            if (satFilter) ctx.filter = satFilter
            ctx.drawImage(uTexImg, 0, 0, 16, 16, px, pz, CELL, CELL)
            if (satFilter) ctx.filter = 'none'
            drawImage++
          }
        }

        // Draw transparent block on top at partial alpha
        if (baseDef.mapRenderMode === 'flat') {
          // Flat map override: skip texture entirely, fill with meta color at mapOpacity.
          // Used for blocks like Ztones glaxx whose in-game texture is just a flat tinted
          // transparent square — no vanilla glass streak pattern should appear.
          const opacity = baseDef.mapOpacity ?? 0.40
          ctx.fillStyle = `rgba(${r},${g},${b},${opacity})`
          ctx.fillRect(px, pz, CELL, CELL)
          fillRect++
        } else if (texImg && (baseDef.textureTint === 'metadata16' || baseDef.textureTint === 'custom')) {
          // Tinted transparent block: fill tint color, multiply texture, restore alpha, draw at 50%
          miniCtx.clearRect(0, 0, 16, 16)
          miniCtx.fillStyle = `rgb(${r},${g},${b})`
          miniCtx.fillRect(0, 0, 16, 16)
          miniCtx.globalCompositeOperation = 'multiply'
          miniCtx.drawImage(texImg, 0, 0, 16, 16)
          if (baseDef.preserveAlpha) {
            miniCtx.globalCompositeOperation = 'destination-in'
            miniCtx.drawImage(texImg, 0, 0, 16, 16)
          }
          miniCtx.globalCompositeOperation = 'source-over'
          ctx.globalAlpha = 0.50
          ctx.drawImage(mini, 0, 0, 16, 16, px, pz, CELL, CELL)
          ctx.globalAlpha = 1.0
          drawImage++
        } else if (texImg) {
          ctx.globalAlpha = 0.50
          if (satFilter) ctx.filter = satFilter
          ctx.drawImage(texImg, 0, 0, 16, 16, px, pz, CELL, CELL)
          ctx.globalAlpha = 1.0
          if (satFilter) ctx.filter = 'none'
          drawImage++
        } else {
          const opacity = baseDef.mapOpacity ?? 0.40
          ctx.fillStyle = `rgba(${r},${g},${b},${opacity})`
          ctx.fillRect(px, pz, CELL, CELL)
          fillRect++
        }
      } else if (isBiome) {
        ctx.fillStyle = `rgb(${r},${g},${b})`
        ctx.fillRect(px, pz, CELL, CELL)
        if (texImg) {
          drawImage++
          if (satFilter) ctx.filter = satFilter
          ctx.globalCompositeOperation = 'multiply'
          ctx.drawImage(texImg, 0, 0, 16, 16, px, pz, CELL, CELL)
          ctx.globalCompositeOperation = 'source-over'
          if (satFilter) ctx.filter = 'none'
        } else {
          fillRect++
        }
      } else {
        if (config.showFallbackMagenta && !isWater && !isBiome && !texImg) {
          ctx.fillStyle = '#FF00FF'
        } else {
          ctx.fillStyle = `rgb(${r},${g},${b})`
        }
        ctx.fillRect(px, pz, CELL, CELL)
        if (texImg) {
          drawImage++
          if (satFilter) ctx.filter = satFilter
          ctx.drawImage(texImg, 0, 0, 16, 16, px, pz, CELL, CELL)
          if (satFilter) ctx.filter = 'none'
        } else if (!isWater) {
          fillRect++
        }
        // Textured water mode: draw water texture at reduced opacity over depth fill.
        if (isWater && config.waterMode === 'textured') {
          const wKey = textureKeys?.[id] ?? null
          if (wKey) {
            const wImg = getTexture(wKey)
            if (wImg) {
              ctx.globalAlpha = 0.35
              ctx.drawImage(wImg, 0, 0, 16, 16, px, pz, CELL, CELL)
              ctx.globalAlpha = 1.0
              drawImage++
            }
          }
        }
      }

      // ── Step 3: overlay textures (bottom to top) ───────────────────
      // Each overlay is tinted individually so non-biome overlays (torch,
      // rail, redstone, flowers) keep their original colors, while
      // biome-tinted overlays (tallgrass, vine, lily pad) get the correct
      // grass/foliage tint without contaminating their transparent areas.
      const overlays = overlayLists[i]
      if (overlays) {
        for (const [ovId, ovMeta] of overlays) {
          const ovKey = metaTextureKeys?.[`${ovId}:${ovMeta}`] ?? textureKeys?.[ovId] ?? null
          const ovImg = ovKey ? getTexture(ovKey) : null
          if (!ovImg) continue

          const ovDef = registry.lookup(ovId)

          // Only use mapRenderMode:'marker' when useMarkers is enabled (no preset enables this yet).
          const effectiveRenderMode = config.useMarkers ? (ovDef.mapRenderMode ?? 'overlay') : 'overlay'

          if (effectiveRenderMode === 'marker') {
            // Tiny solid-colour dot at the centre of the cell (e.g. torch in Detailed mode).
            const markerSz = Math.max(2, Math.ceil(CELL * 0.3125)) // 5 px at CELL=16
            ctx.fillStyle  = ovDef.mapColor ?? '#ffffff'
            ctx.fillRect(
              px + Math.floor((CELL - markerSz) / 2),
              pz + Math.floor((CELL - markerSz) / 2),
              markerSz, markerSz,
            )
            drawImage++
            continue
          }

          const ovIsGrass   = config.biomeTint && ovDef.tint === 'grass'
          const ovIsFoliage = config.biomeTint && ovDef.tint === 'foliage'

          if (ovIsGrass || ovIsFoliage) {
            // Build a tinted sprite on the mini canvas and composite it.
            //
            // Why 4 steps? "multiply" blend extends the fill color into
            // transparent regions, so a plain fill+multiply leaves biome-
            // colored halos in the transparent areas.  The destination-in
            // pass re-masks the result back to the texture's own alpha.
            //
            //   1. fill biome color (opaque)
            //   2. multiply-draw texture  → opaque pixels tinted, transparent areas biome-colored
            //   3. destination-in texture → mask alpha back to texture shape
            //   → result: tinted pixels where texture is opaque, transparent elsewhere
            const [tr, tg, tb] = ovIsGrass ? grassTints[i] : foliageTints[i]
            miniCtx.clearRect(0, 0, 16, 16)
            miniCtx.fillStyle = `rgb(${tr},${tg},${tb})`
            miniCtx.fillRect(0, 0, 16, 16)
            miniCtx.globalCompositeOperation = 'multiply'
            miniCtx.drawImage(ovImg, 0, 0, 16, 16)
            miniCtx.globalCompositeOperation = 'destination-in'
            miniCtx.drawImage(ovImg, 0, 0, 16, 16)
            miniCtx.globalCompositeOperation = 'source-over'
            ctx.drawImage(mini, 0, 0, 16, 16, px, pz, CELL, CELL)
          } else {
            // Non-biome overlay: source-over preserves the sprite's original colors.
            ctx.drawImage(ovImg, 0, 0, 16, 16, px, pz, CELL, CELL)
          }
          drawImage++
        }
      }

      // ── Step 5: elevation shading ────────────────────────────────
      // Directional hillshade with NW light: N and W faces are lit, S and E are in shadow.
      // Separate bright/dark channels are accumulated then clamped independently.
      // Ambient occlusion adds uniform darkening near steep height drops.
      const elevMode = config.elevationMode
      if (elevMode !== 'off') {
        const str = config.elevationStrength
        if (elevMode === 'debug-heightmap') {
          const [hr, hg, hb] = elevColor(blockY)
          ctx.fillStyle = `rgba(${hr},${hg},${hb},0.55)`
          ctx.fillRect(px, pz, CELL, CELL)
        } else {
          // N/W contribute bright (facing NW light); S/E contribute dark (in shadow).
          // Each direction also adds a lesser counter-contribution for smooth transitions.
          let bright = 0, dark = 0
          if (nY >= 0) {
            const d = blockY - nY
            if (d > 0) bright += d          // N-face: lit by NW sun
            else       dark   += (-d) * 0.3  // below N cliff: partial shadow
          }
          if (wY >= 0) {
            const d = blockY - wY
            if (d > 0) bright += d * 0.65   // W-face: secondary lit direction
            else       dark   += (-d) * 0.2
          }
          if (sY >= 0) {
            const d = sY - blockY
            if (d > 0) dark   += d           // S-slope above: full shadow
            else       bright += (-d) * 0.15  // S below: minor bright
          }
          if (eY >= 0) {
            const d = eY - blockY
            if (d > 0) dark   += d * 0.65   // E-slope: secondary shadow
            else       bright += (-d) * 0.1
          }

          // Ambient occlusion: extra darkening at cliff edges (steep drops in any direction)
          const steep = Math.max(
            nY >= 0 ? Math.abs(blockY - nY) : 0,
            sY >= 0 ? Math.abs(blockY - sY) : 0,
            wY >= 0 ? Math.abs(blockY - wY) : 0,
            eY >= 0 ? Math.abs(blockY - eY) : 0,
          )
          const ao = Math.max(0, (steep - 2) * str / 80)

          // Normalize and clamp. NORM=9: a 3-block cliff → ~33% shade at str=1.
          // maxD 0.78 lets Topo (str=2.5) reach near-black on cliffs.
          const NORM   = 9
          const maxB   = elevMode === 'strong' ? 0.48 : 0.28
          const maxD   = elevMode === 'strong' ? 0.78 : 0.42
          const brightA = Math.min(bright * str / NORM, maxB)
          const darkA   = Math.min(dark   * str / NORM + ao, maxD)
          if (brightA > 0.01) {
            ctx.fillStyle = `rgba(255,255,255,${brightA})`
            ctx.fillRect(px, pz, CELL, CELL)
          }
          if (darkA > 0.01) {
            ctx.fillStyle = `rgba(0,0,0,${darkA})`
            ctx.fillRect(px, pz, CELL, CELL)
          }
        }
      }

      // ── Step 6: contour lines ─────────────────────────────────────
      // Marks every Nth Y-level transition between neighboring columns.
      const cMode = config.contourMode
      if (cMode !== 'off') {
        // 'strong' uses 4-Y interval; others use 8-Y
        const shift = cMode === 'strong' ? 2 : 3   // bit-shift = log2(interval)
        const band  = blockY >> shift
        const atContour =
          (sY >= 0 && (sY >> shift) !== band) ||
          (nY >= 0 && (nY >> shift) !== band) ||
          (eY >= 0 && (eY >> shift) !== band) ||
          (wY >= 0 && (wY >> shift) !== band)
        if (atContour) {
          const cAlpha = cMode === 'subtle' ? 0.18 : cMode === 'normal' ? 0.32 : 0.50
          ctx.fillStyle = `rgba(0,0,0,${cAlpha})`
          ctx.fillRect(px, pz, CELL, CELL)
        }
      }

      // ── Per-column tallies (first render only, so each chunk counts once) ──
      if (recordDebug) {
        // Always-on: top-block occurrence + metadata for the dump-mismatch banner.
        columnTally.record(id, meta)
        // Debug panel detail is gated on debug mode.
        if (debugMode) {
          textureDebugStore.record(id, blockNames?.[id], texKey, tintType)
        }
      }
    }
  }

  return {
    canvas: offscreen,
    stats: { drawImage, fillRect, missingTexKey, failedTexLoad },
  }
}

// 5-stop height→RGB gradient used by the debug-heightmap elevation mode.
// Stops: dark-blue (0) → blue (60) → green (80) → yellow (128) → white (220+)
function elevColor(y: number): [number, number, number] {
  if (y < 60) {
    const t = y / 60
    return [Math.round(t * 30), Math.round(t * 80), Math.round(80 + t * 80)]
  }
  if (y < 80) {
    const t = (y - 60) / 20
    return [Math.round(30 + t * 30), Math.round(80 + t * 100), Math.round(160 - t * 60)]
  }
  if (y < 128) {
    const t = (y - 80) / 48
    return [Math.round(60 + t * 160), Math.round(180 + t * 50), Math.round(100 - t * 80)]
  }
  const t = Math.min((y - 128) / 100, 1)
  return [Math.round(220 + t * 35), Math.round(230 + t * 25), Math.round(20 + t * 235)]
}

function makeChunkTexture(canvas: HTMLCanvasElement, filter: TextureFilter = 'pixel'): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.generateMipmaps = true
  if (filter === 'pixel') {
    tex.magFilter = THREE.NearestFilter
    tex.minFilter = THREE.NearestMipMapLinearFilter
  } else {
    tex.magFilter = THREE.LinearFilter
    tex.minFilter = THREE.LinearMipMapLinearFilter
  }
  return tex
}

function upscaleCanvas(src: HTMLCanvasElement, size: number): HTMLCanvasElement {
  const dst = document.createElement('canvas')
  dst.width = dst.height = size
  const ctx = dst.getContext('2d')!
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(src, 0, 0, size, size)
  return dst
}

// ── Canvas diagnostics ─────────────────────────────────────────────────────
// Returns the number of non-black/non-transparent pixels in the canvas.
// Returns -1 when getImageData() throws (cross-origin taint = WebGL upload blocked).
function canvasDiagnostics(canvas: HTMLCanvasElement): number {
  try {
    const d = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data
    let n = 0
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] | d[i + 1] | d[i + 2] | d[i + 3]) n++
    }
    return n
  } catch {
    return -1  // SecurityError: canvas tainted by cross-origin drawImage
  }
}

// ── Chunk debug outline overlay ────────────────────────────────────────────
type ChunkOutlineState = 'queued' | 'rendering' | 'loaded' | 'empty' | 'tainted' | 'error'

const _outlineUnitGeo = new THREE.BufferGeometry()
_outlineUnitGeo.setAttribute(
  'position',
  new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 1, -1, 0, 0, -1, 0]), 3),
)

const _outlineMats: Record<ChunkOutlineState, THREE.LineBasicMaterial> = {
  queued:    new THREE.LineBasicMaterial({ color: 0x3399ff, depthTest: false }),
  rendering: new THREE.LineBasicMaterial({ color: 0xffcc00, depthTest: false }),
  loaded:    new THREE.LineBasicMaterial({ color: 0x33ee33, depthTest: false }),
  empty:     new THREE.LineBasicMaterial({ color: 0x888888, depthTest: false }),
  tainted:   new THREE.LineBasicMaterial({ color: 0xcc44ff, depthTest: false }),
  error:     new THREE.LineBasicMaterial({ color: 0xff3333, depthTest: false }),
}

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

// ── Filter pipeline info overlay (debug mode only) ────────────────────────
function FilterPipelineInfo({ filter }: { filter: TextureFilter }) {
  const isJM     = filter === 'journeymap'
  const isPixel  = filter === 'pixel'
  const canvasSize  = isJM ? '256×256 → 512×512' : '256×256'
  const magFilter   = isPixel ? 'NearestFilter'  : 'LinearFilter'
  const minFilter   = isPixel ? 'NearestMipMapLinear' : 'LinearMipMapLinear'
  const smoothing   = isJM   ? 'true (upscale ctx)' : 'false'
  const upscaled    = isJM   ? 'yes — 2× bilinear' : 'no'
  return (
    <div className="pointer-events-none absolute bottom-2 right-2 rounded border border-zinc-700 bg-black/80 px-2 py-1.5 font-mono text-[10px] text-zinc-300">
      <div className="mb-0.5 font-semibold text-zinc-200">Filter pipeline: {filter}</div>
      <table className="border-separate" style={{ borderSpacing: '0 1px' }}>
        <tbody>
          <Row label="canvas"    value={canvasSize} />
          <Row label="upscaled"  value={upscaled}   highlight={isJM} />
          <Row label="magFilter" value={magFilter}  />
          <Row label="minFilter" value={minFilter}  />
          <Row label="mipmaps"   value="true"       />
          <Row label="smoothing" value={smoothing}  highlight={isJM} />
        </tbody>
      </table>
    </div>
  )
}

function Row({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  return (
    <tr>
      <td className="pr-3 text-zinc-500">{label}</td>
      <td className={highlight ? 'text-cyan-300' : 'text-zinc-200'}>{value}</td>
    </tr>
  )
}

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
      outlineMap:         new Map<string, THREE.LineLoop>(),
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
    }

    const unsubTextures = onTextureLoad(() => { st.texVersion++ })

    const renderer = new THREE.WebGLRenderer({ antialias: false })
    renderer.setSize(W, H)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    container.appendChild(renderer.domElement)
    renderer.domElement.style.cursor = 'grab'

    const scene   = new THREE.Scene()
    scene.background = new THREE.Color(0x0f0f0f)

    const cam      = new THREE.OrthographicCamera(-W/2, W/2, H/2, -H/2, 0.1, 2000)
    const chunkGeo = new THREE.PlaneGeometry(16, 16)

    function updateCam() {
      const { cx, cz, scale } = st.cam
      const halfW = W / (2 * scale), halfH = H / (2 * scale)
      cam.left = -halfW; cam.right = halfW; cam.top = halfH; cam.bottom = -halfH
      cam.position.set(cx, -cz, 500)
      cam.lookAt(cx, -cz, 0)
      cam.updateProjectionMatrix()
    }

    const regionMeshes = new Map<string, THREE.Mesh>()
    const regionGeo    = new THREE.PlaneGeometry(512, 512)
    const regionMat    = new THREE.MeshBasicMaterial({ color: 0x1a1a24 })

    // CPU cache of rendered chunk tiles, demoted from the GPU on eviction.
    const tileCache = new TileImageCache(TILE_CACHE_MAX)

    // All chunk meshes live in this group so the whole detail layer can be shown
    // or hidden with one flag when crossing the LOD threshold — zooming out keeps
    // chunks resident (just hidden) so zooming back in is instant.
    const chunkGroup = new THREE.Group()
    scene.add(chunkGroup)

    function clearChunkCache() {
      for (const entry of st.cache.values()) {
        if (entry instanceof THREE.Mesh) {
          chunkGroup.remove(entry)
          ;(entry.material as THREE.MeshBasicMaterial).map?.dispose()
          ;(entry.material as THREE.MeshBasicMaterial).dispose()
        }
      }
      for (const line of st.outlineMap.values()) scene.remove(line)
      st.outlineMap.clear()
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

    function setOutlineState(key: string, mcx: number, mcz: number, state: ChunkOutlineState) {
      const old = st.outlineMap.get(key)
      if (old) scene.remove(old)
      if (!debugModeRef.current) { st.outlineMap.delete(key); return }
      const line = new THREE.LineLoop(_outlineUnitGeo, _outlineMats[state])
      line.position.set(mcx * 16, -(mcz * 16), 1)
      line.scale.set(16, 16, 1)
      scene.add(line)
      st.outlineMap.set(key, line)
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
    }

    syncRegionsRef.current = syncRegions
    fitCameraRef.current   = fitCamera
    syncRegions()

    // ── Grid lines ──
    const MAX_GV = 8000
    const gridBuf  = new Float32Array(MAX_GV * 3); const gridAttr = new THREE.BufferAttribute(gridBuf,  3)
    gridAttr.setUsage(THREE.DynamicDrawUsage)
    const gridGeo  = new THREE.BufferGeometry(); gridGeo.setAttribute('position', gridAttr)
    const regionGridLines = new THREE.LineSegments(gridGeo, new THREE.LineBasicMaterial({ color: 0x2e2e48 }))
    regionGridLines.frustumCulled = false; scene.add(regionGridLines)

    const chunkGridBuf  = new Float32Array(MAX_GV * 3); const chunkGridAttr = new THREE.BufferAttribute(chunkGridBuf, 3)
    chunkGridAttr.setUsage(THREE.DynamicDrawUsage)
    const chunkGridGeo  = new THREE.BufferGeometry(); chunkGridGeo.setAttribute('position', chunkGridAttr)
    const chunkGridLines = new THREE.LineSegments(chunkGridGeo, new THREE.LineBasicMaterial({ color: 0x1c1c2e }))
    chunkGridLines.frustumCulled = false; scene.add(chunkGridLines)

    function updateGrid() {
      const { cx, cz, scale } = st.cam
      const halfW = W / (2 * scale), halfH = H / (2 * scale)
      const rL = Math.floor((cx - halfW) / 512) - 1, rR = Math.ceil((cx + halfW) / 512) + 1
      const rT = Math.floor((cz - halfH) / 512) - 1, rB = Math.ceil((cz + halfH) / 512) + 1

      let vi = 0
      for (let rx = rL; rx <= rR && vi < MAX_GV - 6; rx++) {
        const x = rx * 512
        gridBuf[vi++]=x; gridBuf[vi++]=-(rT*512-512); gridBuf[vi++]=0.5
        gridBuf[vi++]=x; gridBuf[vi++]=-(rB*512+512); gridBuf[vi++]=0.5
      }
      for (let rz = rT; rz <= rB && vi < MAX_GV - 6; rz++) {
        const y = -(rz * 512)
        gridBuf[vi++]=(rL*512-512); gridBuf[vi++]=y; gridBuf[vi++]=0.5
        gridBuf[vi++]=(rR*512+512); gridBuf[vi++]=y; gridBuf[vi++]=0.5
      }
      gridAttr.needsUpdate = true; gridGeo.setDrawRange(0, vi / 3)

      let ci = 0
      if (scale >= 3) {
        const cL = Math.floor((cx - halfW) / 16) - 1, cR = Math.ceil((cx + halfW) / 16) + 1
        const cT = Math.floor((cz - halfH) / 16) - 1, cB = Math.ceil((cz + halfH) / 16) + 1
        for (let chx = cL; chx <= cR && ci < MAX_GV - 6; chx++) {
          const x = chx * 16
          chunkGridBuf[ci++]=x; chunkGridBuf[ci++]=-(cT*16-16); chunkGridBuf[ci++]=0.5
          chunkGridBuf[ci++]=x; chunkGridBuf[ci++]=-(cB*16+16); chunkGridBuf[ci++]=0.5
        }
        for (let chz = cT; chz <= cB && ci < MAX_GV - 6; chz++) {
          const y = -(chz * 16)
          chunkGridBuf[ci++]=(cL*16-16); chunkGridBuf[ci++]=y; chunkGridBuf[ci++]=0.5
          chunkGridBuf[ci++]=(cR*16+16); chunkGridBuf[ci++]=y; chunkGridBuf[ci++]=0.5
        }
      }
      chunkGridAttr.needsUpdate = true; chunkGridGeo.setDrawRange(0, ci / 3)
    }

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
        setOutlineState(key, mcx, mcz, outlineState)
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
      if (debugModeRef.current) setOutlineState(key, mcx, mcz, 'loaded')
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
      const line = st.outlineMap.get(key)
      if (line) { scene.remove(line); st.outlineMap.delete(key) }
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
          .then((bmp) => tileCache.put(key, bmp, ver))
          .catch(() => {})
          .finally(() => { if (src instanceof ImageBitmap) src.close() })
      }
      mat.map?.dispose()
      mat.dispose()
      st.cache.delete(key)
      st.dataCache.delete(key)
      st.texVersionAtRender.delete(key)
      st.chunkPixels.delete(key)
      const line = st.outlineMap.get(key)
      if (line) { scene.remove(line); st.outlineMap.delete(key) }
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
        for (const [mcx, mcz, key] of items) setOutlineState(key, mcx, mcz, 'rendering')
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
          if (dbg) setOutlineState(key, mcx, mcz, 'empty')
        }
      } catch (err) {
        for (const [mcx, mcz, key] of items) {
          st.resolving.delete(key)
          st.cache.set(key, 'error')
          if (dbg) setOutlineState(key, mcx, mcz, 'error')
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
        setOutlineState(key, mcx, mcz, 'queued')
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
      }
      const cfg = configRef.current
      if (cfg !== st.lastConfig) {
        st.lastConfig = cfg
        st.texVersion++
        st.lodVersion++
      }

      // Detect debug mode toggle — add/remove outlines for existing chunks
      const dbgNow = debugModeRef.current
      if (dbgNow !== st.lastDebugMode) {
        st.lastDebugMode = dbgNow
        if (dbgNow) {
          for (const [key, entry] of st.cache) {
            const [mxs, mzs] = key.split(',')
            const mcx = parseInt(mxs), mcz = parseInt(mzs)
            if (entry instanceof THREE.Mesh) {
              const px = st.chunkPixels.get(key) ?? -2
              const s: ChunkOutlineState = px === -1 ? 'tainted' : px === 0 ? 'empty' : 'loaded'
              setOutlineState(key, mcx, mcz, s)
            } else if (entry === 'error') {
              setOutlineState(key, mcx, mcz, 'error')
            }
          }
        } else {
          for (const line of st.outlineMap.values()) scene.remove(line)
          st.outlineMap.clear()
        }
      }

      // Re-render stale chunks (max 4 per frame) when textures or colors changed
      if (st.texVersion > 0) {
        let rerendered = 0
        const staleNoData: string[] = []
        for (const [key, entry] of st.cache) {
          if (!(entry instanceof THREE.Mesh)) continue
          if ((st.texVersionAtRender.get(key) ?? 0) >= st.texVersion) continue
          const chunkData = st.dataCache.get(key)
          if (chunkData) {
            if (rerendered >= 4) continue
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
              setOutlineState(key, parseInt(mxs), parseInt(mzs), s)
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
      renderer.render(scene, cam)

      const loaded   = [...st.cache.values()].filter((e) => e instanceof THREE.Mesh).length
      const texCount = Object.keys(textureKeysRef.current ?? {}).length
      const rt       = debugModeRef.current ? textureDebugStore.getRenderTotals() : null
      const hudX = st.mouseWorldX !== null ? Math.round(st.mouseWorldX) : Math.round(st.cam.cx)
      const hudZ = st.mouseWorldZ !== null ? Math.round(st.mouseWorldZ) : Math.round(st.cam.cz)
      hud.textContent =
        `X ${hudX}  Z ${hudZ}  ×${scale.toFixed(2)}` +
        `  |  ${loaded} chunks` +
        (bcCountRef.current > 0 ? `  |  ${bcCountRef.current} colors` : '') +
        (texCount > 0 ? `  |  ${texCount} tex-keys` : '') +
        (rt
          ? `  |  drawImage=${rt.drawImage} fillRect=${rt.fillRect}` +
            ` miss=${rt.missingTexKey} fail=${rt.failedTexLoad}`
          : '')

      rafId = requestAnimationFrame(loop)
    }
    rafId = requestAnimationFrame(loop)

    // ── Input ──
    const el = renderer.domElement

    function onMouseDown(e: MouseEvent) {
      st.isDragging = true; st.lastMouse = { x: e.clientX, y: e.clientY }
      el.style.cursor = 'grabbing'
    }
    function onMouseMove(e: MouseEvent) {
      const rect = el.getBoundingClientRect()
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top
      st.mouseWorldX = st.cam.cx + (mx - W / 2) / st.cam.scale
      st.mouseWorldZ = st.cam.cz + (my - H / 2) / st.cam.scale

      if (!st.isDragging || !st.lastMouse) return
      st.cam.cx -= (e.clientX - st.lastMouse.x) / st.cam.scale
      st.cam.cz -= (e.clientY - st.lastMouse.y) / st.cam.scale
      st.lastMouse = { x: e.clientX, y: e.clientY }
      st.pending.length = 0; st.pendingSet.clear()
      updateCam()
    }
    function onMouseLeave() {
      st.mouseWorldX = null
      st.mouseWorldZ = null
    }
    function onMouseUp() {
      st.isDragging = false; st.lastMouse = null
      el.style.cursor = 'grab'
    }
    function onDblClick(e: MouseEvent) {
      e.preventDefault()
      const input = prompt('Go to coordinates — enter X, Z:')
      if (!input) return
      const parts = input.split(',').map((p) => parseFloat(p.trim()))
      if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
        st.cam.cx = parts[0]; st.cam.cz = parts[1]
        st.cam.scale = Math.max(st.cam.scale, MIN_SCALE)
        updateCam()
      }
    }

    async function onContextMenu(e: MouseEvent) {
      e.preventDefault()
      const rect  = el.getBoundingClientRect()
      const mx    = e.clientX - rect.left, my = e.clientY - rect.top
      const worldX = Math.floor(st.cam.cx + (mx - W/2) / st.cam.scale)
      const worldZ = Math.floor(st.cam.cz + (my - H/2) / st.cam.scale)
      const cx    = Math.floor(worldX / 16), cz = Math.floor(worldZ / 16)
      const lx    = ((worldX % 16) + 16) % 16, lz = ((worldZ % 16) + 16) % 16
      const key   = `${cx},${cz}`
      let   data  = st.dataCache.get(key)
      if (!data) {
        // The tile may be rendered from the CPU cache, which keeps the image but
        // not the block data — fetch it on demand so inspection still works.
        inspector.textContent = `X ${worldX}  Z ${worldZ} — loading…`
        inspector.style.display = 'block'
        try {
          const fetched = await fetchChunkBatch(dimensionPath, [[cx, cz]])
          if (fetched[0]) { st.dataCache.set(key, fetched[0]); data = fetched[0] }
        } catch { /* leave data undefined */ }
        if (!data) {
          inspector.textContent = `X ${worldX}  Z ${worldZ} — chunk not loaded`
          inspector.style.display = 'block'; return
        }
      }
      const secs = [...data.sections].sort((a, bv) => bv.y - a.y)

      // Top block: first non-ignore (may be overlay)
      let topId = 0, topMeta = 0, topYv = -1
      topScan: for (const sec of secs) {
        for (let y = 15; y >= 0; y--) {
          const idx = (y << 8) | (lz << 4) | lx
          const id  = sec.blocks[idx]
          if (id !== 0 && registryRef.current.lookup(id).category !== 'ignore') {
            topId = id; topMeta = sec.data[idx]; topYv = sec.y * 16 + y; break topScan
          }
        }
      }

      // Terrain block: first non-ignore, non-overlay (the surface height)
      let terrainYv = -1
      terrainScan: for (const sec of secs) {
        for (let y = 15; y >= 0; y--) {
          const idx = (y << 8) | (lz << 4) | lx
          const id  = sec.blocks[idx]
          if (id === 0) continue
          const cat = registryRef.current.lookup(id).category
          if (cat !== 'ignore' && cat !== 'overlay') { terrainYv = sec.y * 16 + y; break terrainScan }
        }
      }

      // Slope: scan 4 neighboring columns within this chunk, compute shade value
      function scanTerrainY(nx: number, nz: number): number {
        for (const sec of secs) {
          for (let y = 15; y >= 0; y--) {
            const idx = (y << 8) | (nz << 4) | nx
            const id  = sec.blocks[idx]
            if (id === 0) continue
            const cat = registryRef.current.lookup(id).category
            if (cat !== 'ignore' && cat !== 'overlay') return sec.y * 16 + y
          }
        }
        return -1
      }
      const inY = terrainYv
      const inNY = lz > 0  ? scanTerrainY(lx, lz - 1) : -1
      const inSY = lz < 15 ? scanTerrainY(lx, lz + 1) : -1
      const inWY = lx > 0  ? scanTerrainY(lx - 1, lz) : -1
      const inEY = lx < 15 ? scanTerrainY(lx + 1, lz) : -1
      let shade = 0
      if (inSY >= 0) shade += Math.max(-40, Math.min(40, (inY - inSY) * 4))
      if (inNY >= 0) shade += Math.max(-20, Math.min(20, (inY - inNY) * 2))
      if (inEY >= 0) shade += Math.max(-15, Math.min(15, (inY - inEY) * 1.5))
      if (inWY >= 0) shade += Math.max(-10, Math.min(10, (inY - inWY) * 1.0))
      const slopeStr = (lx === 0 || lx === 15 || lz === 0 || lz === 15)
        ? 'edge (partial)'
        : shade > 0 ? `+${shade} (lit)` : shade < 0 ? `${shade} (shadow)` : '0 (flat)'

      const biomeId    = data.biomes.length === 256 ? data.biomes[lx + lz * 16] : -1
      const topDef     = registryRef.current.lookup(topId)
      const texKey     = topDef.textureAlias
        ?? metaTextureKeysRef.current?.[`${topId}:${topMeta}`]
        ?? textureKeysRef.current?.[topId]
        ?? null
      const texImg     = texKey ? getTexture(texKey) : null
      const hasTexture = !!texImg
      const name       = blockNamesRef.current?.[topId] ?? `block:${topId}`

      let raw: readonly [number, number, number]
      let colorSrc: string
      if (topDef.tint === 'grass') {
        raw = biomeTints(biomeId >= 0 ? biomeId : 1).grass
        colorSrc = hasTexture ? 'texture + grass tint' : 'biome grass'
      } else if (topDef.tint === 'foliage') {
        raw = biomeTints(biomeId >= 0 ? biomeId : 1).foliage
        colorSrc = hasTexture ? 'texture + foliage tint' : 'biome foliage'
      } else if (topDef.textureTint === 'metadata16' || topDef.textureTint === 'custom') {
        raw = resolveMetadataTint(topMeta, topDef.textureTintColors)
        colorSrc = hasTexture ? 'texture + meta tint' : 'meta tint'
      } else {
        const mapped = blockColorsRef.current?.[topId]
        raw = mapped ?? blockColorRGB(topId, topMeta)
        colorSrc = hasTexture ? 'texture' : (mapped ? 'color' : 'fallback')
      }

      const hex = '#' + Array.from(raw).map((v) => v.toString(16).padStart(2, '0')).join('')
      const texStatus = hasTexture ? '✓ loaded' : texKey ? '⏳ loading…' : '✗ no mapping'
      const renderInfo =
        topDef.category +
        (topDef.tint                                         ? ` · tint:${topDef.tint}`           : '') +
        (topDef.textureTint && topDef.textureTint !== 'none'
          ? ` · tex-tint:${topDef.textureTint}${topDef.textureTintColors ? ' custom' : ''}`
          : '') +
        (topDef.alphaMode && topDef.alphaMode !== 'opaque'  ? ` · alpha:${topDef.alphaMode}`     : '') +
        ` · src:${topDef.resolverSource}`
      const yLine = terrainYv >= 0 && terrainYv !== topYv
        ? `Y ${topYv}  terrain ${terrainYv}`
        : `Y ${topYv}`
      inspector.innerHTML =
        `<b>X ${worldX}  Z ${worldZ}  ${yLine}</b><br>` +
        `${name}<br>` +
        `id: ${topId}  meta: ${topMeta}  biome: ${biomeId}<br>` +
        `slope: <span style="opacity:.75">${slopeStr}</span><br>` +
        `render: <span style="opacity:.75">${renderInfo}</span><br>` +
        `tex: ${texKey ?? 'none'}${topDef.textureAlias ? ' (alias)' : ''} — ${texStatus}<br>` +
        `color: <span style="display:inline-block;width:10px;height:10px;background:${hex};border:1px solid #888"></span> ${hex}` +
        `  <span style="opacity:.6">(${colorSrc})</span>` +
        `<br><button id="atlas-copy-block" style="margin-top:4px;background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.25);border-radius:3px;padding:1px 6px;font-size:10px;cursor:pointer;color:#ccc">copy</button>`
      const copyBtn = inspector.querySelector<HTMLButtonElement>('#atlas-copy-block')
      if (copyBtn) {
        copyBtn.addEventListener('click', async () => {
          const lines = [
            `X ${worldX}  Z ${worldZ}  ${yLine}`,
            name,
            `id: ${topId}  meta: ${topMeta}  biome: ${biomeId}`,
            `slope: ${slopeStr}`,
            `tex: ${texKey ?? 'none'}${topDef.textureAlias ? ' (alias)' : ''} — ${texStatus}`,
            `color: ${hex} (${colorSrc})`,
          ]
          await navigator.clipboard.writeText(lines.join('\n'))
          copyBtn.textContent = 'copied!'
          setTimeout(() => { copyBtn.textContent = 'copy' }, 1500)
        })
      }
      inspector.style.display = 'block'
      inspector.style.left = `${e.clientX - rect.left + 8}px`
      inspector.style.top  = `${e.clientY - rect.top  + 8}px`
    }

    function hideInspector() { inspector.style.display = 'none' }

    function onWheel(e: WheelEvent) {
      e.preventDefault()
      const rect   = el.getBoundingClientRect()
      const mx     = e.clientX - rect.left, my = e.clientY - rect.top
      const worldX = st.cam.cx + (mx - W/2) / st.cam.scale
      const worldZ = st.cam.cz + (my - H/2) / st.cam.scale
      const factor = e.deltaY < 0 ? 1.25 : 1 / 1.25
      st.cam.scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, st.cam.scale * factor))
      st.cam.cx    = worldX - (mx - W/2) / st.cam.scale
      st.cam.cz    = worldZ - (my - H/2) / st.cam.scale
      st.pending.length = 0; st.pendingSet.clear()
      updateCam()
    }

    const resizeObs = new ResizeObserver(() => {
      W = container.clientWidth || 800; H = container.clientHeight || 600
      renderer.setSize(W, H); updateCam()
    })
    resizeObs.observe(container)
    updateCam()

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'f' || e.key === 'F' || e.key === 'Home') fitCamera()
    }

    el.addEventListener('mousedown',     onMouseDown)
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup',   onMouseUp)
    el.addEventListener('mouseleave',    onMouseLeave)
    el.addEventListener('wheel',         onWheel,       { passive: false })
    el.addEventListener('dblclick',      onDblClick)
    el.addEventListener('contextmenu',   onContextMenu)
    window.addEventListener('mousedown', hideInspector)
    window.addEventListener('keydown',   onKeyDown)

    return () => {
      unsubTextures()
      syncRegionsRef.current = null
      fitCameraRef.current   = null
      cancelAnimationFrame(rafId)
      resizeObs.disconnect()
      el.removeEventListener('mousedown',     onMouseDown)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup',   onMouseUp)
      el.removeEventListener('mouseleave',    onMouseLeave)
      el.removeEventListener('wheel',         onWheel)
      el.removeEventListener('dblclick',      onDblClick)
      el.removeEventListener('contextmenu',   onContextMenu)
      window.removeEventListener('mousedown', hideInspector)
      window.removeEventListener('keydown',   onKeyDown)
      clearChunkCache()   // also removes outlines and clears chunkPixels
      for (const [key, m] of regionMeshes) revertRegionTile(key, m)  // dispose tile materials
      regionMat.dispose()
      chunkGeo.dispose(); regionGeo.dispose()
      gridGeo.dispose();  chunkGridGeo.dispose()
      renderer.dispose()
      renderer.domElement.remove()
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
