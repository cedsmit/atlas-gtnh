import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'

import { downloadMissingBlockReport, useDumpMismatch } from '../api/dumpMismatch'
import { columnTally } from '../lib/columnTally'

interface Props {
  worldPath: string | null
}

const STYLES = {
  error: { box: 'border-red-700/60 bg-red-950/90', dot: 'bg-red-500', title: 'text-red-200' },
  warn:  { box: 'border-amber-700/60 bg-amber-950/90', dot: 'bg-amber-500', title: 'text-amber-200' },
  info:  { box: 'border-sky-800/60 bg-sky-950/90', dot: 'bg-sky-500', title: 'text-sky-200' },
} as const

const shortName = (n: string) => (n.includes(':') ? n.split(':', 2)[1] : n)

/**
 * Floating warning shown when the loaded icon dump doesn't match the world.
 * Combines a mod-level check (missing/version-mismatched mods) with a
 * block-level check (registry names absent from the dump), and ranks the
 * missing blocks by how many map columns they actually cover — so the visible
 * holes (e.g. ProjectRed stone) surface above invisible technical blocks.
 */
export function DumpMismatchBanner({ worldPath }: Props) {
  const { data } = useDumpMismatch(worldPath)
  const [dismissed, setDismissed] = useState(false)
  const [exporting, setExporting] = useState<null | 'json' | 'csv'>(null)

  // Re-render as the map tally grows.
  useSyncExternalStore(columnTally.subscribe, columnTally.getVersion)
  // Re-show when switching worlds.
  useEffect(() => setDismissed(false), [worldPath])

  // Missing blocks that are actually visible on the map, ranked by coverage.
  const visibleMissing = useMemo(() => {
    return (data?.missing_blocks ?? [])
      .map((b) => ({ ...b, columns: columnTally.count(b.block_id) }))
      .filter((b) => b.columns > 0)
      .sort((a, b) => b.columns - a.columns)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, columnTally.getVersion()])

  if (dismissed || !data?.dump_loaded || !data.has_mismatch) return null

  // Escalate to error when missing blocks are genuinely on-screen.
  const severity = visibleMissing.length > 0 ? 'error' : data.severity
  if (severity !== 'error' && severity !== 'warn' && severity !== 'info') return null

  const s = STYLES[severity]
  const missingMods = (data.missing_from_dump ?? []).filter((m) => m.block_count > 0)
  const versions = data.version_mismatches ?? []
  const missingTotal = data.missing_block_total ?? 0
  const driftTotal = data.drift_block_count ?? 0

  const title =
    visibleMissing.length > 0
      ? 'Blocks on this map aren’t in the icon dump'
      : missingMods.length > 0
        ? 'Icon dump is missing mods used by this world'
        : severity === 'warn'
          ? 'Icon dump mod versions differ from this world'
          : 'Icon dump doesn’t fully match this world'

  const shownBlocks = visibleMissing.slice(0, 8)

  const handleExport = async (format: 'json' | 'csv') => {
    if (!worldPath || exporting) return
    setExporting(format)
    try {
      await downloadMissingBlockReport(worldPath, format, columnTally.snapshot())
    } catch (e) {
      console.error('missing-block report export failed', e)
    } finally {
      setExporting(null)
    }
  }

  return (
    <div
      className={`absolute left-1/2 top-3 z-20 w-[36rem] max-w-[calc(100%-1.5rem)] -translate-x-1/2 rounded-md border ${s.box} px-3 py-2 text-xs text-zinc-200 shadow-lg backdrop-blur`}
    >
      <div className="flex items-start gap-2">
        <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${s.dot}`} />
        <div className="flex-1">
          <div className={`font-semibold ${s.title}`}>{title}</div>
          <div className="mt-0.5 text-zinc-400">
            World has {data.world_mod_count} mods; dump has {data.dump_mod_count}.
            {missingTotal > 0 && (
              <> {missingTotal} world block{missingTotal === 1 ? '' : 's'} absent from dump
                {driftTotal > 0 && <> ({driftTotal} are registration drift — mod present, block not dumped)</>}.</>
            )}
            {' '}Regenerate the dump from this world’s GTNH instance.
          </div>

          {/* Block-level: the visible holes, ranked by coverage. */}
          {visibleMissing.length > 0 && (
            <div className="mt-1.5">
              <div className="text-zinc-500">
                On the map ({visibleMissing.length} block{visibleMissing.length === 1 ? '' : 's'}):
              </div>
              <ul className="mt-0.5 space-y-0.5">
                {shownBlocks.map((b) => (
                  <li key={b.block_id} className="flex items-baseline gap-2 font-mono">
                    <span className="text-red-300">{shortName(b.registry_name)}</span>
                    <span className="text-zinc-500">{b.domain}</span>
                    <span className="ml-auto text-zinc-300">{b.columns.toLocaleString()} col</span>
                    {b.drift && <span className="rounded bg-zinc-800 px-1 text-[10px] text-zinc-400">drift</span>}
                  </li>
                ))}
                {visibleMissing.length > shownBlocks.length && (
                  <li className="text-zinc-500">+{visibleMissing.length - shownBlocks.length} more on the map</li>
                )}
              </ul>
            </div>
          )}

          {/* Mod-level: whole mods missing (with blocks). */}
          {missingMods.length > 0 && (
            <div className="mt-1.5">
              <div className="text-zinc-500">Mods missing from dump:</div>
              <ul className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
                {missingMods.slice(0, 8).map((m) => (
                  <li key={m.mod_id} className="font-mono text-red-300">
                    {m.mod_id} <span className="text-zinc-500">({m.block_count} blk)</span>
                  </li>
                ))}
                {missingMods.length > 8 && (
                  <li className="text-zinc-500">+{missingMods.length - 8} more</li>
                )}
              </ul>
            </div>
          )}

          {versions.length > 0 && (
            <div className="mt-1.5">
              <div className="text-zinc-500">Version differences:</div>
              <ul className="mt-0.5 space-y-0.5">
                {versions.slice(0, 4).map((v) => (
                  <li key={v.mod_id} className="font-mono text-zinc-400">
                    {v.mod_id}: world {v.world_version} ≠ dump {v.dump_version}
                  </li>
                ))}
                {versions.length > 4 && <li className="text-zinc-500">+{versions.length - 4} more</li>}
              </ul>
            </div>
          )}

          <div className="mt-2 text-zinc-500">
            Export missing-block report:{' '}
            <button
              onClick={() => handleExport('json')}
              disabled={!!exporting}
              className="text-sky-300 hover:underline disabled:opacity-50"
            >
              JSON
            </button>
            {' · '}
            <button
              onClick={() => handleExport('csv')}
              disabled={!!exporting}
              className="text-sky-300 hover:underline disabled:opacity-50"
            >
              CSV
            </button>
            {exporting && <span className="ml-1 text-zinc-400">generating…</span>}
          </div>
        </div>

        <button
          onClick={() => setDismissed(true)}
          className="shrink-0 rounded px-1 text-zinc-500 hover:text-zinc-200"
          aria-label="Dismiss"
          title="Dismiss"
        >
          ✕
        </button>
      </div>
    </div>
  )
}
