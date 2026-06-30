import { useQuery } from '@tanstack/react-query'

import { API_BASE } from '../lib/api'

export interface ScanProgress {
  total: number
  scanned: number
  current: string
  done: boolean
}

const IDLE: ScanProgress = { total: 0, scanned: 0, current: '', done: true }

async function fetchScanProgress(worldPath: string): Promise<ScanProgress> {
  const res = await fetch(
    `${API_BASE}/worlds/scan-progress?world_path=${encodeURIComponent(worldPath)}`
  )
  if (!res.ok) return IDLE
  return (await res.json()) as ScanProgress
}

/**
 * Poll the backend's mod-JAR scan progress while `enabled` (i.e. during the
 * "Scanning Mods" loading stage). Polling stops automatically once disabled.
 */
export function useScanProgress(worldPath: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ['scan-progress', worldPath],
    queryFn: () => fetchScanProgress(worldPath!),
    enabled: !!worldPath && enabled,
    refetchInterval: enabled ? 250 : false,
    staleTime: 0,
    gcTime: 0,
  })
}
