import { SlidersHorizontal } from 'lucide-react'

import {
  Dropdown,
  Item,
  MenuButton,
  Pill,
  SectionLabel,
  Separator,
} from './primitives'
import { type ElevOverride, type MenuProps } from './types'
import {
  BUILT_IN_PRESETS,
  LAYER_TAGS,
  type LayerOverrides,
  type LayerTag,
  presetShowsTag,
} from '../../features/blocks/renderPresets'

const ELEV_OPTIONS: { value: ElevOverride; label: string }[] = [
  { value: 'preset', label: 'Preset' },
  { value: 'off', label: 'Off' },
  { value: 'subtle', label: 'Subtle' },
  { value: 'strong', label: 'Strong' },
  { value: 'relief', label: 'Relief' },
  { value: 'heightmap', label: 'Heightmap' },
  { value: 'contours', label: 'Contours' },
]

interface Props extends Omit<MenuProps, 'onClose'> {
  selectedPresetId: string
  onSetPreset: (id: string) => void
  elevOverride?: ElevOverride
  onSetElevOverride?: (v: ElevOverride) => void
  layerOverrides?: LayerOverrides
  onSetLayer?: (tag: LayerTag, show: boolean) => void
  onResetLayers?: () => void
}

/** "How the map renders" — preset, elevation and which block layers show. */
export function ViewMenu({
  open: isOpen,
  onToggle,
  selectedPresetId,
  onSetPreset,
  elevOverride,
  onSetElevOverride,
  layerOverrides,
  onSetLayer,
  onResetLayers,
}: Props) {
  const activePreset =
    BUILT_IN_PRESETS.find((p) => p.id === selectedPresetId) ??
    BUILT_IN_PRESETS[0]
  const hasLayerOverrides =
    !!layerOverrides && Object.keys(layerOverrides).length > 0

  return (
    <div className="relative">
      <MenuButton
        open={isOpen}
        onClick={onToggle}
        icon={<SlidersHorizontal />}
        caret
        accent={hasLayerOverrides ? 'amber' : undefined}
        title="Render preset, elevation and visible block layers"
      >
        View
      </MenuButton>

      {isOpen && (
        <Dropdown className="left-0 w-[248px]">
          <SectionLabel>Render preset</SectionLabel>
          {BUILT_IN_PRESETS.map((p) => (
            <Item
              key={p.id}
              onClick={() => onSetPreset(p.id)}
              title={p.description}
              active={p.id === selectedPresetId}
              check={p.id === selectedPresetId}
            >
              {p.name}
            </Item>
          ))}

          {onSetElevOverride && (
            <>
              <Separator />
              <SectionLabel>Elevation</SectionLabel>
              <div className="flex flex-wrap gap-1 px-1.5 pb-1.5">
                {ELEV_OPTIONS.map((o) => (
                  <Pill
                    key={o.value}
                    active={(elevOverride ?? 'preset') === o.value}
                    onClick={() => onSetElevOverride(o.value)}
                  >
                    {o.label}
                  </Pill>
                ))}
              </div>
            </>
          )}

          {onSetLayer && (
            <>
              <Separator />
              <SectionLabel>Layers</SectionLabel>
              {LAYER_TAGS.map(({ tag, label }) => {
                const visible =
                  layerOverrides?.[tag] ?? presetShowsTag(activePreset, tag)
                return (
                  <Item
                    key={tag}
                    onClick={() => onSetLayer(tag, !visible)}
                    check={visible}
                  >
                    {label}
                  </Item>
                )
              })}
              {onResetLayers && (
                <Item onClick={onResetLayers} disabled={!hasLayerOverrides}>
                  Reset to preset
                </Item>
              )}
            </>
          )}
        </Dropdown>
      )}
    </div>
  )
}
