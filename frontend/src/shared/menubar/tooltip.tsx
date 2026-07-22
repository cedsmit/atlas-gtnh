import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

/** Long enough that crossing the bar on the way elsewhere does not trigger tips. */
const DELAY_MS = 400

/** Half the tip's max width, used to keep it clear of the window edges. */
const HALF_MAX = 150

/** Gap between the trigger and the tip. */
const OFFSET = 8

/**
 * Hover text for the bar's buttons.
 *
 * Drawn here rather than left to the `title` attribute, which proved unreliable
 * in the webview Tauri embeds — the same markup shows a tip on one button and
 * nothing on the next — and which cannot be themed, timed, or kept inside the
 * window. This behaves the same on every button by construction.
 *
 * The tip goes in a portal, so neither the bar nor an open dropdown can clip
 * it, and it never takes pointer events, so it cannot interrupt a click or a
 * window drag. `aria-describedby` carries the text to assistive tech, which is
 * the one job the `title` attribute was still doing.
 */
export function useTooltip(text?: string) {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const id = useId()

  const cancel = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
  }
  useEffect(() => cancel, [])

  // Typed by shape so the same handler serves both mouse and focus events.
  const show = (e: { currentTarget: HTMLElement }) => {
    if (!text) return
    const r = e.currentTarget.getBoundingClientRect()
    const x = Math.min(
      Math.max(r.left + r.width / 2, HALF_MAX + OFFSET),
      window.innerWidth - HALF_MAX - OFFSET
    )
    const y = r.bottom + OFFSET
    cancel()
    timer.current = setTimeout(() => setAt({ x, y }), DELAY_MS)
  }

  const hide = () => {
    cancel()
    setAt(null)
  }

  return {
    /** Spread onto the trigger element. */
    trigger: {
      onMouseEnter: show,
      onMouseLeave: hide,
      // A click has answered whatever the tip would have said.
      onMouseDown: hide,
      onFocus: show,
      onBlur: hide,
      'aria-describedby': at && text ? id : undefined,
    },
    /** Render alongside the trigger; it portals itself to the body. */
    tip:
      at && text
        ? createPortal(
            <div
              id={id}
              role="tooltip"
              style={{ left: at.x, top: at.y }}
              className="pointer-events-none fixed z-[100] max-w-[300px] -translate-x-1/2 rounded-md border border-zinc-700 bg-atlas-menu px-2.5 py-1.5 text-xs leading-snug text-zinc-300 shadow-xl"
            >
              {text}
            </div>,
            document.body
          )
        : null,
  }
}
