import { useQuery } from '@tanstack/react-query'

import { API_BASE, apiFetch } from '../../../shared/api'

export interface RegionSummary {
  region_x: number
  region_z: number
  file_name: string
}

export interface RegionListResponse {
  world_path: string
  region_count: number
  regions: RegionSummary[]
}

export interface ChunkSurface {
  chunk_x: number
  chunk_z: number
  ids: number[] // 256, top non-air block id per column (x + z*16); 0 = empty
  metas: number[] // 256
  heights: number[] // 256, absolute Y of the top block; -1 = empty
  biomes: number[] // 256, or empty when not stored
  floor_ids?: number[] // 256, seabed block under water (0 = none)
  water_depth?: number[] // 256, water depth over the seabed (0 = none)
}

export interface RegionSurface {
  region_x: number
  region_z: number
  chunks: ChunkSurface[]
}

/**
 * Fetch the compact per-column surface summary for one region (overview LOD).
 * *skipIds* are block ids (e.g. plants) treated as air so the overview reports
 * the ground beneath them instead of painting the plant.
 */
export async function fetchRegionSurface(
  worldPath: string,
  rx: number,
  rz: number,
  skipIds?: number[],
  /** Aborted on map-engine teardown — see fetchChunkBatch. */
  signal?: AbortSignal
): Promise<RegionSurface> {
  // POST (not GET) so the skip-id list travels in the body — it can be long, and
  // keeping it out of the URL keeps the backend access logs readable.
  const res = await fetch(`${API_BASE}/worlds/regions/${rx}/${rz}/surface`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ world_path: worldPath, skip_ids: skipIds ?? [] }),
    signal,
  })
  if (!res.ok)
    throw new Error(
      `Failed to load region surface r.${rx}.${rz}: ${res.statusText}`
    )
  return res.json() as Promise<RegionSurface>
}

async function fetchRegions(worldPath: string): Promise<RegionListResponse> {
  const res = await apiFetch(
    `${API_BASE}/worlds/regions?world_path=${encodeURIComponent(worldPath)}`
  )
  return res.json() as Promise<RegionListResponse>
}

export function useRegions(worldPath: string) {
  return useQuery({
    queryKey: ['regions', worldPath],
    queryFn: () => fetchRegions(worldPath),
    // Callers pass the *dimension* path and have none before one is picked.
    // Without this the app opens by asking the backend for the regions of '',
    // which can only ever fail — and now that the failure is on screen, it
    // would be a load error the user never caused.
    enabled: !!worldPath,
  })
}
