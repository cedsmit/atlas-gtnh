import { API_BASE } from '../../../shared/api'

export interface IndexProgress {
  done: number
  total: number
  state: string
}

export function newSearchJobId(): string {
  return crypto.randomUUID()
}

export async function readSearchProgress(
  jobId: string
): Promise<IndexProgress> {
  const res = await fetch(
    `${API_BASE}/worlds/search-index-progress?job_id=${encodeURIComponent(jobId)}`
  )
  if (!res.ok) throw new Error(`Progress failed (${res.status})`)
  return (await res.json()) as IndexProgress
}

export function cancelSearchJob(jobId: string): void {
  void fetch(
    `${API_BASE}/worlds/search-index-progress?job_id=${encodeURIComponent(jobId)}`,
    {
      method: 'DELETE',
    }
  )
}
