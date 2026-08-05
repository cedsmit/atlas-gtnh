import { useQuery } from '@tanstack/react-query'

import { API_BASE } from '../../../shared/api'

export interface BedrockFluidField {
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

export interface BedrockFluidsResponse {
  available: boolean
  prediction_available: boolean
  prospected_count: number
  predicted_count: number
  fields: BedrockFluidField[]
}

async function fetchBedrockFluids(
  dimensionPath: string
): Promise<BedrockFluidsResponse> {
  const response = await fetch(
    `${API_BASE}/worlds/bedrock-fluids?world_path=${encodeURIComponent(dimensionPath)}`
  )
  if (!response.ok)
    throw new Error(`Failed to load bedrock fluids (${response.status})`)
  return (await response.json()) as BedrockFluidsResponse
}

export function useBedrockFluids(
  dimensionPath: string | null,
  enabled: boolean
) {
  return useQuery({
    // Keep the source mode in the key: older dev sessions may still hold the
    // cache-only response that existed before pristine prediction was added.
    queryKey: ['bedrockFluids', 'predicted-and-prospected', dimensionPath],
    queryFn: () => fetchBedrockFluids(dimensionPath!),
    enabled: !!dimensionPath && enabled,
  })
}
