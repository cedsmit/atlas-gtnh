import { useEffect, useState } from 'react'

import { useDumpMismatch } from '../api/dumpMismatch'

interface Props {
  worldPath: string | null
}

const STYLES = {
  error: { box: 'border-red-700/60 bg-red-950/90', dot: 'bg-red-500', title: 'text-red-200' },
  warn:  { box: 'border-amber-700/60 bg-amber-950/90', dot: 'bg-amber-500', title: 'text-amber-200' },
  info:  { box: 'border-sky-800/60 bg-sky-950/90', dot: 'bg-sky-500', title: 'text-sky-200' },
} as const

/**
 * Floating warning shown when the loaded icon dump doesn't match the world's
 * mod set — the usual cause of un-textured ("no mapping") blocks. Surfaces
 * missing mods (block-bearing ones first), version differences, and count gaps.
 */
export function DumpMismatchBanner({ worldPath }: Props) {
  const { data } = useDumpMismatch(worldPath)
  const [dismissed, setDismissed] = useState(false)

  // Re-show when switching worlds.
  useEffect(() => setDismissed(false), [worldPath])

  if (dismissed || !data?.dump_loaded || !data.has_mismatch) return null
  const severity = data.severity
  if (severity !== 'error' && severity !== 'warn' && severity !== 'info') return null

  const s = STYLES[severity]
  const missing = data.missing_from_dump ?? []
  const versions = data.version_mismatches ?? []
  const withBlocks = data.missing_with_blocks ?? 0

  const title =
    severity === 'error'
      ? 'Icon dump is missing mods used by this world'
      : severity === 'warn'
        ? 'Icon dump mod versions differ from this world'
        : 'Icon dump doesn’t fully match this world'

  const shown = missing.slice(0, 8)

  return (
    <div
      className={`absolute left-1/2 top-3 z-20 w-[34rem] max-w-[calc(100%-1.5rem)] -translate-x-1/2 rounded-md border ${s.box} px-3 py-2 text-xs text-zinc-200 shadow-lg backdrop-blur`}
    >
      <div className="flex items-start gap-2">
        <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${s.dot}`} />
        <div className="flex-1">
          <div className={`font-semibold ${s.title}`}>{title}</div>
          <div className="mt-0.5 text-zinc-400">
            World has {data.world_mod_count} mods; dump has {data.dump_mod_count}.
            {withBlocks > 0 && (
              <> <span className="text-red-300">{withBlocks} missing mod{withBlocks === 1 ? '' : 's'} contribute blocks</span> that can’t be textured.</>
            )}
            {' '}Regenerate the dump from this world’s GTNH instance.
          </div>

          {missing.length > 0 && (
            <div className="mt-1.5">
              <div className="text-zinc-500">Missing from dump:</div>
              <ul className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
                {shown.map((m) => (
                  <li key={m.mod_id} className="font-mono">
                    <span className={m.block_count > 0 ? 'text-red-300' : 'text-zinc-400'}>
                      {m.mod_id}
                    </span>
                    {m.block_count > 0 && (
                      <span className="ml-1 text-zinc-500">({m.block_count} blk)</span>
                    )}
                  </li>
                ))}
                {missing.length > shown.length && (
                  <li className="text-zinc-500">+{missing.length - shown.length} more</li>
                )}
              </ul>
            </div>
          )}

          {versions.length > 0 && (
            <div className="mt-1.5">
              <div className="text-zinc-500">Version differences:</div>
              <ul className="mt-0.5 space-y-0.5">
                {versions.slice(0, 5).map((v) => (
                  <li key={v.mod_id} className="font-mono text-zinc-400">
                    {v.mod_id}: world {v.world_version} ≠ dump {v.dump_version}
                  </li>
                ))}
                {versions.length > 5 && (
                  <li className="text-zinc-500">+{versions.length - 5} more</li>
                )}
              </ul>
            </div>
          )}
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
