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
  hardcodedBlockColor,
  metaBlockColorRGB,
  resolveMetadataTint,
  UNKNOWN_COLOR,
} from '../blocks/blockColors'
import type {
  BlockRenderRegistry,
  ResolvedDefinition,
} from '../blocks/blockRenderRegistry'
import { columnTally } from './columnTally'
import type { RenderConfig, TextureFilter } from '../blocks/renderPresets'
import { isTagHidden, shouldShowOverlay } from '../blocks/renderPresets'
import { pipeSystemName } from '../blocks/pipeSystems'
import { textureDebugStore } from '../textures/textureDebugStore'
import { getTexture } from '../textures/textureLoader'
import { averageTextureColor } from '../textures/textureAverage'

const CELL = 16 // pixels per block column in chunk canvas
const CANVAS_SIZE = 256 // 16 blocks × 16 px

// ── Water ────────────────────────────────────────────────────────────────────
// Translucent water: the seabed colour is blended toward this deep-water colour
// by depth, so shallow water shows the floor (sand/dirt/gravel) and deep water
// reads as ocean blue. Shared by the detailed and overview renderers.
export const WATER_DEEP: readonly [number, number, number] = [28, 66, 140]

/** Blend factor of deep-water colour over the seabed, by water depth (blocks). */
export function waterBlend(depth: number): number {
  return 0.6 + 0.3 * Math.min(depth / 12, 1) // 0.6 shallow → 0.9 deep
}

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

// ── Cross-chunk neighbor heights ─────────────────────────────────────────────
// Terrain heights of the four adjacent chunks' facing edge rows, so elevation
// shading and contours are seamless across chunk borders. n/s are indexed by
// x (0-15); w/e are indexed by z. null/undefined = neighbor not loaded yet.
export interface NeighborHeights {
  n?: Int16Array | null
  s?: Int16Array | null
  w?: Int16Array | null
  e?: Int16Array | null
}

// Cross-chunk pipe/cable presence of the four adjacent chunks' facing edge rows,
// so the Infrastructure View's network connectors join across chunk borders.
// Indexed like NeighborHeights (n/s by x, w/e by z); 1 = edge cell is a pipe/cable.
export interface NeighborPipes {
  n?: Uint8Array | null
  s?: Uint8Array | null
  w?: Uint8Array | null
  e?: Uint8Array | null
}

/** Biome grids of the eight adjacent chunks, used for JourneyMap-style 3x3 tint blending. */
export interface NeighborBiomes {
  n?: readonly number[] | null
  s?: readonly number[] | null
  w?: readonly number[] | null
  e?: readonly number[] | null
  nw?: readonly number[] | null
  ne?: readonly number[] | null
  sw?: readonly number[] | null
  se?: readonly number[] | null
}

/** True when a block carries the pipe or cable tag (Infrastructure View). */
function isPipeOrCable(def: Pick<ResolvedDefinition, 'blockTags'>): boolean {
  const tags = def.blockTags
  if (!tags) return false
  for (const tag of tags) if (tag === 'pipe' || tag === 'cable') return true
  return false
}

/** True when a block carries the cable tag (power/data cables, vs item pipes). */
function isCableTagged(def: Pick<ResolvedDefinition, 'blockTags'>): boolean {
  const tags = def.blockTags
  if (!tags) return false
  for (const tag of tags) if (tag === 'cable') return true
  return false
}

/**
 * Whether a pipe/cable block should appear in the Infrastructure View network:
 * its system isn't toggled off, and — for cables — showCables is on (cables are
 * hidden by default, since power/data cabling is the noisiest).
 */
function isPipeVisible(
  def: Pick<ResolvedDefinition, 'blockTags'>,
  name: string | undefined,
  config: Pick<RenderConfig, 'hiddenPipeSystems' | 'showCables'>
): boolean {
  if (isCableTagged(def) && !config.showCables) return false
  return !config.hiddenPipeSystems.has(pipeSystemName(name))
}

/**
 * Compute the 16 terrain heights of the edge row of *data* that faces a chunk
 * on the given *side* (side = where the RENDERED chunk sits relative to this
 * neighbor: 'n' means this chunk is the northern neighbor, so sample its
 * southern row z=15). Uses the same column rules as the base scan in
 * renderChunkImage — ignore/overlay skipped, foliage-hidden respected — so the
 * heights match what an in-chunk neighbor would report.
 */
export function computeEdgeHeights(
  data: ChunkData,
  side: 'n' | 's' | 'w' | 'e',
  registry: BlockRenderRegistry,
  config: RenderConfig
): Int16Array {
  const sections = [...data.sections].sort((a, b) => b.y - a.y)
  const out = new Int16Array(16).fill(-1)

  for (let j = 0; j < 16; j++) {
    // n: our chunk is north of the target → sample this chunk's z=15 row.
    // s: z=0 row.  w: x=15 column.  e: x=0 column.
    const x = side === 'n' || side === 's' ? j : side === 'w' ? 15 : 0
    const z = side === 'w' || side === 'e' ? j : side === 'n' ? 15 : 0

    scan: for (const section of sections) {
      for (let y = 15; y >= 0; y--) {
        const idx = (y << 8) | (z << 4) | x
        const id = section.blocks[idx]
        if (id === 0) continue
        const def = registry.lookup(id, section.data[idx])
        if (def.category === 'ignore' || def.category === 'overlay') continue
        if (config.foliageMode === 'hidden' && def.tint === 'foliage') continue
        if (isTagHidden(def, config)) continue // hidden layer (pipes/cables/…)
        out[j] = section.y * 16 + y
        break scan
      }
    }
  }
  return out
}

/**
 * Pipe/cable presence along the edge row of *data* facing the given side — the
 * Infrastructure-View analogue of computeEdgeHeights. Emits 1 where the facing
 * edge column's surface block (first renderable going down, mirroring the base
 * scan's pipe capture) is pipe/cable-tagged, so network connectors join across
 * chunk borders instead of breaking at every 16-block seam.
 */
export function computeEdgePipes(
  data: ChunkData,
  side: 'n' | 's' | 'w' | 'e',
  registry: BlockRenderRegistry,
  config: RenderConfig,
  blockNames: Record<number, string> | undefined
): Uint8Array {
  const sections = [...data.sections].sort((a, b) => b.y - a.y)
  const out = new Uint8Array(16)

  for (let j = 0; j < 16; j++) {
    const x = side === 'n' || side === 's' ? j : side === 'w' ? 15 : 0
    const z = side === 'w' || side === 'e' ? j : side === 'n' ? 15 : 0

    scan: for (const section of sections) {
      for (let y = 15; y >= 0; y--) {
        const idx = (y << 8) | (z << 4) | x
        const id = section.blocks[idx]
        if (id === 0) continue
        const def = registry.lookup(id, section.data[idx])
        if (def.category === 'ignore') continue
        // Pipe/cable first (solid OR overlay), mirroring the base scan's capture.
        if (isPipeOrCable(def)) {
          // A hidden system's / hidden-cable pipe doesn't join the network —
          // keep scanning past it, exactly like the base scan.
          if (isPipeVisible(def, blockNames?.[id], config)) {
            out[j] = 1
            break scan
          }
          continue
        }
        if (def.category === 'overlay') continue // non-pipe overlay: not terrain
        if (config.foliageMode === 'hidden' && def.tint === 'foliage') continue
        if (isTagHidden(def, config)) continue // hidden non-pipe solid — scan on
        break scan // terrain: not a pipe
      }
    }
  }
  return out
}

// ── Hillshade ────────────────────────────────────────────────────────────────
// Directional hillshade with NW light: N and W faces are lit, S and E are in
// shadow, plus ambient occlusion near steep drops. Shared by the renderer and
// the block inspector so the tooltip always reports exactly what was drawn.
//
// Per-direction height deltas are capped at DELTA_CAP so man-made vertical
// transitions (base walls, room drops — often 7-10 blocks) shade like a gentle
// JourneyMap-style step instead of saturating the clamp into a white/black
// wash. Natural terrain (1-2 block steps) is unaffected.
const DELTA_CAP = 2

export function computeHillshade(
  blockY: number,
  nY: number,
  sY: number,
  wY: number,
  eY: number,
  config: Pick<RenderConfig, 'elevationMode' | 'elevationStrength'>
): { brightA: number; darkA: number } {
  const elevMode = config.elevationMode
  if (elevMode === 'off' || elevMode === 'debug-heightmap') {
    return { brightA: 0, darkA: 0 }
  }
  const str = config.elevationStrength

  if (elevMode !== 'strong') {
    // ── JourneyMap-style slope shading (normal modes) ──
    // Compare against the N and W neighbors ONLY, averaged. This is what keeps
    // JM interiors visually uniform: tiles east/south of a wall are untouched,
    // a floor tile at the rim of a drop gets a whisper (~6%), and genuine
    // slope runs (successive offset columns) still read as terrain. Highlights
    // are weaker than shadows — white wash on pale floors is far more visible
    // than shadow at a wall's base.
    const f = (nb: number) =>
      nb < 0 ? 0 : Math.max(-DELTA_CAP, Math.min(DELTA_CAP, blockY - nb))
    const slope = (f(nY) + f(wY)) / 2 // + = above N/W neighbors (lit), − = below (shadow)
    return {
      brightA: Math.min(Math.max(slope * 0.06 * str, 0), 0.22),
      darkA: Math.min(Math.max(-slope * 0.12 * str, 0), 0.35),
    }
  }

  // ── 'strong' (Topo/Relief): directional accumulation over all four sides ──
  // Kept dramatic on purpose — these presets want near-black cliff faces.
  const cap = (d: number) => Math.min(d, DELTA_CAP)
  let bright = 0,
    dark = 0
  if (nY >= 0) {
    const d = blockY - nY
    if (d > 0)
      bright += cap(d) // N-face: lit by NW sun
    else dark += cap(-d) * 0.3 // below N cliff: partial shadow
  }
  if (wY >= 0) {
    const d = blockY - wY
    if (d > 0)
      bright += cap(d) * 0.65 // W-face: secondary lit direction
    else dark += cap(-d) * 0.2
  }
  if (sY >= 0) {
    const d = sY - blockY
    if (d > 0)
      dark += cap(d) // S-slope above: full shadow
    else bright += cap(-d) * 0.15 // S below: minor bright
  }
  if (eY >= 0) {
    const d = eY - blockY
    if (d > 0)
      dark += cap(d) * 0.65 // E-slope: secondary shadow
    else bright += cap(-d) * 0.1
  }

  // Ambient occlusion: extra darkening at cliff edges (steep drops in any direction)
  const steep = Math.max(
    nY >= 0 ? Math.abs(blockY - nY) : 0,
    sY >= 0 ? Math.abs(blockY - sY) : 0,
    wY >= 0 ? Math.abs(blockY - wY) : 0,
    eY >= 0 ? Math.abs(blockY - eY) : 0
  )
  const ao = Math.max(0, ((steep - 2) * str) / 80)

  const NORM = 9
  return {
    brightA: Math.min((bright * str) / NORM, 0.48),
    darkA: Math.min((dark * str) / NORM + ao, 0.78),
  }
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
  blockNames: Record<number, string> | undefined,
  neighbors?: NeighborHeights,
  neighborPipes?: NeighborPipes,
  neighborBiomes?: NeighborBiomes
): { canvas: HTMLCanvasElement; stats: ChunkRenderStats } {
  let drawImage = 0,
    fillRect = 0,
    missingTexKey = 0,
    failedTexLoad = 0
  const sections = [...data.sections].sort((a, b) => b.y - a.y)

  // A block is "unknown" when it resolves to neither a texture nor a known
  // colour — i.e. it would fall to the random golden-angle hash. Pass 1 scans
  // past these to a renderable block below (downward-scan before fallback), and
  // Pass 2 fills any that remain with a neutral grey (UNKNOWN_COLOR) rather than
  // a random colour.
  const isUnknownBlock = (
    id: number,
    meta: number,
    def: ResolvedDefinition
  ): boolean => {
    if (def.tint) return false // grass/foliage/water are always renderable
    if (metaTextureKeys?.[`${id}:${meta}`] ?? textureKeys?.[id]) return false // has a texture key
    if (colorMap?.[id]) return false // scanned colour
    if (metaBlockColorRGB(id, meta)) return false // hardcoded per-meta colour
    if (hardcodedBlockColor(id)) return false // hardcoded per-id colour
    return true
  }

  // ── Pass 1: classify every (x,z) column ─────────────────────────────
  // baseY/baseId/baseMeta: highest surface block (may be transparent).
  // underY/underId/underMeta: first solid block beneath a transparent surface.
  // overlayLists: OVERLAY blocks above the base, bottom-to-top draw order.
  // floorY: first solid block below a water surface (for depth shading).
  const baseY = new Int16Array(256).fill(-1)
  const baseId = new Uint16Array(256)
  const baseMeta = new Uint8Array(256)
  // Infrastructure View: the surface pipe/cable per column (0 = none). Captured
  // while scanning so the terrain beneath still renders as the base; the network
  // is drawn on top in a final pass.
  const pipeId = new Uint16Array(256)
  const pipeMeta = new Uint8Array(256)
  const floorY = new Int16Array(256).fill(-1)
  const floorId = new Uint16Array(256) // seabed block under water
  const floorMeta = new Uint8Array(256)
  const underY = new Int16Array(256).fill(-1) // block below a transparent surface
  const underId = new Uint16Array(256)
  const underMeta = new Uint8Array(256)
  // Topmost unknown block per column + a flag when it becomes the base because
  // nothing renderable sat below it (downward-scan fell through).
  const unkY = new Int16Array(256).fill(-1)
  const unkId = new Uint16Array(256)
  const unkMeta = new Uint8Array(256)
  const baseUnknown = new Uint8Array(256)
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
          const def = registry.lookup(id, section.data[idx])
          if (def.category === 'ignore') continue

          // Infrastructure View: capture the topmost pipe/cable — solid OR overlay
          // (e.g. AE2's cable bus) — into the network and skip it here, so the
          // terrain beneath renders and it isn't also drawn as a block/marker.
          // Cables are excluded unless showCables; a system toggled off is skipped.
          if (config.infraView && !foundBase && isPipeOrCable(def)) {
            if (
              pipeId[i] === 0 &&
              isPipeVisible(def, blockNames?.[id], config)
            ) {
              pipeId[i] = id
              pipeMeta[i] = section.data[idx]
            }
            continue
          }
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
              // Hidden layer (pipes/cables/machines toggled off): skip the solid
              // and keep scanning down so the terrain beneath shows through.
              if (isTagHidden(def, config)) continue
              // Unknown block: remember the topmost one, but keep scanning down
              // for a renderable block to show beneath it instead of dropping to
              // a flat fallback colour.
              if (isUnknownBlock(id, section.data[idx], def)) {
                if (config.hiddenTags.has('unknown')) continue
                if (unkY[i] < 0) {
                  unkY[i] = absY
                  unkId[i] = id
                  unkMeta[i] = section.data[idx]
                }
                continue
              }
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
            floorId[i] = id
            floorMeta[i] = section.data[idx]
            break outer
          }
        }
      }

      // Nothing renderable sat below an unknown top block — fall back to the
      // unknown block itself, flagged so Pass 2 fills a neutral grey.
      if (!foundBase && unkY[i] >= 0) {
        baseY[i] = unkY[i]
        baseId[i] = unkId[i]
        baseMeta[i] = unkMeta[i]
        baseUnknown[i] = 1
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

  // Pre-compute JourneyMap-style 3x3 biome tints per column. Samples outside
  // this chunk come from cached neighbors; until they arrive, clamp to this
  // chunk's edge so loading order cannot create a dark seam.
  const grassTints: Array<readonly [number, number, number]> = new Array(256)
  const foliageTints: Array<readonly [number, number, number]> = new Array(256)
  const ownBiomes = data.biomes.length === 256 ? data.biomes : null
  const sampleBiome = (x: number, z: number): number => {
    if (x >= 0 && x < 16 && z >= 0 && z < 16)
      return ownBiomes?.[z * 16 + x] ?? 1
    const side =
      z < 0
        ? x < 0
          ? neighborBiomes?.nw
          : x > 15
            ? neighborBiomes?.ne
            : neighborBiomes?.n
        : z > 15
          ? x < 0
            ? neighborBiomes?.sw
            : x > 15
              ? neighborBiomes?.se
              : neighborBiomes?.s
          : x < 0
            ? neighborBiomes?.w
            : neighborBiomes?.e
    const sx = (x + 16) & 15
    const sz = (z + 16) & 15
    return side?.length === 256
      ? side[sz * 16 + sx]
      : (ownBiomes?.[Math.max(0, Math.min(15, z)) * 16 + Math.max(0, Math.min(15, x))] ?? 1)
  }
  for (let z = 0; z < 16; z++) {
    for (let x = 0; x < 16; x++) {
      const grass = [0, 0, 0]
      const foliage = [0, 0, 0]
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          const tint = biomeTints(sampleBiome(x + dx, z + dz))
          for (let c = 0; c < 3; c++) {
            grass[c] += tint.grass[c]
            foliage[c] += tint.foliage[c]
          }
        }
      }
      const i = z * 16 + x
      grassTints[i] = grass.map((v) => Math.round(v / 9)) as [number, number, number]
      foliageTints[i] = foliage.map((v) => Math.round(v / 9)) as [number, number, number]
    }
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
      const baseDef = registry.lookup(id, meta)
      const isWater = baseDef.category === 'fluid' && baseDef.tint === 'water'
      const isTransparent = baseDef.category === 'transparent'
      const isGrass = baseDef.tint === 'grass'
      const isFoliage = baseDef.tint === 'foliage'
      const isBiome = (isGrass || isFoliage) && config.biomeTint
      const tintType = baseDef.tint ?? (isWater ? 'water' : 'none')
      // For water, the texture we draw is the SEABED's, washed blue by depth
      // below; for everything else it's the block's own resolved texture.
      const texKey = isWater
        ? floorId[i]
          ? (metaTextureKeys?.[`${floorId[i]}:${floorMeta[i]}`] ??
            textureKeys?.[floorId[i]] ??
            null)
          : null
        : (metaTextureKeys?.[`${id}:${meta}`] ?? textureKeys?.[id] ?? null)

      // ── Base color: biome tint or block color ──────────────────────
      let r: number, g: number, b: number
      let waterT = 0 // blue-wash alpha over the seabed texture (0 = deep water)
      if (baseUnknown[i]) {
        // Unmapped block with nothing renderable below it — a neutral grey
        // rather than a random hash. Debug still flags it (showFallbackMagenta).
        ;[r, g, b] = UNKNOWN_COLOR
      } else if (isGrass) {
        ;[r, g, b] = grassTints[i]
      } else if (isFoliage) {
        ;[r, g, b] = foliageTints[i]
      } else if (isWater) {
        // Translucent water: fill the seabed colour (so texture gaps match), draw
        // the seabed texture below, then wash it blue by depth (waterT) — shallow
        // shows the floor texture, deep reads as ocean.
        const fid = floorId[i]
        const depth = floorY[i] >= 0 ? blockY - floorY[i] : 0
        if (fid && depth > 0) {
          const fAvg = texKey ? averageTextureColor(texKey) : null
          const fc =
            fAvg ?? colorMap?.[fid] ?? hardcodedBlockColor(fid) ?? UNKNOWN_COLOR
          r = fc[0]
          g = fc[1]
          b = fc[2]
          waterT = waterBlend(depth)
        } else {
          r = WATER_DEEP[0]
          g = WATER_DEEP[1]
          b = WATER_DEEP[2]
        }
      } else if (
        baseDef.textureTint === 'metadata16' ||
        baseDef.textureTint === 'custom'
      ) {
        ;[r, g, b] = resolveMetadataTint(meta, baseDef.textureTintColors)
      } else {
        // Check meta-specific color first (wool, stained glass/clay, planks, logs)
        const metaColor = metaBlockColorRGB(id, meta)
        const texAvg = texKey ? averageTextureColor(texKey) : null
        if (metaColor) {
          r = metaColor[0]
          g = metaColor[1]
          b = metaColor[2]
        } else if (texAvg) {
          // The resolved texture's own average — correct per-metadata for
          // multi-species blocks (e.g. BOP leaves), where colorMap[id] is only
          // one meta's colour. It's also the fill behind cutout leaf gaps, so
          // leaves blend to their real species colour instead of a wrong per-id
          // colour showing through.
          r = texAvg[0]
          g = texAvg[1]
          b = texAvg[2]
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
      // Edge columns read the adjacent chunk's facing row (when loaded) so
      // shading and contours are seamless across chunk borders.
      const nY = z > 0 ? baseY[(z - 1) * 16 + x] : (neighbors?.n?.[x] ?? -1)
      const sY = z < 15 ? baseY[(z + 1) * 16 + x] : (neighbors?.s?.[x] ?? -1)
      const wY = x > 0 ? baseY[z * 16 + (x - 1)] : (neighbors?.w?.[z] ?? -1)
      const eY = x < 15 ? baseY[z * 16 + (x + 1)] : (neighbors?.e?.[z] ?? -1)

      // Color desaturation (Topo preset and any preset with colorSaturation < 1)
      const sat = config.colorSaturation
      if (sat < 1.0) {
        const lum = 0.299 * r + 0.587 * g + 0.114 * b
        r = Math.round(lum + (r - lum) * sat)
        g = Math.round(lum + (g - lum) * sat)
        b = Math.round(lum + (b - lum) * sat)
      }

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
        const uDef = registry.lookup(uId, uMeta)
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
        // Water: wash the seabed (fill + texture) toward deep-water blue by depth,
        // so shallow water shows the floor texture and deep water reads as ocean.
        if (isWater && waterT > 0) {
          ctx.fillStyle = `rgba(${WATER_DEEP[0]},${WATER_DEEP[1]},${WATER_DEEP[2]},${waterT})`
          ctx.fillRect(px, pz, CELL, CELL)
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
          const ovDef = registry.lookup(ovId, ovMeta)

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
      // Directional NW-light hillshade + AO — see computeHillshade.
      const elevMode = config.elevationMode
      if (elevMode !== 'off') {
        if (elevMode === 'debug-heightmap') {
          const [hr, hg, hb] = elevColor(blockY)
          ctx.fillStyle = `rgba(${hr},${hg},${hb},0.55)`
          ctx.fillRect(px, pz, CELL, CELL)
        } else {
          const { brightA, darkA } = computeHillshade(
            blockY,
            nY,
            sY,
            wY,
            eY,
            config
          )
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

  // ── Infrastructure View: draw the pipe/cable network on top of the terrain ──
  if (config.infraView) {
    drawPipeNetwork(
      ctx,
      pipeId,
      pipeMeta,
      neighborPipes,
      colorMap,
      textureKeys,
      metaTextureKeys
    )
  }

  return {
    canvas: offscreen,
    stats: { drawImage, fillRect, missingTexKey, failedTexLoad },
  }
}

// ── Infrastructure View network ──────────────────────────────────────────────
// Draw pipe/cable runs as a connected network: a centre node per pipe column plus
// an arm toward each orthogonally-adjacent pipe (within-chunk via the presence
// grid, across chunk borders via NeighborPipes). Top-down, so a vertical run
// collapses to a lone node. Three layered widths per cell — a dark casing, the
// pipe's own colour, then a bright core sheen — give a conduit look that reads
// against any terrain, with no seams between cells (each width drawn in its own
// pass over all cells).
const PIPE_BODY = 6 // px, pipe line / node width (CELL = 16)
const PIPE_CASING = 8 // px, dark outline (1 px each side of the body)
const PIPE_CORE = 2 // px, bright centre sheen

interface PipeConn {
  n: boolean
  s: boolean
  w: boolean
  e: boolean
}

function drawPipeShape(
  ctx: CanvasRenderingContext2D,
  x: number,
  z: number,
  wd: number,
  conn: PipeConn
): void {
  const px = x * CELL
  const pz = z * CELL
  const half = CELL / 2
  const off = (CELL - wd) / 2
  ctx.fillRect(px + off, pz + off, wd, wd) // centre node
  if (conn.n) ctx.fillRect(px + off, pz, wd, half) // arm to the cell edge
  if (conn.s) ctx.fillRect(px + off, pz + half, wd, half)
  if (conn.w) ctx.fillRect(px, pz + off, half, wd)
  if (conn.e) ctx.fillRect(px + half, pz + off, half, wd)
}

/** Blend a colour halfway to white — the network's centre sheen. */
function lightenColor(
  c: readonly [number, number, number]
): [number, number, number] {
  return [
    Math.round(c[0] + (255 - c[0]) * 0.5),
    Math.round(c[1] + (255 - c[1]) * 0.5),
    Math.round(c[2] + (255 - c[2]) * 0.5),
  ]
}

interface PipeCell {
  x: number
  z: number
  conn: PipeConn
  color: readonly [number, number, number]
}

function drawPipeNetwork(
  ctx: CanvasRenderingContext2D,
  pipeId: Uint16Array,
  pipeMeta: Uint8Array,
  neighbors: NeighborPipes | undefined,
  colorMap: BlockColorMap | undefined,
  textureKeys: Record<number, string> | undefined,
  metaTextureKeys: Record<string, string> | undefined
): void {
  // Draw over the finished terrain in a clean default state.
  ctx.globalAlpha = 1
  ctx.filter = 'none'
  ctx.globalCompositeOperation = 'source-over'

  const has = (x: number, z: number): boolean => {
    if (x < 0) return neighbors?.w?.[z] === 1
    if (x > 15) return neighbors?.e?.[z] === 1
    if (z < 0) return neighbors?.n?.[x] === 1
    if (z > 15) return neighbors?.s?.[x] === 1
    return pipeId[z * 16 + x] !== 0
  }

  // Collect pipe cells once, with their connections + resolved colour.
  const cells: PipeCell[] = []
  for (let z = 0; z < 16; z++) {
    for (let x = 0; x < 16; x++) {
      const i = z * 16 + x
      if (pipeId[i] === 0) continue
      cells.push({
        x,
        z,
        conn: {
          n: has(x, z - 1),
          s: has(x, z + 1),
          w: has(x - 1, z),
          e: has(x + 1, z),
        },
        color: resolvePipeColor(
          pipeId[i],
          pipeMeta[i],
          colorMap,
          textureKeys,
          metaTextureKeys
        ),
      })
    }
  }

  // Layer by width so cells never seam: casing → body → core.
  ctx.fillStyle = 'rgba(0,0,0,0.6)'
  for (const c of cells) drawPipeShape(ctx, c.x, c.z, PIPE_CASING, c.conn)
  for (const c of cells) {
    ctx.fillStyle = `rgb(${c.color[0]},${c.color[1]},${c.color[2]})`
    drawPipeShape(ctx, c.x, c.z, PIPE_BODY, c.conn)
  }
  for (const c of cells) {
    const [r, g, b] = lightenColor(c.color)
    ctx.fillStyle = `rgb(${r},${g},${b})`
    drawPipeShape(ctx, c.x, c.z, PIPE_CORE, c.conn)
  }
}

/** Resolve a pipe/cable's map colour: its texture average (best match to how the
 *  block looks), then scanned/meta/hardcoded colours, then the hash fallback. */
function resolvePipeColor(
  id: number,
  meta: number,
  colorMap: BlockColorMap | undefined,
  textureKeys: Record<number, string> | undefined,
  metaTextureKeys: Record<string, string> | undefined
): readonly [number, number, number] {
  const texKey = metaTextureKeys?.[`${id}:${meta}`] ?? textureKeys?.[id] ?? null
  const texAvg = texKey ? averageTextureColor(texKey) : null
  return (
    texAvg ??
    metaBlockColorRGB(id, meta) ??
    colorMap?.[id] ??
    hardcodedBlockColor(id) ??
    blockColorRGB(id, meta)
  )
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
