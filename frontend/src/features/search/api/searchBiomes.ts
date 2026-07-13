import { useMutation } from '@tanstack/react-query'

import { API_BASE } from '../../../shared/api'
import type { SearchBlocksResponse } from './searchBlocks'

/**
 * On-demand biome search: given biome ids, find the chunks where they occur.
 * Mirrors {@link useSearchBlocks} and reuses its response shape — biome hits carry
 * `x, z` (first matching column) and `count` (matching columns in the chunk).
 */
export function useSearchBiomes(dimensionPath: string) {
  return useMutation({
    mutationFn: async (ids: number[]): Promise<SearchBlocksResponse> => {
      const url =
        `${API_BASE}/worlds/search-biomes` +
        `?world_path=${encodeURIComponent(dimensionPath)}` +
        `&ids=${ids.join(',')}&limit=500`
      const res = await fetch(url)
      if (!res.ok) throw new Error(`Biome search failed (${res.status})`)
      return (await res.json()) as SearchBlocksResponse
    },
  })
}
