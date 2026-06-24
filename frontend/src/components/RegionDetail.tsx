import { useRegionDetail } from '../api/regions'

interface Props {
  worldPath: string
  rx: number
  rz: number
  onSelectChunk: (cx: number, cz: number) => void
}

export function RegionDetail({ worldPath, rx, rz, onSelectChunk }: Props) {
  const { data, isLoading, error } = useRegionDetail(worldPath, rx, rz)

  if (isLoading) return <p className="text-sm text-gray-400">Loading chunks…</p>
  if (error)
    return <p className="text-sm text-red-400">{(error as Error).message}</p>
  if (!data) return null

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-4">
        <h2 className="text-lg font-semibold">{data.file_name}</h2>
        <span className="text-sm text-gray-400">
          {data.chunk_count} chunk(s)
          {data.skipped_chunks > 0 && (
            <span className="ml-2 text-yellow-400">
              ({data.skipped_chunks} corrupt)
            </span>
          )}
        </span>
      </div>
      <div className="overflow-auto rounded border border-gray-700">
        <table className="w-full text-sm">
          <thead className="bg-gray-800 text-left text-xs text-gray-400">
            <tr>
              <th className="px-3 py-2">Chunk X</th>
              <th className="px-3 py-2">Chunk Z</th>
              <th className="px-3 py-2">Populated</th>
              <th className="px-3 py-2">Inhabited (ticks)</th>
              <th className="px-3 py-2">Last Update</th>
            </tr>
          </thead>
          <tbody>
            {data.chunks.map((c) => (
              <tr
                key={`${c.chunk_x},${c.chunk_z}`}
                className="cursor-pointer border-t border-gray-700 hover:bg-gray-800"
                onClick={() => onSelectChunk(c.chunk_x, c.chunk_z)}
              >
                <td className="px-3 py-1 font-mono">{c.chunk_x}</td>
                <td className="px-3 py-1 font-mono">{c.chunk_z}</td>
                <td className="px-3 py-1">
                  <span
                    className={c.populated ? 'text-green-400' : 'text-gray-500'}
                  >
                    {c.populated ? 'Yes' : 'No'}
                  </span>
                </td>
                <td className="px-3 py-1 font-mono">
                  {c.inhabited_time.toLocaleString()}
                </td>
                <td className="px-3 py-1 font-mono">
                  {c.last_update.toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
