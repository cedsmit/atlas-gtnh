import { useQuery } from '@tanstack/react-query'

import { API_BASE } from '../../../shared/api'

/** A GregTech ore vein cached by Visual Prospecting. */
export interface OreVein {
  x: number
  z: number
  cx: number
  cz: number
  kind: string // VP palette name, e.g. "ore.mix.gold"
  depleted: boolean
  // Enriched server-side from the bundled ore-vein registry; absent for an
  // unknown/modded vein or when no dump is available (frontend falls back).
  name?: string | null // GTNH display name, e.g. "Magnetite & Gold"
  rgb?: number | null // representative material colour, 0xRRGGBB
  texture?: string | null // ore-texture key (best-effort; usually null)
}

export interface OreVeinsResponse {
  available: boolean // false = this world has no Visual Prospecting data
  veins: OreVein[]
  // Deduped ore-overlay PNGs (base64), keyed by icon name — a vein's `texture` is
  // a key here. Tint by the vein `rgb` to render. Absent/empty on an old dump
  // (frontend falls back to a flat colour dot).
  sprites?: Record<string, string>
  // Sprite keys that are pre-coloured (drawn as-is, no rgb tint) — e.g. gold/iron,
  // whose art lives in the overlay layer rather than a tintable grayscale base.
  sprites_precolored?: string[]
}

async function fetchOreVeins(dimensionPath: string): Promise<OreVeinsResponse> {
  const res = await fetch(
    `${API_BASE}/worlds/ore-veins?world_path=${encodeURIComponent(dimensionPath)}`
  )
  if (!res.ok) throw new Error(`Failed to load ore veins (${res.status})`)
  return (await res.json()) as OreVeinsResponse
}

/**
 * Ore veins Visual Prospecting has cached for this dimension. Enabled lazily so
 * the (cheap) read only runs once the overlay is turned on for a dimension.
 */
export function useOreVeins(dimensionPath: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ['oreVeins', dimensionPath],
    queryFn: () => fetchOreVeins(dimensionPath!),
    enabled: !!dimensionPath && enabled,
  })
}
