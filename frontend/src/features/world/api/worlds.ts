import { API_BASE } from '../../../shared/api'

export interface WorldValidateResponse {
  valid: boolean
  error: string | null
}

export async function validateWorld(
  path: string
): Promise<WorldValidateResponse> {
  const response = await fetch(`${API_BASE}/worlds/validate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  })
  if (!response.ok) {
    throw new Error(`World validation request failed (${response.status})`)
  }
  return response.json() as Promise<WorldValidateResponse>
}
