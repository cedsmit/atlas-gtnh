import { useQuery } from '@tanstack/react-query'

import { API_BASE } from '../lib/api'

export interface MissingMod {
  mod_id: string
  world_version: string
  block_count: number
}

export interface VersionMismatch {
  mod_id: string
  world_version: string
  dump_version: string
}

export interface MissingBlock {
  registry_name: string
  block_id: number
  domain: string
  mod_in_dump: boolean
  /** Mod present in the dump but this specific block absent (registration drift). */
  drift: boolean
}

export interface DumpMismatch {
  dump_loaded: boolean
  has_mismatch?: boolean
  severity?: 'ok' | 'info' | 'warn' | 'error'
  world_mod_count?: number
  dump_mod_count?: number
  count_differs?: boolean
  missing_with_blocks?: number
  missing_from_dump?: MissingMod[]
  version_mismatches?: VersionMismatch[]
  /** Total world block registry names absent from the dump. */
  missing_block_total?: number
  /** Of those, how many belong to a mod that *is* present in the dump (drift). */
  drift_block_count?: number
  missing_blocks?: MissingBlock[]
}

async function fetchDumpMismatch(worldPath: string): Promise<DumpMismatch> {
  const res = await fetch(
    `${API_BASE}/worlds/dump-mismatch?world_path=${encodeURIComponent(worldPath)}`
  )
  if (!res.ok) throw new Error('Failed to fetch dump mismatch')
  return res.json() as Promise<DumpMismatch>
}

export function useDumpMismatch(worldPath: string | null) {
  return useQuery({
    queryKey: ['dumpMismatch', worldPath],
    queryFn: () => fetchDumpMismatch(worldPath!),
    enabled: !!worldPath,
    staleTime: Infinity,
  })
}

/**
 * Generate and download the missing-block diagnostic report. `snapshot` carries
 * the client's on-map data (columns rendered + metadata seen per block id).
 */
export async function downloadMissingBlockReport(
  worldPath: string,
  format: 'json' | 'csv',
  snapshot: { occurrences: Record<number, number>; metas: Record<number, number[]> }
): Promise<void> {
  const res = await fetch(
    `${API_BASE}/worlds/missing-block-report?world_path=${encodeURIComponent(worldPath)}&format=${format}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(snapshot),
    }
  )
  if (!res.ok) throw new Error('Failed to generate missing-block report')
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = format === 'csv' ? 'missing-blocks.csv' : 'missing-blocks.json'
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
