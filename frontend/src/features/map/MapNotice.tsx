import { Loader2, TriangleAlert } from 'lucide-react'
import type { ReactNode } from 'react'

/**
 * A floating line over the map: why it is empty, or what went wrong drawing it.
 *
 * Where the map's other notices already sit — top centre, over the tiles — and
 * transparent to the pointer unless it carries a button, so the map underneath
 * stays pannable while it is up.
 */
export function MapNotice({
  tone = 'info',
  action,
  children,
}: {
  tone?: 'info' | 'error'
  action?: { label: string; onClick: () => void; busy?: boolean }
  children: ReactNode
}) {
  const error = tone === 'error'
  return (
    <div
      role={error ? 'alert' : 'status'}
      className={`absolute left-1/2 top-3 z-30 flex max-w-[calc(100%-1.5rem)] -translate-x-1/2 items-center gap-3 rounded-lg border px-3 py-2 text-xs shadow-lg backdrop-blur ${
        action ? '' : 'pointer-events-none'
      } ${
        error
          ? 'border-red-700/60 bg-red-950/90 text-red-100'
          : 'border-zinc-800 bg-atlas-bar/90 text-zinc-300'
      }`}
    >
      {error && (
        <TriangleAlert className="h-4 w-4 shrink-0 text-red-400" aria-hidden />
      )}
      <span className="min-w-0">{children}</span>
      {action && (
        <button
          onClick={action.onClick}
          disabled={action.busy}
          className={`inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-1 font-medium transition-colors disabled:opacity-50 ${
            error
              ? 'border-red-700/70 hover:bg-red-900/60'
              : 'border-zinc-700 hover:bg-atlas-hover'
          }`}
        >
          {action.busy && (
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
          )}
          {action.label}
        </button>
      )}
    </div>
  )
}
