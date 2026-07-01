/**
 * Pure chunk-tile pixel renderer.
 *
 * Given a chunk's block data plus the resolved colour/texture maps and render
 * config, paints a 256x256 top-down tile canvas. No React or scene state — the
 * WorldMap effect owns orchestration and just calls these.
 */
import * as THREE from 'three'
import type { ChunkData } from './api/chunks'
import type { BlockColorMap } from '../blocks/api/blockColors'
import {
  biomeTints,
  blockColorRGB,
  metaBlockColorRGB,
  resolveMetadataTint,
} from '../blocks/blockColors'
import type { BlockRenderRegistry } from '../blocks/blockRenderRegistry'
import { columnTally } from './columnTally'
import type { RenderConfig, TextureFilter } from '../blocks/renderPresets'
import { shouldShowOverlay } from '../blocks/renderPresets'
import { textureDebugStore } from '../textures/textureDebugStore'
import { getTexture } from '../textures/textureLoader'

const CELL = 16 // pixels per block column in chunk canvas
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
export function renderChunkImage(
  data: ChunkData,
  colorMap: BlockColorMap | undefined,
  textureKeys: Record<number, string> | undefined,
  metaTextureKeys: Record<string, string> | undefined,
  registry: BlockRenderRegistry,
  config: RenderConfig,
  recordDebug: boolean, // only true on first render to avoid double-counting
  debugMode: boolean, // controls textureDebugStore recording
  blockNames: Record<number, string> | undefined
): { canvas: HTMLCanvasElement; stats: ChunkRenderStats } {
  let drawImage = 0,
    fillRect = 0,
    missingTexKey = 0,
    failedTexLoad = 0
  const sections = [...data.sections].sort((a, b) => b.y - a.y)

  // ── Pass 1: classify every (x,z) column ─────────────────────────────
  // baseY/baseId/baseMeta: highest surface block (may be transparent).
  // underY/underId/underMeta: first solid block beneath a transparent surface.
  // overlayLists: OVERLAY blocks above the base, bottom-to-top draw order.
  // floorY: first solid block below a water surface (for depth shading).
  const baseY = new Int16Array(256).fill(-1)
  const baseId = new Uint16Array(256)
  const baseMeta = new Uint8Array(256)
  const floorY = new Int16Array(256).fill(-1)
  const underY = new Int16Array(256).fill(-1) // block below a transparent surface
  const underId = new Uint16Array(256)
  const underMeta = new Uint8Array(256)
  // Each entry is [id, meta] pairs accumulated top-down then reversed.
  const overlayLists: ([number, number][] | null)[] = new Array(256).fill(null)

  for (let z = 0; z < 16; z++) {
    for (let x = 0; x < 16; x++) {
      const i = z * 16 + x
      let foundBase = false
      let inWater = false
      let needUnder = false // scanning for block below a transparent surface
      let colOverlays: [number, number][] | null = null

      outer: for (const section of sections) {
        for (let y = 15; y >= 0; y--) {
          const idx = (y << 8) | (z << 4) | x
          const id = section.blocks[idx]
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
              if (config.foliageMode === 'hidden' && def.tint === 'foliage')
                continue
              baseY[i] = absY
              baseId[i] = id
              baseMeta[i] = section.data[idx]
              foundBase = true
              inWater = def.category === 'fluid' && def.tint === 'water'
              needUnder = def.category === 'transparent'
              if (!inWater && !needUnder) break outer
            }
          } else if (needUnder) {
            // Continue scanning below a transparent block to find the terrain.
            if (def.category !== 'overlay') {
              underY[i] = absY
              underId[i] = id
              underMeta[i] = section.data[idx]
              break outer
            }
          } else if (
            inWater &&
            !(def.category === 'fluid' && def.tint === 'water')
          ) {
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
  mini.width = 16
  mini.height = 16
  const miniCtx = mini.getContext('2d')!
  miniCtx.imageSmoothingEnabled = false

  for (let z = 0; z < 16; z++) {
    for (let x = 0; x < 16; x++) {
      const i = z * 16 + x
      const px = x * CELL
      const pz = z * CELL

      // No base block found — void cell
      if (baseY[i] < 0) {
        ctx.fillStyle = '#0a0a0a'
        ctx.fillRect(px, pz, CELL, CELL)
        continue
      }

      const id = baseId[i]
      const meta = baseMeta[i]
      const blockY = baseY[i]
      const baseDef = registry.lookup(id)
      const isWater = baseDef.category === 'fluid' && baseDef.tint === 'water'
      const isTransparent = baseDef.category === 'transparent'
      const isGrass = baseDef.tint === 'grass'
      const isFoliage = baseDef.tint === 'foliage'
      const isBiome = (isGrass || isFoliage) && config.biomeTint
      const tintType = baseDef.tint ?? (isWater ? 'water' : 'none')

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
      } else if (
        baseDef.textureTint === 'metadata16' ||
        baseDef.textureTint === 'custom'
      ) {
        ;[r, g, b] = resolveMetadataTint(meta, baseDef.textureTintColors)
      } else {
        // Check meta-specific color first (wool, stained glass/clay, planks, logs)
        const metaColor = metaBlockColorRGB(id, meta)
        if (metaColor) {
          r = metaColor[0]
          g = metaColor[1]
          b = metaColor[2]
        } else {
          const mapped = colorMap?.[id]
          const raw = mapped ?? blockColorRGB(id, meta)
          r = raw[0]
          g = raw[1]
          b = raw[2]
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
      }

      // ── Neighbor heights for elevation shading + contours ─────────
      // Edge columns stay -1; cross-chunk shading is a future improvement.
      const nY = z > 0 ? baseY[(z - 1) * 16 + x] : -1
      const sY = z < 15 ? baseY[(z + 1) * 16 + x] : -1
      const wY = x > 0 ? baseY[z * 16 + (x - 1)] : -1
      const eY = x < 15 ? baseY[z * 16 + (x + 1)] : -1

      // Color desaturation (Topo preset and any preset with colorSaturation < 1)
      const sat = config.colorSaturation
      if (sat < 1.0) {
        const lum = 0.299 * r + 0.587 * g + 0.114 * b
        r = Math.round(lum + (r - lum) * sat)
        g = Math.round(lum + (g - lum) * sat)
        b = Math.round(lum + (b - lum) * sat)
      }

      const texKey = !isWater
        ? (baseDef.textureAlias ??
          metaTextureKeys?.[`${id}:${meta}`] ??
          textureKeys?.[id] ??
          null)
        : null
      // For 'simplified' foliage mode, skip the texture so only the biome fill renders.
      const skipTex = config.foliageMode === 'simplified' && isFoliage
      const texImg =
        config.terrainTextures && !skipTex && texKey ? getTexture(texKey) : null

      // Counters (skip for flat-mode blocks — they intentionally have no texture)
      if (!isWater && baseDef.mapRenderMode !== 'flat') {
        if (!texKey) missingTexKey++
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
        const uId = underId[i]
        const uMeta = underMeta[i]
        const uDef = registry.lookup(uId)
        const uIsGrass = uDef.tint === 'grass'
        const uIsFoliage = uDef.tint === 'foliage'
        const uIsBiome = (uIsGrass || uIsFoliage) && config.biomeTint

        let ur: number, ug: number, ub: number
        if (uIsGrass) {
          ;[ur, ug, ub] = grassTints[i]
        } else if (uIsFoliage) {
          ;[ur, ug, ub] = foliageTints[i]
        } else {
          const uMeta2 = metaBlockColorRGB(uId, uMeta)
          if (uMeta2) {
            ur = uMeta2[0]
            ug = uMeta2[1]
            ub = uMeta2[2]
          } else {
            const uMapped = colorMap?.[uId]
            const uRaw = uMapped ?? blockColorRGB(uId, uMeta)
            ur = uRaw[0]
            ug = uRaw[1]
            ub = uRaw[2]
            if (uMapped) {
              const maxCh = Math.max(ur, ug, ub)
              if (maxCh === 0) {
                ur = ug = ub = 130
              } else if (maxCh < 80) {
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

        const uTexKey =
          metaTextureKeys?.[`${uId}:${uMeta}`] ?? textureKeys?.[uId] ?? null
        const uTexImg =
          config.terrainTextures && uTexKey ? getTexture(uTexKey) : null

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
          const opacity = baseDef.mapOpacity ?? 0.4
          ctx.fillStyle = `rgba(${r},${g},${b},${opacity})`
          ctx.fillRect(px, pz, CELL, CELL)
          fillRect++
        } else if (
          texImg &&
          (baseDef.textureTint === 'metadata16' ||
            baseDef.textureTint === 'custom')
        ) {
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
          ctx.globalAlpha = 0.5
          ctx.drawImage(mini, 0, 0, 16, 16, px, pz, CELL, CELL)
          ctx.globalAlpha = 1.0
          drawImage++
        } else if (texImg) {
          ctx.globalAlpha = 0.5
          if (satFilter) ctx.filter = satFilter
          ctx.drawImage(texImg, 0, 0, 16, 16, px, pz, CELL, CELL)
          ctx.globalAlpha = 1.0
          if (satFilter) ctx.filter = 'none'
          drawImage++
        } else {
          const opacity = baseDef.mapOpacity ?? 0.4
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
          const ovDef = registry.lookup(ovId)

          // Only use mapRenderMode:'marker' when useMarkers is enabled.
          // Markers draw BEFORE the texture check: textureless multiparts
          // (AE2 cable bus) can only ever render as a marker dot.
          const effectiveRenderMode = config.useMarkers
            ? (ovDef.mapRenderMode ?? 'overlay')
            : 'overlay'

          if (effectiveRenderMode === 'marker') {
            // Tiny solid-colour dot at the centre of the cell (e.g. torch in Detailed mode).
            const markerSz = Math.max(2, Math.ceil(CELL * 0.3125)) // 5 px at CELL=16
            ctx.fillStyle = ovDef.mapColor ?? '#ffffff'
            ctx.fillRect(
              px + Math.floor((CELL - markerSz) / 2),
              pz + Math.floor((CELL - markerSz) / 2),
              markerSz,
              markerSz
            )
            drawImage++
            continue
          }

          const ovKey =
            metaTextureKeys?.[`${ovId}:${ovMeta}`] ??
            textureKeys?.[ovId] ??
            null
          const ovImg = ovKey ? getTexture(ovKey) : null
          if (!ovImg) continue

          const ovIsGrass = config.biomeTint && ovDef.tint === 'grass'
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
          let bright = 0,
            dark = 0
          if (nY >= 0) {
            const d = blockY - nY
            if (d > 0)
              bright += d // N-face: lit by NW sun
            else dark += -d * 0.3 // below N cliff: partial shadow
          }
          if (wY >= 0) {
            const d = blockY - wY
            if (d > 0)
              bright += d * 0.65 // W-face: secondary lit direction
            else dark += -d * 0.2
          }
          if (sY >= 0) {
            const d = sY - blockY
            if (d > 0)
              dark += d // S-slope above: full shadow
            else bright += -d * 0.15 // S below: minor bright
          }
          if (eY >= 0) {
            const d = eY - blockY
            if (d > 0)
              dark += d * 0.65 // E-slope: secondary shadow
            else bright += -d * 0.1
          }

          // Ambient occlusion: extra darkening at cliff edges (steep drops in any direction)
          const steep = Math.max(
            nY >= 0 ? Math.abs(blockY - nY) : 0,
            sY >= 0 ? Math.abs(blockY - sY) : 0,
            wY >= 0 ? Math.abs(blockY - wY) : 0,
            eY >= 0 ? Math.abs(blockY - eY) : 0
          )
          const ao = Math.max(0, ((steep - 2) * str) / 80)

          // Normalize and clamp. NORM=9: a 3-block cliff → ~33% shade at str=1.
          // maxD 0.78 lets Topo (str=2.5) reach near-black on cliffs.
          const NORM = 9
          const maxB = elevMode === 'strong' ? 0.48 : 0.28
          const maxD = elevMode === 'strong' ? 0.78 : 0.42
          const brightA = Math.min((bright * str) / NORM, maxB)
          const darkA = Math.min((dark * str) / NORM + ao, maxD)
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
        const shift = cMode === 'strong' ? 2 : 3 // bit-shift = log2(interval)
        const band = blockY >> shift
        const atContour =
          (sY >= 0 && sY >> shift !== band) ||
          (nY >= 0 && nY >> shift !== band) ||
          (eY >= 0 && eY >> shift !== band) ||
          (wY >= 0 && wY >> shift !== band)
        if (atContour) {
          const cAlpha =
            cMode === 'subtle' ? 0.18 : cMode === 'normal' ? 0.32 : 0.5
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
    return [
      Math.round(30 + t * 30),
      Math.round(80 + t * 100),
      Math.round(160 - t * 60),
    ]
  }
  if (y < 128) {
    const t = (y - 80) / 48
    return [
      Math.round(60 + t * 160),
      Math.round(180 + t * 50),
      Math.round(100 - t * 80),
    ]
  }
  const t = Math.min((y - 128) / 100, 1)
  return [
    Math.round(220 + t * 35),
    Math.round(230 + t * 25),
    Math.round(20 + t * 235),
  ]
}

export function makeChunkTexture(
  canvas: HTMLCanvasElement,
  filter: TextureFilter = 'pixel'
): THREE.CanvasTexture {
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

export function upscaleCanvas(
  src: HTMLCanvasElement,
  size: number
): HTMLCanvasElement {
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
export function canvasDiagnostics(canvas: HTMLCanvasElement): number {
  try {
    const d = canvas
      .getContext('2d')!
      .getImageData(0, 0, canvas.width, canvas.height).data
    let n = 0
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] | d[i + 1] | d[i + 2] | d[i + 3]) n++
    }
    return n
  } catch {
    return -1 // SecurityError: canvas tainted by cross-origin drawImage
  }
}
