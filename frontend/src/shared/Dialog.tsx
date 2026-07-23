import { type ReactNode, type RefObject, useEffect, useId } from 'react'

/**
 * The app's modal shell: backdrop, panel, header, body and a footer of actions.
 *
 * Everything a modal has to get right and is easy to get wrong lives here —
 * Escape and backdrop dismissal, the `role`/`aria-modal`/labelling triple, and
 * moving focus into the panel on open — so a new dialog is a body and some
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

  useEffect(() => {
    initialFocusRef?.current?.focus()
  }, [initialFocusRef])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose()
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
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-xl border border-zinc-700 bg-atlas-row shadow-2xl"
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
