/** Which dropdown is open — at most one, so switching menus is a single set. */
export type MenuId = 'file' | 'view' | 'overlays' | 'search' | 'saved' | 'debug'

/** Accent colour a control adopts when it is active. */
/** Emerald marks an active feature; amber marks an active diagnostic. */
export type Tone = 'accent' | 'amber'

/** Props every dropdown needs to participate in the shared open/close state. */
export interface MenuProps {
  open: boolean
  onToggle: () => void
  onClose: () => void
}
