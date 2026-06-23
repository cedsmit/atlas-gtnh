import { useState } from 'react'

import { type ChunkSection, useChunkData } from '../api/chunks'

function blockColor(blockId: number): string {
  if (blockId === 0) return '#111827'
  const hue = (blockId * 137.508) % 360
  return `hsl(${hue}, 65%, 38%)`
}

function getTopLayer(blocks: number[]): number[] {
  const top = new Array<number>(256).fill(0)
  for (let z = 0; z < 16; z++) {
    for (let x = 0; x < 16; x++) {
      for (let y = 15; y >= 0; y--) {
        const id = blocks[y * 256 + z * 16 + x]
        if (id !== 0) {
          top[z * 16 + x] = id
          break
        }
      }
    }
  }
  return top
}

interface GridProps {
  section: ChunkSection
  cx: number
  cz: number
}

function SectionGrid({ section, cx, cz }: GridProps) {
  const topLayer = getTopLayer(section.blocks)

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(16, 18px)', gap: '1px' }}>
      {topLayer.map((blockId, idx) => {
        const x = idx % 16
        const z = Math.floor(idx / 16)
        return (
          <div
            key={idx}
            style={{ width: 18, height: 18, backgroundColor: blockColor(blockId) }}
            title={`ID ${blockId} · World (${cx * 16 + x}, ?, ${cz * 16 + z})`}
          />
        )
      })}
    </div>
  )
}

interface Props {
  worldPath: string
  cx: number
  cz: number
  onBack: () => void
}

export function ChunkViewer({ worldPath, cx, cz, onBack }: Props) {
  const { data, isLoading, error } = useChunkData(worldPath, cx, cz)
  const [selectedY, setSelectedY] = useState<number | null>(null)

  if (isLoading) return <p className="text-sm text-gray-400">Loading chunk data…</p>
  if (error) return <p className="text-sm text-red-400">{(error as Error).message}</p>
  if (!data) return null

  const activeY = selectedY ?? (data.sections[0]?.y ?? 0)
  const section = data.sections.find((s) => s.y === activeY) ?? null
  const nonAirCount = section ? section.blocks.filter((b) => b !== 0).length : 0

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="rounded px-2 py-1 text-sm text-gray-400 hover:bg-gray-700 hover:text-white"
        >
          ← Back
        </button>
        <h2 className="text-lg font-semibold">
          Chunk ({cx}, {cz})
        </h2>
        <span className="text-sm text-gray-400">
          X {cx * 16}–{cx * 16 + 15} · Z {cz * 16}–{cz * 16 + 15}
        </span>
      </div>

      {data.sections.length === 0 ? (
        <p className="text-sm text-gray-500">No block sections in this chunk.</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-1">
            {data.sections.map((s) => (
              <button
                key={s.y}
                onClick={() => setSelectedY(s.y)}
                className={`rounded px-2 py-1 text-xs ${
                  s.y === activeY
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                }`}
              >
                Y {s.y * 16}–{s.y * 16 + 15}
              </button>
            ))}
          </div>

          {section && (
            <div className="flex gap-6">
              <div>
                <p className="mb-2 text-xs text-gray-400">
                  Top-layer view · section Y {section.y} (blocks {section.y * 16}–
                  {section.y * 16 + 15})
                </p>
                <SectionGrid section={section} cx={cx} cz={cz} />
              </div>
              <div className="flex flex-col gap-2 text-sm">
                <div className="rounded border border-gray-700 p-3">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
                    Section stats
                  </p>
                  <p>
                    <span className="text-gray-400">Non-air blocks: </span>
                    <span className="font-mono text-green-400">{nonAirCount}</span>
                  </p>
                  <p>
                    <span className="text-gray-400">Air blocks: </span>
                    <span className="font-mono text-gray-500">{4096 - nonAirCount}</span>
                  </p>
                </div>
                <div className="rounded border border-gray-700 p-3">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
                    Chunk info
                  </p>
                  <p>
                    <span className="text-gray-400">Sections: </span>
                    <span className="font-mono">{data.sections.length}</span>
                  </p>
                  <p>
                    <span className="text-gray-400">Chunk X: </span>
                    <span className="font-mono">{data.chunk_x}</span>
                  </p>
                  <p>
                    <span className="text-gray-400">Chunk Z: </span>
                    <span className="font-mono">{data.chunk_z}</span>
                  </p>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
