import { useQuery } from '@tanstack/react-query'

import { API_BASE } from '../../../shared/api'
import type { DumpedBiomeColors } from '../blockColors'

async function fetchBiomeColors(worldPath: string): Promise<DumpedBiomeColors> {
  const res = await fetch(
    `${API_BASE}/worlds/biome-colors?world_path=${encodeURIComponent(worldPath)}`
  )
  if (!res.ok) throw new Error(`Failed to fetch biome colors (${res.status})`)
  const raw = (await res.json()) as Record<
    string,
    { grass: number[]; foliage: number[] }
  >
  const out: DumpedBiomeColors = {}
  for (const [k, v] of Object.entries(raw)) {
    out[Number(k)] = {
      grass: [v.grass[0], v.grass[1], v.grass[2]],
      foliage: [v.foliage[0], v.foliage[1], v.foliage[2]],
    }
  }
  return out
}

/**
 * Per-biome grass/foliage colours from the modpack's `biome_dump.json`
 * (served by the backend). Empty `{}` when no dump is present — the renderer
 * then uses its built-in temperature/rainfall table. Stable per world.
 */
export function useBiomeColors(worldPath: string | null) {
  return useQuery({
    queryKey: ['biome-colors', worldPath],
    queryFn: () => fetchBiomeColors(worldPath!),
    enabled: !!worldPath,
    staleTime: Infinity,
  })
}
