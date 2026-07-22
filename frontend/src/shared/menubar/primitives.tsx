import { Check, ChevronDown, Loader2 } from 'lucide-react'
import { type ReactNode } from 'react'

import { type Tone } from './types'

export const TONE_TEXT: Record<Tone, string> = {
  accent: 'text-atlas-accent',
  amber: 'text-atlas-amber',
}

export const TONE_ACTIVE: Record<Tone, string> = {
  accent: 'border-atlas-accent-line bg-atlas-accent-bg text-atlas-accent',
  amber: 'border-atlas-amber-line bg-atlas-amber-bg text-atlas-amber',
}

/** Sized by the icon slot it sits in, so it swaps 1:1 with a lucide icon. */
export function Spinner() {
  return <Loader2 className="animate-spin" aria-hidden />
}

export function MenuButton({
  open,
  onClick,
  icon,
  caret,
  active,
  accent,
  title,
  children,
}: {
  open: boolean
  onClick: () => void
  icon: ReactNode
  caret?: boolean
  /** This menu's panel is currently open. */
  active?: boolean
  accent?: Tone
  title?: string
  children: ReactNode
}) {
  const base =
    'inline-flex items-center gap-2 rounded-[9px] border px-3 py-2 text-[13px] transition-colors'
  // Three lit states, all tinted rather than filled — a solid accent fill is the
  // weight of a primary action (the world picker), not of "a panel is open".
  // `open` (dropdown showing) and `active` (this menu's panel is open) differ by
  // label colour so both can be true at once and still be told apart.
  const state = open
    ? 'border-atlas-accent-line bg-atlas-accent-bg text-zinc-100'
    : active
      ? TONE_ACTIVE.accent
      : accent
        ? `border-zinc-700 bg-atlas-hover ${TONE_TEXT[accent]}`
        : 'border-zinc-700 bg-atlas-hover text-zinc-300 hover:text-zinc-100'

  return (
    <button onClick={onClick} title={title} className={`${base} ${state}`}>
      <span className="[&>svg]:h-[15px] [&>svg]:w-[15px] [&>svg]:shrink-0">
        {icon}
      </span>
      {children}
      {caret && (
        <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-60" aria-hidden />
      )}
    </button>
  )
}

/**
 * A square, label-less button for the bar's right-hand cluster — the quick
 * toggles and the accessory menus.
 *
 * No visible text, so the icon has to carry the meaning: only give this to
 * controls whose icon is unambiguous and whose absence costs nothing, and leave
 * anything you would have to read to `MenuButton` on the left. Borderless at
 * rest keeps the cluster quieter than the named menus, and the transparent
 * border reserves the space a lit one takes so nothing shifts when it lights.
 */
export function IconButton({
  on,
  open,
  onClick,
  icon,
  tone = 'accent',
  label,
  title,
}: {
  /** The thing this controls is on. */
  on?: boolean
  /** This button's dropdown is showing. */
  open?: boolean
  onClick: () => void
  icon: ReactNode
  tone?: Tone
  /** The accessible name, since there is no visible text to serve as one. */
  label: string
  /** Defaults to `label`; pass a longer form to explain a cycle or a source. */
  title?: string
}) {
  const state = open
    ? 'border-atlas-accent-line bg-atlas-accent-bg text-zinc-100'
    : on
      ? TONE_ACTIVE[tone]
      : 'text-zinc-500 hover:bg-atlas-hover hover:text-zinc-100'

  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={title ?? label}
      className={`inline-flex h-8 w-8 items-center justify-center rounded-lg border border-transparent transition-colors [&>svg]:h-4 [&>svg]:w-4 [&>svg]:shrink-0 ${state}`}
    >
      {icon}
    </button>
  )
}

export function Dropdown({
  className,
  children,
}: {
  className?: string
  children: ReactNode
}) {
  return (
    <div
      className={`absolute top-[calc(100%+6px)] z-50 max-h-[70vh] overflow-y-auto rounded-[10px] border border-zinc-700 bg-atlas-menu p-1.5 shadow-2xl ${className ?? ''}`}
    >
      {children}
    </div>
  )
}

export function Item({
  onClick,
  disabled,
  title,
  icon,
  check,
  active,
  tone,
  hint,
  mono,
  children,
}: {
  onClick: () => void
  disabled?: boolean
  title?: string
  icon?: ReactNode
  check?: boolean
  active?: boolean
  tone?: Tone
  hint?: string
  mono?: boolean
  children: ReactNode
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors ${
        mono ? 'font-mono text-xs' : 'text-[13px]'
      } ${
        disabled
          ? // zinc-700 sat at 1.33:1 on the menu — not dimmed, invisible. This
            // is 3.18:1: plainly inactive next to an enabled item's 11:1, but
            // still readable as a control that exists.
            'cursor-default text-zinc-600'
          : tone
            ? `${TONE_TEXT[tone]} hover:bg-atlas-hover`
            : active
              ? 'bg-atlas-hover text-zinc-100'
              : 'text-zinc-300 hover:bg-atlas-hover hover:text-zinc-100'
      }`}
    >
      {icon && (
        <span className="shrink-0 [&>svg]:h-[15px] [&>svg]:w-[15px] [&>svg]:shrink-0">
          {icon}
        </span>
      )}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {hint && <span className="text-[10px] text-zinc-600">{hint}</span>}
      {check && (
        <Check className="h-3.5 w-3.5 shrink-0 text-atlas-accent" aria-hidden />
      )}
    </button>
  )
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="px-2.5 pb-1 pt-2 text-[10px] uppercase tracking-[0.12em] text-zinc-600">
      {children}
    </p>
  )
}

export function Separator() {
  return <hr className="my-1.5 border-zinc-800" />
}
