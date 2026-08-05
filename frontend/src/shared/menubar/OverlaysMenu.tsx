import {
  Droplets,
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
import { type MenuProps } from './types'

/**
 * The overlays the map can draw, in menu order. Adding one is a single entry
 * here plus its state in the `overlays` record the bar is given — nothing in
 * this component's body is per-overlay.
 *
 * They deliberately share one accent: in a toolbar colour reads as state, not
 * identity — the label already says which overlay it is. Tinting each one
 * differently made two lit toggles look like different kinds of thing. Amber
 * stays reserved for the Debug menu's diagnostics, where the kind differs.
 */
const OVERLAY_DEFS = [
  {
    id: 'grid',
    label: 'Grid',
    Icon: Grid3x3,
    desc: 'Region and chunk boundaries over the map',
  },
  {
    id: 'oreVeins',
    label: 'Ore veins',
    Icon: Gem,
    desc: 'Ore veins recorded by Visual Prospecting',
  },
  {
    id: 'bedrockFluids',
    label: 'Bedrock fluids',
    Icon: Droplets,
    desc: 'All seed-predicted fields, with current Visual Prospecting values where available',
  },
  {
    id: 'heatmap',
    label: 'Heatmap',
    Icon: Flame,
    desc: 'Shades each chunk by machine and infrastructure density, so factories stand out from terrain',
  },
  {
    id: 'infra',
    label: 'Infrastructure',
    Icon: Waypoints,
    desc: 'Machines, pipes and cables, grouped into connected systems',
  },
] as const satisfies readonly {
  id: string
  label: string
  Icon: LucideIcon
  desc: string
}[]

export type OverlayId = (typeof OVERLAY_DEFS)[number]['id']

/** Live state for one overlay. Absent from the record = not offered at all. */
export interface OverlayState {
  on?: boolean
  /** Shows a spinner in place of the icon while the data is in flight. */
  loading?: boolean
  /** Extra state for overlays that are more than on/off, e.g. the grid's mode. */
  hint?: string
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
              title="Show or hide this system without turning off the rest of the overlay"
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
            title="Draw the power and data runs that connect the systems"
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
        title="Overlays drawn on top of the map"
      >
        Overlays
      </MenuButton>

      {isOpen && (
        <Dropdown className="left-0 w-[236px]">
          {offered.map(({ id, label, Icon, desc }) => {
            const state = items[id]
            if (!state) return null
            return (
              <Item
                key={id}
                onClick={state.onToggle}
                icon={state.loading ? <Spinner /> : <Icon />}
                check={state.on}
                hint={state.hint}
                title={desc}
                tone={state.on ? 'accent' : undefined}
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
