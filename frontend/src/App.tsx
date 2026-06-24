import { useEffect } from 'react'
import { useState } from 'react'

import { type DimensionInfo, useDimensions } from './api/dimensions'
import { ChunkViewer } from './components/ChunkViewer'
import { DimensionPicker } from './components/DimensionPicker'
import { MenuBar } from './components/MenuBar'
import { RegionDetail } from './components/RegionDetail'
import { RegionList } from './components/RegionList'
import { WorldPicker } from './components/WorldPicker'

export default function App() {
  const [worldPath, setWorldPath] = useState<string | null>(null)
  const [dimensionPath, setDimensionPath] = useState<string | null>(null)
  const [selectedRegion, setSelectedRegion] = useState<{ rx: number; rz: number } | null>(null)
  const [selectedChunk, setSelectedChunk] = useState<{ cx: number; cz: number } | null>(null)

  const { data: dimensions } = useDimensions(worldPath)

  // Auto-select when only one dimension exists
  useEffect(() => {
    if (dimensions?.length === 1 && !dimensionPath) {
      setDimensionPath(dimensions[0].path)
    }
  }, [dimensions, dimensionPath])

  function handleWorldSelected(path: string) {
    setWorldPath(path)
    setDimensionPath(null)
    setSelectedRegion(null)
    setSelectedChunk(null)
  }

  function handleCloseWorld() {
    setWorldPath(null)
    setDimensionPath(null)
    setSelectedRegion(null)
    setSelectedChunk(null)
  }

  function handleSelectDimension(dim: DimensionInfo) {
    setDimensionPath(dim.path)
    setSelectedRegion(null)
    setSelectedChunk(null)
  }

  function handleSelectRegion(rx: number, rz: number) {
    setSelectedRegion({ rx, rz })
    setSelectedChunk(null)
  }

  const showDimensionPicker =
    !!worldPath && !dimensionPath && dimensions && dimensions.length > 1

  return (
    <div className="flex h-screen flex-col bg-zinc-950 text-white">
      <MenuBar
        worldPath={worldPath}
        onWorldSelected={handleWorldSelected}
        onCloseWorld={handleCloseWorld}
      />

      {!worldPath ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4">
          <h1 className="text-2xl font-bold text-zinc-100">Atlas GTNH</h1>
          <WorldPicker onWorldSelected={handleWorldSelected} />
        </div>
      ) : (
        <div className="flex flex-1 overflow-hidden">
          <aside className="w-52 overflow-y-auto border-r border-zinc-800 p-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
              Regions
            </p>
            <RegionList
              worldPath={dimensionPath ?? ''}
              onSelect={handleSelectRegion}
              selectedRx={selectedRegion?.rx ?? null}
              selectedRz={selectedRegion?.rz ?? null}
            />
          </aside>
          <main className="flex-1 overflow-auto p-4">
            {selectedChunk ? (
              <ChunkViewer
                worldPath={dimensionPath ?? ''}
                cx={selectedChunk.cx}
                cz={selectedChunk.cz}
                onBack={() => setSelectedChunk(null)}
              />
            ) : selectedRegion ? (
              <RegionDetail
                worldPath={dimensionPath ?? ''}
                rx={selectedRegion.rx}
                rz={selectedRegion.rz}
                onSelectChunk={(cx, cz) => setSelectedChunk({ cx, cz })}
              />
            ) : (
              <p className="text-sm text-zinc-500">Select a region to inspect its chunks.</p>
            )}
          </main>
        </div>
      )}

      {showDimensionPicker && (
        <DimensionPicker
          worldPath={worldPath}
          dimensions={dimensions}
          onSelect={handleSelectDimension}
          onCancel={handleCloseWorld}
        />
      )}
    </div>
  )
}
