import { useQuery } from '@tanstack/react-query'

import { API_BASE } from '../../../shared/api'

export type BlockColorMap = Record<number, [number, number, number]>

async function fetchBlockColors(worldPath: string): Promise<BlockColorMap> {
  const res = await fetch(
    `${API_BASE}/worlds/block-colors?world_path=${encodeURIComponent(worldPath)}`
  )
  if (!res.ok) throw new Error(`Failed to fetch block colors (${res.status})`)
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
