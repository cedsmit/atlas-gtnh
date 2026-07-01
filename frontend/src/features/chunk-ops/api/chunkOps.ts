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

/** Copy chunks to another dimension, shifted by [dx, dz] chunks (default same coords). */
export function copyChunks(
  srcWorld: string,
  dstWorld: string,
  chunks: [number, number][],
  offset: [number, number] = [0, 0],
): Promise<ChunkOpResult> {
  return post('/worlds/chunks/copy', {
    src_world: srcWorld,
    dst_world: dstWorld,
    chunks,
    offset,
  })
}

/** Create a new world seeded from the source's level.dat and paste the chunks in. */
export function createWorld(
  srcWorld: string,
  newWorldPath: string,
  chunks: [number, number][],
  offset: [number, number] = [0, 0],
): Promise<ChunkOpResult> {
  return post('/worlds/chunks/create-world', {
    src_world: srcWorld,
    new_world_path: newWorldPath,
    chunks,
    offset,
  })
}
