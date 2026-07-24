import { Loader2, RefreshCw, TriangleAlert } from 'lucide-react'
import type { ReactNode } from 'react'

/**
 * A step of the load path that failed, said out loud.
 *
 * These used to be silent: a backend that was not up yet and a world that no
 * longer exists both ended as a spinner that never finished or a wordless
 * bounce back to the world picker. Each failure now names itself, quotes what
 * the backend said, and offers the action that fits — Retry while the answer
 * could still change, a way out when it cannot.
 *
 * Sized and centred like LoadingScreen, since it stands in the same place.
 */
export function ErrorScreen({
  title,
  detail,
  hint,
  retrying = false,
  onRetry,
  secondary,
}: {
  title: string
  /** The backend's own words — kept verbatim, they are often the only clue. */
  detail?: string
  hint?: ReactNode
  /** True while a retry is in flight, so the button can say so. */
  retrying?: boolean
  onRetry?: () => void
  /** The way out when retrying is not it: close the world, pick another. */
  secondary?: { label: string; onClick: () => void }
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 px-8">
      <div className="max-w-lg text-center">
        <h2 className="inline-flex items-center gap-2 text-xl font-semibold text-zinc-100">
          <TriangleAlert
            className="h-5 w-5 shrink-0 text-atlas-danger"
            aria-hidden
          />
          {title}
        </h2>
        {detail && (
          <p
            className="mt-2 break-words font-mono text-xs text-atlas-danger"
            role="alert"
          >
            {detail}
          </p>
        )}
        {hint && (
          <p className="mt-3 text-balance text-sm leading-relaxed text-zinc-500">
            {hint}
          </p>
        )}
      </div>

      <div className="flex items-center gap-2">
        {onRetry && (
          <button
            onClick={onRetry}
            disabled={retrying}
            className="inline-flex items-center gap-2 rounded-lg bg-atlas-accent px-4 py-2 text-sm font-semibold text-[#0b1512] transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {retrying ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <RefreshCw className="h-4 w-4" aria-hidden />
            )}
            {retrying ? 'Retrying…' : 'Retry'}
          </button>
        )}
        {secondary && (
          <button
            onClick={secondary.onClick}
            className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 transition-colors hover:bg-atlas-hover"
          >
            {secondary.label}
          </button>
        )}
      </div>
    </div>
  )
}
