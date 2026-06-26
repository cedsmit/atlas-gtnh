import { useQuery } from '@tanstack/react-query'

import { API_BASE } from '../lib/api'

async function fetchMetaTextureKeys(worldPath: string): Promise<Record<string, string>> {
  const res = await fetch(
    `${API_BASE}/worlds/block-meta-texture-map?world_path=${encodeURIComponent(worldPath)}`
  )
  if (!res.ok) throw new Error('Failed to fetch block meta texture map')
  return res.json() as Promise<Record<string, string>>
}

export function useMetaTextureKeys(worldPath: string | null) {
  return useQuery({
    queryKey: ['blockMetaTextureKeys', worldPath],
    queryFn: () => fetchMetaTextureKeys(worldPath!),
    enabled: !!worldPath,
    staleTime: Infinity,
  })
}
