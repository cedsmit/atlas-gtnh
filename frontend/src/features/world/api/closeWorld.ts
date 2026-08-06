import { API_BASE, apiFetch } from '../../../shared/api'

/** Best-effort backend cache eviction when leaving a world. */
export async function closeWorld(worldPath: string): Promise<void> {
  await apiFetch(
    `${API_BASE}/worlds/close?world_path=${encodeURIComponent(worldPath)}`,
    { method: 'DELETE' }
  )
}
