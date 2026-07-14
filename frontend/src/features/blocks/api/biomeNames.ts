import { useQuery } from '@tanstack/react-query'

import { API_BASE } from '../../../shared/api'

async function fetchBiomeNames(
  worldPath: string
): Promise<Record<number, string>> {
  const res = await fetch(
    `${API_BASE}/worlds/biome-names?world_path=${encodeURIComponent(worldPath)}`
  )
  if (!res.ok) throw new Error('Failed to fetch biome names')
  return res.json() as Promise<Record<number, string>>
}

/** biome id → display name, from the AtlasDumper biome dump. Empty when no dump. */
export function useBiomeNames(worldPath: string | null) {
  return useQuery({
    queryKey: ['biomeNames', worldPath],
    queryFn: () => fetchBiomeNames(worldPath!),
    enabled: !!worldPath,
  })
}
