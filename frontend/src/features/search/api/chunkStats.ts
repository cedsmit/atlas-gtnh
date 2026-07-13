import { useMutation } from '@tanstack/react-query'

import { API_BASE } from '../../../shared/api'

export interface ChunkStatsResponse {
  metric: string
  cells: { cx: number; cz: number; v: number }[]
  vmin: number
  vmax: number
}

export interface ChunkStatsQuery {
  metric: 'variety' | 'density'
  ids?: number[] // required for 'density'
}

/**
 * Per-chunk stats for the heatmap overlay (Stage 5 prototype). On-demand mutation;
 * the first call builds the search index, later ones are instant.
 */
export function useChunkStats(dimensionPath: string) {
  return useMutation({
    mutationFn: async (q: ChunkStatsQuery): Promise<ChunkStatsResponse> => {
      const url =
        `${API_BASE}/worlds/chunk-stats` +
        `?world_path=${encodeURIComponent(dimensionPath)}&metric=${q.metric}` +
        (q.ids?.length ? `&ids=${q.ids.join(',')}` : '')
      const res = await fetch(url)
      if (!res.ok) throw new Error(`Chunk stats failed (${res.status})`)
      return (await res.json()) as ChunkStatsResponse
    },
  })
}
