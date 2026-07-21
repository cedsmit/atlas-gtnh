/**
 * Per-texture average colour, computed lazily from loaded block textures.
 *
 * The zoomed-out region overview draws one flat colour per block instead of the
 * full texture. To match what the detailed chunk renderer shows (which draws the
 * texture, mip-collapsing toward its average as you zoom out), the overview uses
 * the texture's alpha-weighted average colour — resolved through the exact same
 * texture key the detailed renderer would use. Results are cached for the session.
 */

import { getTexture } from './textureLoader'

// undefined = not computed yet; null = computed but no usable colour (texture
// missing/not loaded is left uncached so it retries once the image arrives).
const _cache = new Map<string, readonly [number, number, number] | null>()

/**
 * Drop every cached average — call alongside clearTextures() on a world change.
 * These are derived from the cached images, so keeping them would outlive the
 * textures they were computed from.
 */
export function clearTextureAverages(): void {
  _cache.clear()
}

function computeAverage(
  img: HTMLImageElement
): readonly [number, number, number] | null {
  const w = img.naturalWidth || 16
  const h = img.naturalHeight || 16
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(img, 0, 0)

  let data: Uint8ClampedArray
  try {
    data = ctx.getImageData(0, 0, w, h).data
  } catch {
    return null // cross-origin taint (shouldn't happen for data-URL textures)
  }

  // Alpha-weighted mean so transparent pixels (frames, cut-outs) don't pull the
  // colour toward black — mirrors the opaque colour the texture visually reads as.
  let r = 0,
    g = 0,
    b = 0,
    a = 0
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3]
    r += data[i] * alpha
    g += data[i + 1] * alpha
    b += data[i + 2] * alpha
    a += alpha
  }
  if (a === 0) return null // fully transparent — no colour to show
  return [Math.round(r / a), Math.round(g / a), Math.round(b / a)]
}

/**
 * Average colour of the texture at *key*, or null if it isn't loaded yet (or has
 * no opaque pixels). Cached after the first successful computation.
 */
export function averageTextureColor(
  key: string
): readonly [number, number, number] | null {
  const cached = _cache.get(key)
  if (cached !== undefined) return cached
  const img = getTexture(key)
  if (!img) return null // not loaded — don't cache, retry when it arrives
  const avg = computeAverage(img)
  _cache.set(key, avg)
  return avg
}
