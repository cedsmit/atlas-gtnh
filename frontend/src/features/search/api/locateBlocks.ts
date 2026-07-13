import { useMutation } from '@tanstack/react-query'

import { fetchChunkBatch } from '../../map/api/chunks'
import type { BlockColumn } from '../../map/mapEngine'

/** Cap on hit chunks scanned for the highlight, bounding the read for common
 *  blocks. Hits arrive sorted by count (densest first), so the top chunks win. */
const MAX_LOCATE_CHUNKS = 400
/** Read in sub-batches so no single request/parse gets huge (and stalls the UI). */
const LOCATE_BATCH = 64

interface LocateArgs {
  ids: number[]
  /** Chunks known to contain the block (from the instant index search). */
  chunks: [number, number][]
}

/**
 * Resolve the exact block columns to highlight: fetch the matched chunks (reusing
 * the map's batch reader) and scan their block data for the target ids, deduped
 * to one entry per (x, z) column since the map is top-down. Runs after the instant
 * index search, so the results list shows immediately and the markers follow.
 */
export function useLocateBlocks(dimensionPath: string) {
  return useMutation({
    mutationFn: async ({ ids, chunks }: LocateArgs): Promise<BlockColumn[]> => {
      const targets = new Set(ids)
      const coords = chunks.slice(0, MAX_LOCATE_CHUNKS)
      const columns: BlockColumn[] = []
      const mask = new Uint8Array(256) // one flag per (z<<4)|x column

      for (let i = 0; i < coords.length; i += LOCATE_BATCH) {
        const data = await fetchChunkBatch(
          dimensionPath,
          coords.slice(i, i + LOCATE_BATCH)
        )
        for (const chunk of data) {
          mask.fill(0)
          for (const section of chunk.sections) {
            const blocks = section.blocks
            for (let idx = 0; idx < blocks.length; idx++) {
              if (targets.has(blocks[idx])) mask[idx & 255] = 1 // idx&255 = column
            }
          }
          const bx = chunk.chunk_x * 16
          const bz = chunk.chunk_z * 16
          for (let c = 0; c < 256; c++) {
            if (mask[c]) columns.push({ x: bx + (c & 15), z: bz + (c >> 4) })
          }
        }
      }
      return columns
    },
  })
}
