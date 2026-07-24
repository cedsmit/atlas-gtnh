import { useQuery } from '@tanstack/react-query'

import { API_BASE, apiFetch } from '../../../shared/api'

export type BlockColorMap = Record<number, [number, number, number]>

// The load gate treats this query as the verdict on the whole world, so it goes
// through apiFetch: App has to tell a world it cannot open from a backend it
// cannot reach, and only one of those is the world's fault.
async function fetchBlockColors(worldPath: string): Promise<BlockColorMap> {
  const res = await apiFetch(
    `${API_BASE}/worlds/block-colors?world_path=${encodeURIComponent(worldPath)}`
  )
  const raw = (await res.json()) as Record<string, [number, number, number]>
  const colors: BlockColorMap = {}
  for (const [k, v] of Object.entries(raw)) colors[Number(k)] = v
  return colors
}

export function useBlockColors(worldPath: string | null) {
  return useQuery({
    queryKey: ['block-colors', worldPath],
    queryFn: () => fetchBlockColors(worldPath!),
    enabled: !!worldPath,
    staleTime: Infinity,
  })
}
