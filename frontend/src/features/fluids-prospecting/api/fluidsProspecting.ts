import { useQuery } from '@tanstack/react-query'

import { API_BASE } from '../../../shared/api'

export interface FluidsProspectingField {
  x: number
  z: number
  chunk_x: number
  chunk_z: number
  fluid: string
  yields: number[]
  min_yield: number
  max_yield: number
  empty: boolean
  source: 'predicted' | 'prospected'
}

export interface FluidsProspectingResponse {
  available: boolean
  prediction_available: boolean
  prospected_count: number
  predicted_count: number
  fields: FluidsProspectingField[]
}

async function fetchFluidsProspecting(
  dimensionPath: string
): Promise<FluidsProspectingResponse> {
  const response = await fetch(
    `${API_BASE}/worlds/fluids-prospecting?world_path=${encodeURIComponent(dimensionPath)}`
  )
  if (!response.ok)
    throw new Error(
      `Failed to load fluids prospecting data (${response.status})`
    )
  return (await response.json()) as FluidsProspectingResponse
}

export function useFluidsProspecting(
  dimensionPath: string | null,
  enabled: boolean
) {
  return useQuery({
    // Keep the source mode in the key: older dev sessions may still hold the
    // cache-only response that existed before pristine prediction was added.
    queryKey: ['fluidsProspecting', 'predicted-and-prospected', dimensionPath],
    queryFn: () => fetchFluidsProspecting(dimensionPath!),
    enabled: !!dimensionPath && enabled,
  })
}
