import { useQuery } from '@tanstack/react-query'

import { API_BASE } from '../lib/api'

export interface ChunkSection {
  y: number
  blocks: number[]
  data: number[]
}

export interface ChunkData {
  chunk_x: number
  chunk_z: number
  sections: ChunkSection[]
}

async function fetchChunkData(
  worldPath: string,
  cx: number,
  cz: number
): Promise<ChunkData> {
  const res = await fetch(
    `${API_BASE}/worlds/chunks/${cx}/${cz}?world_path=${encodeURIComponent(worldPath)}`
  )
  if (!res.ok)
    throw new Error(`Failed to load chunk (${cx}, ${cz}): ${res.statusText}`)
  return res.json() as Promise<ChunkData>
}

export function useChunkData(worldPath: string, cx: number, cz: number) {
  return useQuery({
    queryKey: ['chunk', worldPath, cx, cz],
    queryFn: () => fetchChunkData(worldPath, cx, cz),
  })
}
