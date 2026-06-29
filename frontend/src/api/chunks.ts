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
  biomes: number[]  // 256 biome IDs indexed x + z*16; empty when not stored
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

/**
 * Fetch many chunks in a single request.  The backend groups the coords by
 * region so each region file is read once.  Absent/empty chunks are simply
 * omitted from the result — the caller diffs the requested coords against the
 * returned chunks to learn which came back empty.
 */
export async function fetchChunkBatch(
  worldPath: string,
  coords: [number, number][]
): Promise<ChunkData[]> {
  const res = await fetch(`${API_BASE}/worlds/chunks/batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ world_path: worldPath, coords }),
  })
  if (!res.ok) throw new Error(`Failed to load chunk batch: ${res.statusText}`)
  const json = (await res.json()) as { chunks: ChunkData[] }
  return json.chunks
}

export function useChunkData(worldPath: string, cx: number, cz: number) {
  return useQuery({
    queryKey: ['chunk', worldPath, cx, cz],
    queryFn: () => fetchChunkData(worldPath, cx, cz),
  })
}
