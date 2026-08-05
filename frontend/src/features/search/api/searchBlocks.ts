import { useMutation } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'

import { API_BASE } from '../../../shared/api'
import {
  cancelSearchJob,
  type IndexProgress,
  newSearchJobId,
  readSearchProgress,
} from './searchProgress'

/** A chunk containing one or more of the searched block ids. */
export interface SearchHit {
  cx: number
  cz: number
  count: number
  x: number
  y: number
  z: number
}

export interface SearchBlocksResponse {
  hits: SearchHit[]
  total_matches: number
  hit_chunks: number
  capped: boolean
  block_ids: number[]
}

/**
 * On-demand block search: given block ids, scan the dimension for matching chunks.
 * A mutation (not a query) since it runs when the user picks a block, not reactively.
 */
export function useSearchBlocks(dimensionPath: string) {
  const [progress, setProgress] = useState<IndexProgress | null>(null)
  const jobRef = useRef<string | null>(null)
  const mutation = useMutation({
    mutationFn: async (ids: number[]): Promise<SearchBlocksResponse> => {
      const jobId = newSearchJobId()
      jobRef.current = jobId
      setProgress({ done: 0, total: 0, state: 'running' })
      const timer = window.setInterval(() => {
        void readSearchProgress(jobId)
          .then(setProgress)
          .catch(() => undefined)
      }, 250)
      const url =
        `${API_BASE}/worlds/search-blocks` +
        `?world_path=${encodeURIComponent(dimensionPath)}` +
        `&ids=${ids.join(',')}&limit=500&job_id=${encodeURIComponent(jobId)}`
      try {
        const res = await fetch(url)
        if (!res.ok) throw new Error(`Search failed (${res.status})`)
        return (await res.json()) as SearchBlocksResponse
      } finally {
        window.clearInterval(timer)
        jobRef.current = null
      }
    },
  })
  useEffect(
    () => () => {
      if (jobRef.current) cancelSearchJob(jobRef.current)
    },
    []
  )
  return { ...mutation, progress }
}
