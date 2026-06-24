import { useEffect, useState } from 'react'

import { useBlockColors } from './api/blockColors'
import { type DimensionInfo, useDimensions } from './api/dimensions'
import { useRegions } from './api/regions'
import { DimensionPicker } from './components/DimensionPicker'
import { MenuBar } from './components/MenuBar'
import { WorldMap } from './components/WorldMap'
import { WorldPicker } from './components/WorldPicker'

export default function App() {
  const [worldPath, setWorldPath] = useState<string | null>(null)
  const [dimensionPath, setDimensionPath] = useState<string | null>(null)

  const { data: dimensions } = useDimensions(worldPath)
  const { data: regionData } = useRegions(dimensionPath ?? '')
  const { data: blockColors } = useBlockColors(worldPath)

  useEffect(() => {
    if (dimensions?.length === 1 && !dimensionPath) {
      setDimensionPath(dimensions[0].path)
    }
  }, [dimensions, dimensionPath])

  function handleWorldSelected(path: string) {
    setWorldPath(path)
    setDimensionPath(null)
  }

  function handleCloseWorld() {
    setWorldPath(null)
    setDimensionPath(null)
  }

  function handleSelectDimension(dim: DimensionInfo) {
    setDimensionPath(dim.path)
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
      ) : dimensionPath ? (
        <div className="flex-1 overflow-hidden">
          <WorldMap
            dimensionPath={dimensionPath}
            regions={regionData?.regions ?? []}
            blockColors={blockColors}
          />
        </div>
      ) : null}

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
