import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

/** Long enough that crossing the bar on the way elsewhere does not trigger tips. */
const DELAY_MS = 400

/** Widest a tip gets before it wraps. */
const MAX_W = 300

/** Narrower than this beside a menu and the tip flips to the other side. */
const MIN_SIDE = 170

/** Gap between the trigger and the tip. */
const OFFSET = 8

/**
 * Where the tip sits. `below` suits the bar; `side` is for menu items, where a
 * tip underneath would cover the next item down — the one thing you are most
 * likely to be reading towards.
 */
export type TipPlace = 'below' | 'side'

interface Pos {
  x: number
  y: number
  /** Transform that anchors the tip's box to (x, y) for the chosen side. */
  cls: string
  max: number
}

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
export function useTooltip(text?: string, place: TipPlace = 'below') {
  const [at, setAt] = useState<Pos | null>(null)
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
    let pos: Pos

    if (place === 'side') {
      // Menus sit at either end of the bar, so which side has room varies.
      const right = window.innerWidth - r.right - OFFSET * 2
      const left = r.left - OFFSET * 2
      pos =
        right >= Math.min(MIN_SIDE, left)
          ? { x: r.right + OFFSET, y: r.top + r.height / 2, cls: '-translate-y-1/2', max: right } // prettier-ignore
          : { x: r.left - OFFSET, y: r.top + r.height / 2, cls: '-translate-y-1/2 -translate-x-full', max: left } // prettier-ignore
    } else {
      const half = MAX_W / 2
      pos = {
        x: Math.min(
          Math.max(r.left + r.width / 2, half + OFFSET),
          window.innerWidth - half - OFFSET
        ),
        y: r.bottom + OFFSET,
        cls: '-translate-x-1/2',
        max: MAX_W,
      }
    }

    cancel()
    timer.current = setTimeout(() => setAt(pos), DELAY_MS)
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
              style={{
                left: at.x,
                top: at.y,
                maxWidth: Math.min(at.max, MAX_W),
              }}
              className={`pointer-events-none fixed z-[100] rounded-md border border-zinc-700 bg-atlas-menu px-2.5 py-1.5 text-xs leading-snug text-zinc-300 shadow-xl ${at.cls}`}
            >
              {text}
            </div>,
            document.body
          )
        : null,
  }
}
