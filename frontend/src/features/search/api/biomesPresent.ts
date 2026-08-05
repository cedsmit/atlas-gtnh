import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'

import { API_BASE } from '../../../shared/api'
import {
  cancelSearchJob,
  type IndexProgress,
  newSearchJobId,
  readSearchProgress,
} from './searchProgress'

/** A biome that occurs in the dimension, with its area (columns) and chunk spread. */
export interface BiomePresence {
  biome_id: number
  columns: number
  chunks: number
}

async function fetchBiomesPresent(
  dimensionPath: string,
  jobId: string
): Promise<BiomePresence[]> {
  const res = await fetch(
    `${API_BASE}/worlds/biomes-present?world_path=${encodeURIComponent(dimensionPath)}&job_id=${encodeURIComponent(jobId)}`
  )
  if (!res.ok) throw new Error(`Failed to list biomes (${res.status})`)
  return (await res.json()) as BiomePresence[]
}

/**
 * The biomes actually present in a dimension (widest-area first). Backed by the
 * search index, so the first call for a world builds it (slow) and later ones are
 * instant. Lets the UI offer only the biomes in this world, not every one the pack
 * registers.
 */
export function useBiomesPresent(dimensionPath: string | null) {
  const [progress, setProgress] = useState<IndexProgress | null>(null)
  const jobRef = useRef<string | null>(null)
  const query = useQuery({
    queryKey: ['biomesPresent', dimensionPath],
    queryFn: async () => {
      const jobId = newSearchJobId()
      jobRef.current = jobId
      setProgress({ done: 0, total: 0, state: 'running' })
      const timer = window.setInterval(() => {
        void readSearchProgress(jobId)
          .then(setProgress)
          .catch(() => undefined)
      }, 250)
      try {
        return await fetchBiomesPresent(dimensionPath!, jobId)
      } finally {
        window.clearInterval(timer)
        jobRef.current = null
      }
    },
    enabled: !!dimensionPath,
  })
  useEffect(
    () => () => {
      if (jobRef.current) cancelSearchJob(jobRef.current)
    },
    []
  )
  return { ...query, progress }
}
