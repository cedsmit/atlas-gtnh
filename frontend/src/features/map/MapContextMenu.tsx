import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'

/** One row in the map context menu. Compose a list of these per right-click. */
export interface MapMenuItem {
  label: string
  icon?: ReactNode
  onClick: () => void
  danger?: boolean
  disabled?: boolean
}

interface Props {
  /** Viewport pixel position to anchor the menu at (the click point). */
  x: number
  y: number
  items: MapMenuItem[]
  onClose: () => void
}

/**
 * A small right-click menu anchored at a screen position, closed on outside click,
 * Escape, or after picking an item. Deliberately dumb: the caller composes the
 * item list, so new map actions are just extra entries — no changes here.
 */
export function MapContextMenu({ x, y, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x, y })

  // Keep the menu inside the viewport (flip/clamp when it would overflow).
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    const nx = Math.min(x, window.innerWidth - width - 8)
    const ny = Math.min(y, window.innerHeight - height - 8)
    setPos({ x: Math.max(8, nx), y: Math.max(8, ny) })
  }, [x, y])

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    // Capture so we close before a fresh right-click reopens elsewhere.
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('contextmenu', onDown, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('contextmenu', onDown, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return (
    <div
      ref={ref}
      className="fixed z-[60] min-w-44 rounded border border-zinc-700 bg-zinc-900 py-1 shadow-2xl"
      style={{ left: pos.x, top: pos.y }}
    >
      {items.map((item, i) => (
        <button
          key={i}
          disabled={item.disabled}
          onClick={() => {
            item.onClick()
            onClose()
          }}
          className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors ${
            item.disabled
              ? 'cursor-default text-zinc-600'
              : item.danger
                ? 'text-red-300 hover:bg-zinc-800 hover:text-red-200'
                : 'text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100'
          }`}
        >
          {item.icon}
          {item.label}
        </button>
      ))}
    </div>
  )
}
