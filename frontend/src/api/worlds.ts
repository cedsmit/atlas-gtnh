import { API_BASE } from '../lib/api'

export interface WorldValidateResponse {
  valid: boolean
  error: string | null
}

export async function validateWorld(path: string): Promise<WorldValidateResponse> {
  const response = await fetch(`${API_BASE}/worlds/validate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  })
  return response.json() as Promise<WorldValidateResponse>
}
