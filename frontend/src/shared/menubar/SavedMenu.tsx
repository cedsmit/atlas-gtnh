import { Star, X } from 'lucide-react'
import { useState } from 'react'

import { Dropdown, IconButton, Separator } from './primitives'
import { useTooltip } from './tooltip'
import { type MenuProps } from './types'
import { type UserPreset } from '../../features/blocks/userPresets'

export interface SavedConfig {
  userPresets?: UserPreset[]
  onSavePreset: (name: string) => void
  onApplyPreset?: (p: UserPreset) => void
  onDeletePreset?: (id: string) => void
}

interface Props extends MenuProps, SavedConfig {}

/** Saved views — a bookmark of the render settings plus camera position. */
export function SavedMenu({
  open: isOpen,
  onToggle,
  onClose,
  userPresets,
  onSavePreset,
  onApplyPreset,
  onDeletePreset,
}: Props) {
  const [newPresetName, setNewPresetName] = useState('')
  const saveTip = useTooltip(
    newPresetName.trim()
      ? 'Save where you are and how the map looks under this name'
      : 'Name the view first, then save where you are and how the map looks',
    'side'
  )

  function saveCurrentView() {
    const name = newPresetName.trim()
    if (!name) return
    onSavePreset(name)
    setNewPresetName('')
  }

  return (
    <div className="relative">
      <IconButton
        open={isOpen}
        onClick={onToggle}
        icon={<Star />}
        label="Saved views"
        title="Saved views — bookmark this location, zoom and look"
      />

      {/* Anchored right: this sits in the bar's right-hand cluster, so a
          left-anchored panel would run off the window edge. */}
      {isOpen && (
        <Dropdown className="right-0 w-[268px]">
          <div className="flex items-center gap-1.5 p-1.5">
            <input
              value={newPresetName}
              onChange={(e) => setNewPresetName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveCurrentView()
              }}
              placeholder="Name this view…"
              className="min-w-0 flex-1 rounded-md border border-zinc-700 bg-atlas-row px-2.5 py-2 font-mono text-[11px] text-zinc-300 outline-none placeholder:text-zinc-600 focus:border-atlas-accent-line"
            />
            {/* Wrapper carries the hover, since the button is disabled until
                the view has a name — which is what the tip explains. */}
            <span {...saveTip.trigger}>
              <button
                onClick={saveCurrentView}
                disabled={!newPresetName.trim()}
                className="rounded-md bg-atlas-accent px-3 py-2 text-xs font-semibold text-[#0b1512] transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                Save
              </button>
            </span>
            {saveTip.tip}
          </div>
          <Separator />
          {!userPresets || userPresets.length === 0 ? (
            <p className="px-2.5 py-2 text-xs text-zinc-600">
              No saved views yet
            </p>
          ) : (
            userPresets.map((p) => (
              <PresetRow
                key={p.id}
                preset={p}
                onApply={() => {
                  onApplyPreset?.(p)
                  onClose()
                }}
                onDelete={() => onDeletePreset?.(p.id)}
              />
            ))
          )}
        </Dropdown>
      )}
    </div>
  )
}

/**
 * One saved view: apply on the left, delete on the right.
 *
 * Its own component so each row can own its tooltips — hooks cannot be called
 * from inside the map that renders the list.
 */
function PresetRow({
  preset: p,
  onApply,
  onDelete,
}: {
  preset: UserPreset
  onApply: () => void
  onDelete: () => void
}) {
  const applyTip = useTooltip(
    p.camera
      ? `Jump to ${Math.round(p.camera.cx)}, ${Math.round(p.camera.cz)} at ×${p.camera.scale.toFixed(1)}, with this view's settings`
      : `Apply the settings saved as "${p.name}"`,
    'side'
  )
  const deleteTip = useTooltip(`Delete "${p.name}"`, 'side')

  return (
    <div className="flex items-center rounded-md transition-colors hover:bg-atlas-hover">
      <button
        onClick={onApply}
        {...applyTip.trigger}
        className="min-w-0 flex-1 px-2.5 py-2 text-left"
      >
        <span className="block truncate text-[13px] text-zinc-100">
          {p.name}
        </span>
        {p.camera && (
          <span className="mt-0.5 block truncate font-mono text-[10px] text-zinc-600">
            {Math.round(p.camera.cx)}, {Math.round(p.camera.cz)} · ×
            {p.camera.scale.toFixed(1)}
          </span>
        )}
      </button>
      {applyTip.tip}
      <button
        onClick={onDelete}
        aria-label={`Delete ${p.name}`}
        {...deleteTip.trigger}
        className="px-2 text-zinc-600 transition-colors hover:text-atlas-danger"
      >
        <X className="h-3.5 w-3.5" aria-hidden />
      </button>
      {deleteTip.tip}
    </div>
  )
}
