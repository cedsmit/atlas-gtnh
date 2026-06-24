import { useQuery } from '@tanstack/react-query'

import { API_BASE } from '../lib/api'

export type BlockColorMap = Record<number, [number, number, number]>

async function fetchBlockColors(worldPath: string): Promise<BlockColorMap> {
  const res = await fetch(
    `${API_BASE}/worlds/block-colors?world_path=${encodeURIComponent(worldPath)}`
  )
  if (!res.ok) throw new Error('Failed to load block colors')
  const raw = (await res.json()) as Record<string, [number, number, number]>
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => [Number(k), v]))
}

export function useBlockColors(worldPath: string | null) {
  return useQuery({
    queryKey: ['block-colors', worldPath],
    queryFn: () => fetchBlockColors(worldPath!),
    enabled: !!worldPath,
    staleTime: Infinity,
  })
}
