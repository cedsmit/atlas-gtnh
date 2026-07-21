import {
  Flame,
  Gem,
  Grid3x3,
  Layers,
  Waypoints,
  type LucideIcon,
} from 'lucide-react'
import { type ReactNode } from 'react'

import {
  Dropdown,
  Item,
  MenuButton,
  SectionLabel,
  Separator,
  Spinner,
} from './primitives'
import { type MenuProps, type Tone } from './types'

/**
 * The overlays the map can draw, in menu order. Adding one is a single entry
 * here plus its state in the `overlays` record the bar is given — nothing in
 * this component's body is per-overlay.
 */
const OVERLAY_DEFS = [
  { id: 'grid', label: 'Grid', Icon: Grid3x3, tone: 'accent' },
  { id: 'oreVeins', label: 'Ore veins', Icon: Gem, tone: 'amber' },
  { id: 'heatmap', label: 'Heatmap', Icon: Flame, tone: 'amber' },
  { id: 'infra', label: 'Infrastructure', Icon: Waypoints, tone: 'cyan' },
] as const satisfies readonly {
  id: string
  label: string
  Icon: LucideIcon
  tone: Tone
}[]

export type OverlayId = (typeof OVERLAY_DEFS)[number]['id']

/** Live state for one overlay. Absent from the record = not offered at all. */
export interface OverlayState {
  on?: boolean
  /** Shows a spinner in place of the icon while the data is in flight. */
  loading?: boolean
  onToggle: () => void
}

/**
 * Infrastructure View's per-system filter. Kept as an explicit extra rather
 * than folded into OverlayState: it is the one overlay with sub-options, and
 * pretending otherwise would cost every other overlay a generic slot.
 */
export interface InfraDetail {
  systems?: string[]
  hidden?: ReadonlySet<string>
  onToggleSystem?: (system: string, show: boolean) => void
  showCables?: boolean
  onToggleCables?: () => void
}

export interface OverlaysConfig {
  items: Partial<Record<OverlayId, OverlayState>>
  infraDetail?: InfraDetail
}

interface Props extends Omit<MenuProps, 'onClose'>, OverlaysConfig {}

/**
 * "What is drawn on top of the map". Toggling an item deliberately leaves the
 * menu open so several overlays can be flipped in one go.
 */
export function OverlaysMenu({
  open: isOpen,
  onToggle,
  items,
  infraDetail,
}: Props) {
  const offered = OVERLAY_DEFS.filter((d) => items[d.id])
  const count = offered.filter((d) => items[d.id]?.on).length

  const infra = items.infra
  const systems = infraDetail?.systems ?? []
  const showInfraSystems =
    infra?.on && infraDetail?.onToggleSystem && systems.length > 0

  let detail: ReactNode = null
  if (showInfraSystems && infraDetail?.onToggleSystem) {
    const onToggleSystem = infraDetail.onToggleSystem
    detail = (
      <>
        <Separator />
        <SectionLabel>Systems</SectionLabel>
        {systems.map((sys) => {
          const visible = !infraDetail.hidden?.has(sys)
          return (
            <Item
              key={sys}
              onClick={() => onToggleSystem(sys, !visible)}
              check={visible}
            >
              {sys}
            </Item>
          )
        })}
        {infraDetail.onToggleCables && (
          <Item
            onClick={infraDetail.onToggleCables}
            check={infraDetail.showCables}
            hint="power / data"
          >
            Cables
          </Item>
        )}
      </>
    )
  }

  return (
    <div className="relative">
      <MenuButton
        open={isOpen}
        onClick={onToggle}
        icon={<Layers />}
        caret
        badge={count}
        title="Overlays drawn on top of the map"
      >
        Overlays
      </MenuButton>

      {isOpen && (
        <Dropdown className="left-0 w-[236px]">
          {offered.map(({ id, label, Icon, tone }) => {
            const state = items[id]
            if (!state) return null
            return (
              <Item
                key={id}
                onClick={state.onToggle}
                icon={state.loading ? <Spinner /> : <Icon />}
                check={state.on}
                tone={state.on ? tone : undefined}
              >
                {label}
              </Item>
            )
          })}
          {detail}
        </Dropdown>
      )}
    </div>
  )
}
