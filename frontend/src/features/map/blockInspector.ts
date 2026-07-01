import type { BlockColorMap } from '../blocks/api/blockColors'
import type { ChunkData } from './api/chunks'
import { fetchChunkBatch } from './api/chunks'
import {
  biomeTints,
  blockColorRGB,
  resolveMetadataTint,
} from '../blocks/blockColors'
import type { BlockRenderRegistry } from '../blocks/blockRenderRegistry'
import type { RenderConfig } from '../blocks/renderPresets'
import { computeHillshade } from './chunkTileRenderer'
import { getTexture } from '../textures/textureLoader'

export interface BlockInspectorContext {
  event: MouseEvent
  el: HTMLElement
  inspector: HTMLDivElement
  w: number
  h: number
  cam: { cx: number; cz: number; scale: number }
  dataCache: Map<string, ChunkData>
  dimensionPath: string
  isDestroyed: () => boolean
  registry: BlockRenderRegistry
  config: RenderConfig
  blockColors: BlockColorMap | undefined
  blockNames: Record<number, string> | undefined
  textureKeys: Record<number, string> | undefined
  metaTextureKeys: Record<string, string> | undefined
}

// Right-click handler: resolve the block under the cursor and render its details
// (id, meta, biome, slope, texture/colour resolution) into the inspector popup.
export async function showBlockInspector(
  ctx: BlockInspectorContext
): Promise<void> {
  const {
    event: e,
    el,
    inspector,
    w: W,
    h: H,
    cam,
    dataCache,
    dimensionPath,
    isDestroyed,
    registry,
    config,
    blockColors,
    blockNames,
    textureKeys,
    metaTextureKeys,
  } = ctx
  e.preventDefault()
  const rect = el.getBoundingClientRect()
  const mx = e.clientX - rect.left,
    my = e.clientY - rect.top
  const worldX = Math.floor(cam.cx + (mx - W / 2) / cam.scale)
  const worldZ = Math.floor(cam.cz + (my - H / 2) / cam.scale)
  const cx = Math.floor(worldX / 16),
    cz = Math.floor(worldZ / 16)
  const lx = ((worldX % 16) + 16) % 16,
    lz = ((worldZ % 16) + 16) % 16
  const key = `${cx},${cz}`
  let data = dataCache.get(key)
  if (!data) {
    // The tile may be rendered from the CPU cache, which keeps the image but
    // not the block data — fetch it on demand so inspection still works.
    inspector.textContent = `X ${worldX}  Z ${worldZ} — loading…`
    inspector.style.display = 'block'
    try {
      const fetched = await fetchChunkBatch(dimensionPath, [[cx, cz]])
      if (isDestroyed()) return // effect torn down while fetching — bail
      if (fetched[0]) {
        dataCache.set(key, fetched[0])
        data = fetched[0]
      }
    } catch {
      /* leave data undefined */
    }
    if (!data) {
      inspector.textContent = `X ${worldX}  Z ${worldZ} — chunk not loaded`
      inspector.style.display = 'block'
      return
    }
  }
  const secs = [...data.sections].sort((a, bv) => bv.y - a.y)

  // Top block: first non-ignore (may be overlay)
  let topId = 0,
    topMeta = 0,
    topYv = -1
  topScan: for (const sec of secs) {
    for (let y = 15; y >= 0; y--) {
      const idx = (y << 8) | (lz << 4) | lx
      const id = sec.blocks[idx]
      if (id !== 0 && registry.lookup(id).category !== 'ignore') {
        topId = id
        topMeta = sec.data[idx]
        topYv = sec.y * 16 + y
        break topScan
      }
    }
  }

  // Terrain block: first non-ignore, non-overlay (the surface height)
  let terrainYv = -1
  terrainScan: for (const sec of secs) {
    for (let y = 15; y >= 0; y--) {
      const idx = (y << 8) | (lz << 4) | lx
      const id = sec.blocks[idx]
      if (id === 0) continue
      const cat = registry.lookup(id).category
      if (cat !== 'ignore' && cat !== 'overlay') {
        terrainYv = sec.y * 16 + y
        break terrainScan
      }
    }
  }

  // ── Shading diagnostic — replicates the renderer's hillshade exactly ──
  // Same column rule as the renderer's base scan (ignore/overlay skipped,
  // foliage-hidden respected), and neighbors cross chunk borders through the
  // data cache, exactly like renderChunkImage's NeighborHeights.
  function terrainYIn(chunk: ChunkData, nx: number, nz: number): number {
    const csecs = [...chunk.sections].sort((a, bv) => bv.y - a.y)
    for (const sec of csecs) {
      for (let y = 15; y >= 0; y--) {
        const idx = (y << 8) | (nz << 4) | nx
        const id = sec.blocks[idx]
        if (id === 0) continue
        const def = registry.lookup(id)
        if (def.category === 'ignore' || def.category === 'overlay') continue
        if (config.foliageMode === 'hidden' && def.tint === 'foliage') continue
        return sec.y * 16 + y
      }
    }
    return -1
  }
  // Neighbor column height; steps into the adjacent chunk when off-edge.
  function neighborY(dx: number, dz: number): number {
    let nx = lx + dx,
      nz = lz + dz,
      ncx = cx,
      ncz = cz
    if (nx < 0) {
      nx = 15
      ncx--
    } else if (nx > 15) {
      nx = 0
      ncx++
    }
    if (nz < 0) {
      nz = 15
      ncz--
    } else if (nz > 15) {
      nz = 0
      ncz++
    }
    const chunk =
      ncx === cx && ncz === cz ? data! : dataCache.get(`${ncx},${ncz}`)
    return chunk ? terrainYIn(chunk, nx, nz) : -1
  }
  const inY = data ? terrainYIn(data, lx, lz) : -1
  const nY = neighborY(0, -1)
  const sY = neighborY(0, 1)
  const wY = neighborY(-1, 0)
  const eY = neighborY(1, 0)

  // Exactly what the renderer applied — shared implementation.
  const elevMode = config.elevationMode
  const { brightA, darkA } = computeHillshade(inY, nY, sY, wY, eY, config)

  const fmtY = (v: number) =>
    v >= 0 ? `${v - inY >= 0 ? '+' : ''}${v - inY}` : '?'
  const nbrStr = `N${fmtY(nY)} S${fmtY(sY)} W${fmtY(wY)} E${fmtY(eY)}`
  const slopeStr =
    elevMode === 'off'
      ? 'shading off'
      : brightA < 0.01 && darkA < 0.01
        ? `flat  [${nbrStr}]`
        : `${brightA >= 0.01 ? `lit +${Math.round(brightA * 100)}%` : ''}${
            brightA >= 0.01 && darkA >= 0.01 ? ' ' : ''
          }${darkA >= 0.01 ? `shadow -${Math.round(darkA * 100)}%` : ''}  [${nbrStr}]`

  const biomeId = data.biomes.length === 256 ? data.biomes[lx + lz * 16] : -1
  const topDef = registry.lookup(topId)
  const texKey =
    topDef.textureAlias ??
    metaTextureKeys?.[`${topId}:${topMeta}`] ??
    textureKeys?.[topId] ??
    null
  const texImg = texKey ? getTexture(texKey) : null
  const hasTexture = !!texImg
  const name = blockNames?.[topId] ?? `block:${topId}`

  let raw: readonly [number, number, number]
  let colorSrc: string
  if (topDef.tint === 'grass') {
    raw = biomeTints(biomeId >= 0 ? biomeId : 1).grass
    colorSrc = hasTexture ? 'texture + grass tint' : 'biome grass'
  } else if (topDef.tint === 'foliage') {
    raw = biomeTints(biomeId >= 0 ? biomeId : 1).foliage
    colorSrc = hasTexture ? 'texture + foliage tint' : 'biome foliage'
  } else if (
    topDef.textureTint === 'metadata16' ||
    topDef.textureTint === 'custom'
  ) {
    raw = resolveMetadataTint(topMeta, topDef.textureTintColors)
    colorSrc = hasTexture ? 'texture + meta tint' : 'meta tint'
  } else {
    const mapped = blockColors?.[topId]
    raw = mapped ?? blockColorRGB(topId, topMeta)
    colorSrc = hasTexture ? 'texture' : mapped ? 'color' : 'fallback'
  }

  const hex =
    '#' +
    Array.from(raw)
      .map((v) => v.toString(16).padStart(2, '0'))
      .join('')
  const texStatus = hasTexture
    ? '✓ loaded'
    : texKey
      ? '⏳ loading…'
      : '✗ no mapping'
  const renderInfo =
    topDef.category +
    (topDef.tint ? ` · tint:${topDef.tint}` : '') +
    (topDef.textureTint && topDef.textureTint !== 'none'
      ? ` · tex-tint:${topDef.textureTint}${topDef.textureTintColors ? ' custom' : ''}`
      : '') +
    (topDef.alphaMode && topDef.alphaMode !== 'opaque'
      ? ` · alpha:${topDef.alphaMode}`
      : '') +
    ` · src:${topDef.resolverSource}`
  const yLine =
    terrainYv >= 0 && terrainYv !== topYv
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
  const copyBtn =
    inspector.querySelector<HTMLButtonElement>('#atlas-copy-block')
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
      setTimeout(() => {
        copyBtn.textContent = 'copy'
      }, 1500)
    })
  }
  inspector.style.display = 'block'
  inspector.style.left = `${e.clientX - rect.left + 8}px`
  inspector.style.top = `${e.clientY - rect.top + 8}px`
}
