import { Loader2, Map, TriangleAlert } from 'lucide-react'

import { type RegionSummary, useRegions } from '../map/api/regions'

interface Props {
  worldPath: string
  onSelect: (rx: number, rz: number) => void
  selectedRx: number | null
  selectedRz: number | null
}

export function RegionList({
  worldPath,
  onSelect,
  selectedRx,
  selectedRz,
}: Props) {
  const { data, isLoading, error } = useRegions(worldPath)

  if (isLoading)
    return (
      <p className="inline-flex items-center gap-1.5 text-sm text-gray-400">
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />
        Loading regions…
      </p>
    )
  if (error)
    return (
      <p className="inline-flex items-center gap-1.5 text-sm text-red-400">
        <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden />
        {(error as Error).message}
      </p>
    )
  if (!data?.regions.length)
    return (
      <p className="inline-flex items-center gap-1.5 text-sm text-gray-400">
        <Map className="h-4 w-4 shrink-0" aria-hidden />
        No regions found.
      </p>
    )

  return (
    <div className="flex flex-col gap-1">
      <p className="mb-2 text-xs text-gray-500">
        {data.region_count} region(s)
      </p>
      {data.regions.map((r: RegionSummary) => {
        const active = r.region_x === selectedRx && r.region_z === selectedRz
        return (
          <button
            key={r.file_name}
            onClick={() => onSelect(r.region_x, r.region_z)}
            className={`inline-flex items-center gap-1.5 rounded px-3 py-2 text-left text-sm transition-colors ${
              active
                ? 'bg-blue-600 text-white'
                : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
            }`}
          >
            <Map className="h-4 w-4 shrink-0" aria-hidden />
            {r.file_name}
          </button>
        )
      })}
    </div>
  )
}
