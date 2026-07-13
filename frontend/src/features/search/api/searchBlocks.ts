import { useMutation } from '@tanstack/react-query'

import { API_BASE } from '../../../shared/api'

/** A chunk containing one or more of the searched block ids. */
export interface SearchHit {
  cx: number
  cz: number
  count: number
  x: number
  y: number
  z: number
}

export interface SearchBlocksResponse {
  hits: SearchHit[]
  total_matches: number
  hit_chunks: number
  capped: boolean
  block_ids: number[]
}

/**
 * On-demand block search: given block ids, scan the dimension for matching chunks.
 * A mutation (not a query) since it runs when the user picks a block, not reactively.
 */
export function useSearchBlocks(dimensionPath: string) {
  return useMutation({
    mutationFn: async (ids: number[]): Promise<SearchBlocksResponse> => {
      const url =
        `${API_BASE}/worlds/search-blocks` +
        `?world_path=${encodeURIComponent(dimensionPath)}` +
        `&ids=${ids.join(',')}&limit=500`
      const res = await fetch(url)
      if (!res.ok) throw new Error(`Search failed (${res.status})`)
      return (await res.json()) as SearchBlocksResponse
    },
  })
}
