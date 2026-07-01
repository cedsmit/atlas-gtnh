import { useQuery } from '@tanstack/react-query'

import { API_BASE } from '../../../shared/api'

async function fetchTextureKeys(worldPath: string): Promise<Record<number, string>> {
  const res = await fetch(
    `${API_BASE}/worlds/block-texture-map?world_path=${encodeURIComponent(worldPath)}`
  )
  if (!res.ok) throw new Error('Failed to fetch block texture map')
  return res.json() as Promise<Record<number, string>>
}

export function useTextureKeys(worldPath: string | null) {
  return useQuery({
    queryKey: ['blockTextureKeys', worldPath],
    queryFn: () => fetchTextureKeys(worldPath!),
    enabled: !!worldPath,
    staleTime: Infinity,
  })
}
