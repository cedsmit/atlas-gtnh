import { useQuery } from '@tanstack/react-query'

import { API_BASE } from '../../../shared/api'

/** A biome that occurs in the dimension, with its area (columns) and chunk spread. */
export interface BiomePresence {
  biome_id: number
  columns: number
  chunks: number
}

async function fetchBiomesPresent(
  dimensionPath: string
): Promise<BiomePresence[]> {
  const res = await fetch(
    `${API_BASE}/worlds/biomes-present?world_path=${encodeURIComponent(dimensionPath)}`
  )
  if (!res.ok) throw new Error(`Failed to list biomes (${res.status})`)
  return (await res.json()) as BiomePresence[]
}

/**
 * The biomes actually present in a dimension (widest-area first). Backed by the
 * search index, so the first call for a world builds it (slow) and later ones are
 * instant. Lets the UI offer only the biomes in this world, not every one the pack
 * registers.
 */
export function useBiomesPresent(dimensionPath: string | null) {
  return useQuery({
    queryKey: ['biomesPresent', dimensionPath],
    queryFn: () => fetchBiomesPresent(dimensionPath!),
    enabled: !!dimensionPath,
  })
}
