import { useQuery } from '@tanstack/react-query'

import { API_BASE } from '../../../shared/api'

async function fetchBlockNames(
  worldPath: string
): Promise<Record<number, string>> {
  const res = await fetch(
    `${API_BASE}/worlds/block-names?world_path=${encodeURIComponent(worldPath)}`
  )
  if (!res.ok) throw new Error('Failed to fetch block names')
  return res.json() as Promise<Record<number, string>>
}

export function useBlockNames(worldPath: string | null) {
  return useQuery({
    queryKey: ['blockNames', worldPath],
    queryFn: () => fetchBlockNames(worldPath!),
    enabled: !!worldPath,
  })
}
