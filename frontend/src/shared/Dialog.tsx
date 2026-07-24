import { type ReactNode, type RefObject, useEffect, useId, useRef } from 'react'

/** What Tab visits. Queried in DOM order, which is the order it visits them. */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * The app's modal shell: backdrop, panel, header, body and a footer of actions.
 *
 * Everything a modal has to get right and is easy to get wrong lives here —
 * Escape and backdrop dismissal, the `role`/`aria-modal`/labelling triple, and
 * the whole focus story: into the panel on open, kept there while it is up,
 * back where it came from on close — so a new dialog is a body and some
 * buttons rather than another copy of all that.
 *
 * Callers say what focus lands on. It matters: a destructive dialog wants the
 * cancel button (a stray Enter is then harmless), a form wants its first field.
 */
export function Dialog({
  title,
  icon,
  busy = false,
  onClose,
  initialFocusRef,
  footer,
  children,
}: {
  title: ReactNode
  /** Small glyph beside the title — the tone-setter for the whole panel. */
  icon?: ReactNode
  /** While true, the dialog refuses to dismiss: an action is mid-flight. */
  busy?: boolean
  onClose: () => void
  initialFocusRef?: RefObject<HTMLElement>
  footer: ReactNode
  children: ReactNode
}) {
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)

  // Hand focus back to whatever opened the dialog. Declared above the effect
  // that moves focus in, so it still reads the opener rather than our own
  // field; without it the next Tab restarts from the top of the document and
  // the button that was pressed is left looking as though it never was.
  useEffect(() => {
    const opener = document.activeElement
    return () => {
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus()
    }
  }, [])

  useEffect(() => {
    initialFocusRef?.current?.focus()
    // Fall back to the panel when there was nothing to focus — no caller
    // target, or a disabled one, which silently refuses focus. A dialog that
    // never takes focus leaves the keyboard in the page behind it.
    const panel = panelRef.current
    if (panel && !panel.contains(document.activeElement)) panel.focus()
  }, [initialFocusRef])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose()
      if (e.key === 'Tab') trapTab(panelRef.current, e)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, busy])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={() => !busy && onClose()}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        // Somewhere for focus to sit when no control can hold it. Not a tab
        // stop; only the code above and below ever moves focus here.
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-xl border border-zinc-700 bg-atlas-row shadow-2xl outline-none"
      >
        <div className="flex items-start gap-2.5 border-b border-zinc-800 px-4 py-3">
          {icon}
          <h2
            id={titleId}
            className="text-[13.5px] font-semibold text-zinc-100"
          >
            {title}
          </h2>
        </div>

        <div className="space-y-2.5 px-4 py-3">{children}</div>

        <div className="flex gap-1.5 border-t border-zinc-800 px-4 py-3">
          {footer}
        </div>
      </div>
    </div>
  )
}

/**
 * Keep Tab inside the panel, wrapping at either end.
 *
 * `aria-modal` tells a screen reader the rest of the page is not there; it does
 * nothing to the tab order. So Tab off the last button walks into the map
 * behind the backdrop — where the window-level shortcuts are live, and an `f`
 * meant for a coordinate field flies the camera under a modal that still looks
 * focused.
 */
function trapTab(panel: HTMLElement | null, e: KeyboardEvent) {
  if (!panel) return
  const stops = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE))
  // A dialog mid-write has disabled every one of its own controls. Park focus
  // on the panel rather than hand this Tab to the page behind it.
  if (stops.length === 0) {
    e.preventDefault()
    return panel.focus()
  }

  const active = document.activeElement
  const leaving = e.shiftKey ? stops[0] : stops[stops.length - 1]
  // Anywhere else inside the panel, the browser's own tab order is right.
  if (panel.contains(active) && active !== leaving) return

  e.preventDefault()
  const entering = e.shiftKey ? stops[stops.length - 1] : stops[0]
  entering.focus()
}

/** The affirmative button of a dialog: fills the row, carries the accent. */
export function DialogConfirm({
  onClick,
  disabled,
  type = 'button',
  children,
}: {
  onClick?: () => void
  disabled?: boolean
  type?: 'button' | 'submit'
  children: ReactNode
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md bg-atlas-accent px-3 py-2 text-xs font-semibold text-[#08140a] transition-opacity hover:opacity-90 disabled:opacity-40"
    >
      {children}
    </button>
  )
}

/** The way out: quieter than the confirm, and never the wider of the two. */
export function DialogCancel({
  onClick,
  disabled,
  buttonRef,
  children = 'Cancel',
}: {
  onClick: () => void
  disabled?: boolean
  buttonRef?: RefObject<HTMLButtonElement>
  children?: ReactNode
}) {
  return (
    <button
      type="button"
      ref={buttonRef}
      onClick={onClick}
      disabled={disabled}
      className="rounded-md border border-zinc-700 px-3 py-2 text-xs text-zinc-300 transition-colors hover:bg-atlas-hover disabled:opacity-40"
    >
      {children}
    </button>
  )
}
