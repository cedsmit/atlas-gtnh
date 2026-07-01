import type { BlockColorMap } from '../blocks/api/blockColors'
import type { ChunkData } from './api/chunks'
import { fetchChunkBatch } from './api/chunks'
import { biomeTints, blockColorRGB, resolveMetadataTint } from '../blocks/blockColors'
import type { BlockRenderRegistry } from '../blocks/blockRenderRegistry'
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
  blockColors: BlockColorMap | undefined
  blockNames: Record<number, string> | undefined
  textureKeys: Record<number, string> | undefined
  metaTextureKeys: Record<string, string> | undefined
}

// Right-click handler: resolve the block under the cursor and render its details
// (id, meta, biome, slope, texture/colour resolution) into the inspector popup.
export async function showBlockInspector(ctx: BlockInspectorContext): Promise<void> {
  const {
    event: e, el, inspector, w: W, h: H, cam, dataCache, dimensionPath,
    isDestroyed, registry, blockColors, blockNames, textureKeys, metaTextureKeys,
  } = ctx
  e.preventDefault()
  const rect  = el.getBoundingClientRect()
  const mx    = e.clientX - rect.left, my = e.clientY - rect.top
  const worldX = Math.floor(cam.cx + (mx - W/2) / cam.scale)
  const worldZ = Math.floor(cam.cz + (my - H/2) / cam.scale)
  const cx    = Math.floor(worldX / 16), cz = Math.floor(worldZ / 16)
  const lx    = ((worldX % 16) + 16) % 16, lz = ((worldZ % 16) + 16) % 16
  const key   = `${cx},${cz}`
  let   data  = dataCache.get(key)
  if (!data) {
    // The tile may be rendered from the CPU cache, which keeps the image but
    // not the block data — fetch it on demand so inspection still works.
    inspector.textContent = `X ${worldX}  Z ${worldZ} — loading…`
    inspector.style.display = 'block'
    try {
      const fetched = await fetchChunkBatch(dimensionPath, [[cx, cz]])
      if (isDestroyed()) return  // effect torn down while fetching — bail
      if (fetched[0]) { dataCache.set(key, fetched[0]); data = fetched[0] }
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
      if (id !== 0 && registry.lookup(id).category !== 'ignore') {
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
      const cat = registry.lookup(id).category
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
        const cat = registry.lookup(id).category
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
  const topDef     = registry.lookup(topId)
  const texKey     = topDef.textureAlias
    ?? metaTextureKeys?.[`${topId}:${topMeta}`]
    ?? textureKeys?.[topId]
    ?? null
  const texImg     = texKey ? getTexture(texKey) : null
  const hasTexture = !!texImg
  const name       = blockNames?.[topId] ?? `block:${topId}`

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
    const mapped = blockColors?.[topId]
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
