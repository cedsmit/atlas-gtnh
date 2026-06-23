import { useState } from 'react'

import { ChunkViewer } from './components/ChunkViewer'
import { RegionDetail } from './components/RegionDetail'
import { RegionList } from './components/RegionList'
import { WorldPicker } from './components/WorldPicker'

export default function App() {
  const [worldPath, setWorldPath] = useState<string | null>(null)
  const [selectedRegion, setSelectedRegion] = useState<{ rx: number; rz: number } | null>(null)
  const [selectedChunk, setSelectedChunk] = useState<{ cx: number; cz: number } | null>(null)

  function handleSelectRegion(rx: number, rz: number) {
    setSelectedRegion({ rx, rz })
    setSelectedChunk(null)
  }

  if (!worldPath) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 bg-gray-900 text-white">
        <h1 className="text-2xl font-bold">Atlas GTNH</h1>
        <WorldPicker onWorldSelected={setWorldPath} />
      </div>
    )
  }

  return (
    <div className="flex h-screen flex-col bg-gray-900 text-white">
      <header className="flex items-center gap-4 border-b border-gray-700 px-4 py-3">
        <h1 className="text-lg font-bold">Atlas GTNH</h1>
        <span className="flex-1 truncate text-sm text-gray-400">{worldPath}</span>
        <button
          onClick={() => {
            setWorldPath(null)
            setSelectedRegion(null)
            setSelectedChunk(null)
          }}
          className="rounded px-3 py-1 text-sm text-gray-400 hover:bg-gray-700 hover:text-white"
        >
          Change World
        </button>
      </header>
      <div className="flex flex-1 overflow-hidden">
        <aside className="w-52 overflow-y-auto border-r border-gray-700 p-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
            Regions
          </p>
          <RegionList
            worldPath={worldPath}
            onSelect={handleSelectRegion}
            selectedRx={selectedRegion?.rx ?? null}
            selectedRz={selectedRegion?.rz ?? null}
          />
        </aside>
        <main className="flex-1 overflow-auto p-4">
          {selectedChunk ? (
            <ChunkViewer
              worldPath={worldPath}
              cx={selectedChunk.cx}
              cz={selectedChunk.cz}
              onBack={() => setSelectedChunk(null)}
            />
          ) : selectedRegion ? (
            <RegionDetail
              worldPath={worldPath}
              rx={selectedRegion.rx}
              rz={selectedRegion.rz}
              onSelectChunk={(cx, cz) => setSelectedChunk({ cx, cz })}
            />
          ) : (
            <p className="text-sm text-gray-500">Select a region to inspect its chunks.</p>
          )}
        </main>
      </div>
    </div>
  )
}
