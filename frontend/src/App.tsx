import { useState } from 'react'

import { ChunkViewer } from './components/ChunkViewer'
import { MenuBar } from './components/MenuBar'
import { RegionDetail } from './components/RegionDetail'
import { RegionList } from './components/RegionList'
import { WorldPicker } from './components/WorldPicker'

export default function App() {
  const [worldPath, setWorldPath] = useState<string | null>(null)
  const [selectedRegion, setSelectedRegion] = useState<{ rx: number; rz: number } | null>(null)
  const [selectedChunk, setSelectedChunk] = useState<{ cx: number; cz: number } | null>(null)

  function handleWorldSelected(path: string) {
    setWorldPath(path)
    setSelectedRegion(null)
    setSelectedChunk(null)
  }

  function handleCloseWorld() {
    setWorldPath(null)
    setSelectedRegion(null)
    setSelectedChunk(null)
  }

  function handleSelectRegion(rx: number, rz: number) {
    setSelectedRegion({ rx, rz })
    setSelectedChunk(null)
  }

  return (
    <div className="flex h-screen flex-col bg-gray-900 text-white">
      <MenuBar
        worldPath={worldPath}
        onWorldSelected={handleWorldSelected}
        onCloseWorld={handleCloseWorld}
      />

      {!worldPath ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4">
          <h1 className="text-2xl font-bold">Atlas GTNH</h1>
          <WorldPicker onWorldSelected={handleWorldSelected} />
        </div>
      ) : (
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
      )}
    </div>
  )
}
