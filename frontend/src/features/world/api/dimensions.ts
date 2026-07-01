import { useQuery } from '@tanstack/react-query'

import { API_BASE } from '../../../shared/api'

export interface DimensionInfo {
  id: string
  name: string
  path: string
  region_count: number
}

async function fetchDimensions(worldPath: string): Promise<DimensionInfo[]> {
  const res = await fetch(
    `${API_BASE}/worlds/dimensions?world_path=${encodeURIComponent(worldPath)}`
  )
  if (!res.ok) throw new Error(`Failed to load dimensions: ${res.statusText}`)
  return res.json() as Promise<DimensionInfo[]>
}

export function useDimensions(worldPath: string | null) {
  return useQuery({
    queryKey: ['dimensions', worldPath],
    queryFn: () => fetchDimensions(worldPath!),
    enabled: !!worldPath,
  })
}
