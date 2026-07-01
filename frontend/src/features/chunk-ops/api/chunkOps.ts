import { API_BASE } from '../../../shared/api'

export interface ChunkOpResult {
  deleted?: number
  copied?: number
  kept?: number
  missing?: number
  regions: string[]
}

async function post(path: string, body: unknown): Promise<ChunkOpResult> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const detail = await res
      .json()
      .then((d: { detail?: string }) => d.detail)
      .catch(() => undefined)
    throw new Error(detail ?? `Request failed (${res.status})`)
  }
  return res.json() as Promise<ChunkOpResult>
}

/** Delete chunks so Minecraft regenerates them on next load. worldPath is a dimension path. */
export function deleteChunks(worldPath: string, chunks: [number, number][]): Promise<ChunkOpResult> {
  return post('/worlds/chunks/delete', { world_path: worldPath, chunks })
}

/** Delete every generated chunk EXCEPT the given ones (inverse selection). */
export function deleteChunksExcept(
  worldPath: string,
  keep: [number, number][],
): Promise<ChunkOpResult> {
  return post('/worlds/chunks/delete-except', { world_path: worldPath, keep })
}

/** Copy chunks from one dimension to another at the same coordinates. */
export function copyChunks(
  srcWorld: string,
  dstWorld: string,
  chunks: [number, number][],
): Promise<ChunkOpResult> {
  return post('/worlds/chunks/copy', { src_world: srcWorld, dst_world: dstWorld, chunks })
}
