import type { DimensionInfo } from '../api/dimensions'

interface Props {
  worldPath: string
  dimensions: DimensionInfo[]
  onSelect: (dim: DimensionInfo) => void
  onCancel: () => void
}

function dimColor(id: string): string {
  if (id === '') return 'bg-emerald-500'
  if (id === 'DIM-1') return 'bg-red-500'
  if (id === 'DIM1') return 'bg-violet-500'
  if (id === 'DIM7') return 'bg-green-400'
  if (id === 'DIM100') return 'bg-neutral-600'
  return 'bg-sky-500'
}

export function DimensionPicker({ worldPath, dimensions, onSelect, onCancel }: Props) {
  const folderName = worldPath.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? worldPath

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="w-full max-w-md rounded border border-zinc-700 bg-zinc-900 shadow-2xl">
        {/* Header */}
        <div className="border-b border-zinc-800 px-5 py-4">
          <h2 className="text-sm font-semibold text-zinc-100">Select Dimension</h2>
          <p className="mt-0.5 truncate text-xs text-zinc-500">{folderName}</p>
        </div>

        {/* Dimension list */}
        <ul className="max-h-80 overflow-y-auto py-2">
          {dimensions.map((dim) => (
            <li key={dim.id}>
              <button
                onClick={() => onSelect(dim)}
                className="flex w-full items-center gap-3 px-5 py-2.5 text-left transition-colors hover:bg-zinc-800"
              >
                <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${dimColor(dim.id)}`} />
                <span className="flex-1 text-sm text-zinc-200">{dim.name}</span>
                <span className="text-xs text-zinc-500">{dim.region_count} region{dim.region_count !== 1 ? 's' : ''}</span>
              </button>
            </li>
          ))}
        </ul>

        {/* Footer */}
        <div className="border-t border-zinc-800 px-5 py-3 text-right">
          <button
            onClick={onCancel}
            className="text-sm text-zinc-400 transition-colors hover:text-zinc-100"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
