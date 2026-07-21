import { Flame, Gem, Grid3x3, Layers, Waypoints } from 'lucide-react'

import {
  Dropdown,
  Item,
  MenuButton,
  SectionLabel,
  Separator,
  Spinner,
} from './primitives'
import { type MenuProps } from './types'

interface Props extends Omit<MenuProps, 'onClose'> {
  heatmapOn?: boolean
  heatmapLoading?: boolean
  onToggleHeatmap?: () => void
  gridOn?: boolean
  onToggleGrid?: () => void
  oreVeinsOn?: boolean
  oreVeinsLoading?: boolean
  onToggleOreVeins?: () => void
  infraViewOn?: boolean
  onToggleInfra?: () => void
  pipeSystems?: string[]
  hiddenPipeSystems?: ReadonlySet<string>
  onToggleInfraSystem?: (system: string, show: boolean) => void
  showInfraCables?: boolean
  onToggleInfraCables?: () => void
}

/**
 * "What is drawn on top of the map". Toggling an item deliberately leaves the
 * menu open so several overlays can be flipped in one go.
 */
export function OverlaysMenu({
  open: isOpen,
  onToggle,
  heatmapOn,
  heatmapLoading,
  onToggleHeatmap,
  gridOn,
  onToggleGrid,
  oreVeinsOn,
  oreVeinsLoading,
  onToggleOreVeins,
  infraViewOn,
  onToggleInfra,
  pipeSystems,
  hiddenPipeSystems,
  onToggleInfraSystem,
  showInfraCables,
  onToggleInfraCables,
}: Props) {
  const count = [heatmapOn, gridOn, oreVeinsOn, infraViewOn].filter(
    Boolean
  ).length

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
          {onToggleGrid && (
            <Item
              onClick={onToggleGrid}
              icon={<Grid3x3 />}
              check={gridOn}
              tone={gridOn ? 'accent' : undefined}
            >
              Grid
            </Item>
          )}
          {onToggleOreVeins && (
            <Item
              onClick={onToggleOreVeins}
              icon={oreVeinsLoading ? <Spinner /> : <Gem />}
              check={oreVeinsOn}
              tone={oreVeinsOn ? 'amber' : undefined}
            >
              Ore veins
            </Item>
          )}
          {onToggleHeatmap && (
            <Item
              onClick={onToggleHeatmap}
              icon={heatmapLoading ? <Spinner /> : <Flame />}
              check={heatmapOn}
              tone={heatmapOn ? 'amber' : undefined}
            >
              Heatmap
            </Item>
          )}
          {onToggleInfra && (
            <Item
              onClick={onToggleInfra}
              icon={<Waypoints />}
              check={infraViewOn}
              tone={infraViewOn ? 'cyan' : undefined}
            >
              Infrastructure
            </Item>
          )}

          {infraViewOn &&
            onToggleInfraSystem &&
            pipeSystems &&
            pipeSystems.length > 0 && (
              <>
                <Separator />
                <SectionLabel>Systems</SectionLabel>
                {pipeSystems.map((sys) => {
                  const visible = !hiddenPipeSystems?.has(sys)
                  return (
                    <Item
                      key={sys}
                      onClick={() => onToggleInfraSystem(sys, !visible)}
                      check={visible}
                    >
                      {sys}
                    </Item>
                  )
                })}
                {onToggleInfraCables && (
                  <Item
                    onClick={onToggleInfraCables}
                    check={showInfraCables}
                    hint="power / data"
                  >
                    Cables
                  </Item>
                )}
              </>
            )}
        </Dropdown>
      )}
    </div>
  )
}
