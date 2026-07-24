import { useQuery } from '@tanstack/react-query'

import { API_BASE } from '../../../shared/api'

export interface ChunkSection {
  y: number
  /** 4096 block ids, YZX-indexed — a view straight onto the response buffer. */
  blocks: Uint16Array
  /** 4096 metadata values (nibbles, or 16-bit on Data16 worlds). */
  data: Uint16Array
}

export interface ChunkData {
  chunk_x: number
  chunk_z: number
  sections: ChunkSection[]
  biomes: number[] // 256 biome IDs indexed x + z*16; empty when not stored
}

async function fetchChunkData(
  worldPath: string,
  cx: number,
  cz: number
): Promise<ChunkData> {
  const res = await fetch(
    `${API_BASE}/worlds/chunks/${cx}/${cz}?world_path=${encodeURIComponent(worldPath)}`
  )
  if (!res.ok)
    throw new Error(`Failed to load chunk (${cx}, ${cz}): ${res.statusText}`)
  // This one endpoint is still JSON — it serves a single chunk to the
  // inspector, where the arrays are small and the convenience is worth it.
  const raw = (await res.json()) as {
    chunk_x: number
    chunk_z: number
    biomes: number[]
    sections: { y: number; blocks: number[]; data: number[] }[]
  }
  return {
    ...raw,
    sections: raw.sections.map((s) => ({
      y: s.y,
      blocks: Uint16Array.from(s.blocks),
      data: Uint16Array.from(s.data),
    })),
  }
}

const MAGIC = 0x314c5441 // "ATL1" read as a little-endian uint32
const SECTION_VALUES = 4096
const BIOME_VALUES = 256

/**
 * Read the binary batch format written by `backend/app/world/section_codec.py`.
 *
 * The section arrays are handed out as views onto the response buffer, not
 * copies: nothing is parsed, allocated or converted per block id. A batch used
 * to arrive as ~25 MB of JSON whose `JSON.parse` ran on the main thread — the
 * same thread as the frame loop the chunks were being fetched for.
 *
 * Anything malformed throws rather than returning a half-read batch: a
 * truncated buffer here means a chunk of the world silently missing on screen.
 */
export function decodeChunkBatch(buf: ArrayBuffer): ChunkData[] {
  const view = new DataView(buf)
  if (buf.byteLength < 8 || view.getUint32(0, true) !== MAGIC)
    throw new Error('Chunk batch response is not in the expected format')

  const headerLength = view.getUint32(4, true)
  const headerEnd = 8 + headerLength
  if (headerEnd > buf.byteLength)
    throw new Error('Chunk batch header truncated')
  const header = JSON.parse(
    new TextDecoder().decode(new Uint8Array(buf, 8, headerLength))
  ) as { chunks: { x: number; z: number; biomes: boolean; ys: number[] }[] }

  let pos = headerEnd
  const take = (count: number): Uint16Array => {
    const end = pos + count * 2
    if (end > buf.byteLength) throw new Error('Chunk batch payload truncated')
    const arr = new Uint16Array(buf, pos, count)
    pos = end
    return arr
  }

  return header.chunks.map((meta) => ({
    chunk_x: meta.x,
    chunk_z: meta.z,
    // Biomes stay a plain array: they are read one column at a time by code
    // that treats them as numbers, and 256 of them is nothing.
    biomes: meta.biomes ? Array.from(take(BIOME_VALUES)) : [],
    sections: meta.ys.map((y) => ({
      y,
      blocks: take(SECTION_VALUES),
      data: take(SECTION_VALUES),
    })),
  }))
}

/**
 * Fetch many chunks in a single request.  The backend groups the coords by
 * region so each region file is read once.  Absent/empty chunks are simply
 * omitted from the result — the caller diffs the requested coords against the
 * returned chunks to learn which came back empty.
 */
export async function fetchChunkBatch(
  worldPath: string,
  coords: [number, number][],
  /** Aborted when the map engine is torn down, so a dimension switch stops
   *  downloading and decoding megabytes destined for a dead engine. */
  signal?: AbortSignal
): Promise<ChunkData[]> {
  const res = await fetch(`${API_BASE}/worlds/chunks/batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ world_path: worldPath, coords }),
    signal,
  })
  if (!res.ok) throw new Error(`Failed to load chunk batch: ${res.statusText}`)
  return decodeChunkBatch(await res.arrayBuffer())
}

export function useChunkData(worldPath: string, cx: number, cz: number) {
  return useQuery({
    queryKey: ['chunk', worldPath, cx, cz],
    queryFn: () => fetchChunkData(worldPath, cx, cz),
  })
}
