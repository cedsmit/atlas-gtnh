import { getCurrentWindow } from '@tauri-apps/api/window'
import { Copy, Minus, Square, X } from 'lucide-react'
import { useEffect, useState } from 'react'

/**
 * True only inside the Tauri shell. The app is also developed against a plain
 * browser preview, which has no window to control and its own chrome already —
 * so the controls render nothing there rather than throwing on first call.
 */
const IS_TAURI =
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

/**
 * Minimise / maximise / close for the frameless window.
 *
 * The native title bar is off (`decorations: false`), so these are the only way
 * to control the window — paired with the `data-tauri-drag-region` on the bar
 * itself, which handles dragging and double-click-to-maximise natively.
 */
export function WindowControls() {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    if (!IS_TAURI) return
    const win = getCurrentWindow()
    let unlisten: (() => void) | undefined
    let cancelled = false

    void win.isMaximized().then((m) => {
      if (!cancelled) setMaximized(m)
    })
    // Keep the glyph honest when the window is maximised by a route we don't
    // own: double-clicking the drag region, Win+Up, or an Aero-snap gesture.
    void win
      .onResized(() => {
        void win.isMaximized().then((m) => {
          if (!cancelled) setMaximized(m)
        })
      })
      .then((f) => {
        if (cancelled) f()
        else unlisten = f
      })

    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [])

  if (!IS_TAURI) return null

  const win = getCurrentWindow()

  return (
    <div className="ml-auto flex items-stretch self-stretch">
      <Button label="Minimize" onClick={() => void win.minimize()}>
        <Minus className="h-3.5 w-3.5" aria-hidden />
      </Button>
      <Button
        label={maximized ? 'Restore' : 'Maximize'}
        onClick={() => void win.toggleMaximize()}
      >
        {maximized ? (
          <Copy className="h-3 w-3 -scale-x-100" aria-hidden />
        ) : (
          <Square className="h-3 w-3" aria-hidden />
        )}
      </Button>
      <Button label="Close" danger onClick={() => void win.close()}>
        <X className="h-4 w-4" aria-hidden />
      </Button>
    </div>
  )
}

function Button({
  label,
  danger,
  onClick,
  children,
}: {
  label: string
  danger?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      // No drag-region opt-out needed: Tauri only starts a drag when the event
      // target itself carries the attribute, and a `false` value would still
      // count as present.
      className={`inline-flex w-[46px] items-center justify-center text-zinc-400 transition-colors ${
        danger
          ? 'hover:bg-atlas-danger hover:text-white'
          : 'hover:bg-atlas-hover hover:text-zinc-100'
      }`}
    >
      {children}
    </button>
  )
}
