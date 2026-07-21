import { SlidersHorizontal } from 'lucide-react'

import {
  Dropdown,
  Item,
  MenuButton,
  SectionLabel,
  Separator,
} from './primitives'
import { type MenuProps } from './types'
import {
  BUILT_IN_PRESETS,
  LAYER_TAGS,
  type LayerOverrides,
  type LayerTag,
  presetShowsTag,
} from '../../features/blocks/renderPresets'

export interface ViewConfig {
  selectedPresetId: string
  onSetPreset: (id: string) => void
  layerOverrides?: LayerOverrides
  onSetLayer?: (tag: LayerTag, show: boolean) => void
  onResetLayers?: () => void
}

interface Props extends Omit<MenuProps, 'onClose'>, ViewConfig {}

/** "How the map renders" — preset and which block layers show. */
export function ViewMenu({
  open: isOpen,
  onToggle,
  selectedPresetId,
  onSetPreset,
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
        title="Render preset and visible block layers"
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
                <>
                  {/* An action, not an eighth layer — the rule keeps it from
                      reading as one more toggle in the list. */}
                  <Separator />
                  <Item onClick={onResetLayers} disabled={!hasLayerOverrides}>
                    Reset to preset
                  </Item>
                </>
              )}
            </>
          )}
        </Dropdown>
      )}
    </div>
  )
}
