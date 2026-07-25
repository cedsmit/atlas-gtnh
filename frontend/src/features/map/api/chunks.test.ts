import { describe, expect, it } from 'vitest'

import { decodeChunkBatch } from './chunks'

/**
 * The layout `backend/app/world/section_codec.py` writes, built here
 * independently so the decoder is pinned against the documented format rather
 * than against whatever the encoder happens to do. Both sides describe the same
 * spec; if one drifts, one of the two test suites goes red.
 */
function encode(
  chunks: {
    x: number
    z: number
    biomes?: number[]
    sections: { y: number; blocks: number[]; data: number[] }[]
  }[]
): ArrayBuffer {
  const header = {
    chunks: chunks.map((c) => ({
      x: c.x,
      z: c.z,
      biomes: (c.biomes?.length ?? 0) === 256,
      ys: c.sections.map((s) => s.y),
    })),
  }
  let head = new TextEncoder().encode(JSON.stringify(header))
  const pad = (4 - ((8 + head.length) % 4)) % 4
  if (pad) {
    const padded = new Uint8Array(head.length + pad).fill(0x20)
    padded.set(head)
    head = padded
  }

  const values: number[] = []
  for (const c of chunks) {
    if ((c.biomes?.length ?? 0) === 256) values.push(...c.biomes!)
    for (const s of c.sections) values.push(...s.blocks, ...s.data)
  }

  const buf = new ArrayBuffer(8 + head.length + values.length * 2)
  const view = new DataView(buf)
  view.setUint32(0, 0x314c5441, true) // "ATL1"
  view.setUint32(4, head.length, true)
  new Uint8Array(buf, 8, head.length).set(head)
  new Uint16Array(buf, 8 + head.length, values.length).set(values)
  return buf
}

const seq = (n: number, f: (i: number) => number) =>
  Array.from({ length: n }, (_, i) => f(i))

describe('decodeChunkBatch', () => {
  const section = (y: number, base: number) => ({
    y,
    blocks: seq(4096, (i) => (base + i) % 4096),
    data: seq(4096, (i) => i % 16),
  })

  it('reads chunks, sections and biomes back out', () => {
    const biomes = seq(256, (i) => i)
    const chunks = decodeChunkBatch(
      encode([
        { x: 3, z: -7, biomes, sections: [section(0, 0), section(5, 100)] },
        { x: -1, z: 2, sections: [] },
      ])
    )

    expect(chunks).toHaveLength(2)
    expect(chunks[0].chunk_x).toBe(3)
    expect(chunks[0].chunk_z).toBe(-7)
    expect(chunks[0].biomes).toEqual(biomes)
    expect(chunks[0].sections.map((s) => s.y)).toEqual([0, 5])
    expect(chunks[0].sections[1].blocks[0]).toBe(100)
    expect(chunks[0].sections[0].data[17]).toBe(1)
    // Absent biomes stay empty rather than becoming 256 zeroes — the renderer
    // tells those apart (no biome data at all vs. everything is biome 0).
    expect(chunks[1].biomes).toEqual([])
    expect(chunks[1].sections).toEqual([])
  })

  it('hands out views onto the response buffer, not copies', () => {
    const chunks = decodeChunkBatch(
      encode([{ x: 0, z: 0, sections: [section(0, 0)] }])
    )
    expect(chunks[0].sections[0].blocks).toBeInstanceOf(Uint16Array)
    expect(chunks[0].sections[0].blocks).toHaveLength(4096)
  })

  it('carries metadata above a nibble (Data16 worlds)', () => {
    const wide = {
      y: 0,
      blocks: seq(4096, () => 4095),
      data: seq(4096, () => 700),
    }
    const chunks = decodeChunkBatch(encode([{ x: 0, z: 0, sections: [wide] }]))
    expect(chunks[0].sections[0].data[0]).toBe(700)
    expect(chunks[0].sections[0].blocks[0]).toBe(4095)
  })

  it('rejects a buffer that is not this format', () => {
    const notOurs = new ArrayBuffer(16)
    new DataView(notOurs).setUint32(0, 0x12345678, true)
    expect(() => decodeChunkBatch(notOurs)).toThrow(/expected format/)
    expect(() => decodeChunkBatch(new ArrayBuffer(2))).toThrow(
      /expected format/
    )
  })

  it('rejects a truncated payload instead of returning a short batch', () => {
    // A cut-off response must not read as "that chunk was empty" — the map
    // would draw a hole and never retry it.
    const full = encode([{ x: 0, z: 0, sections: [section(0, 0)] }])
    expect(() => decodeChunkBatch(full.slice(0, full.byteLength - 64))).toThrow(
      /truncated/
    )
  })
})
