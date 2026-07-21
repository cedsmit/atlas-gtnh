import { Star, X } from 'lucide-react'
import { useState } from 'react'

import { Dropdown, MenuButton, Separator } from './primitives'
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

  function saveCurrentView() {
    const name = newPresetName.trim()
    if (!name) return
    onSavePreset(name)
    setNewPresetName('')
  }

  return (
    <div className="relative">
      <MenuButton
        open={isOpen}
        onClick={onToggle}
        icon={<Star />}
        caret
        title="Saved views — bookmark this location, zoom and look"
      >
        Saved
      </MenuButton>

      {isOpen && (
        <Dropdown className="left-0 w-[268px]">
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
            <button
              onClick={saveCurrentView}
              disabled={!newPresetName.trim()}
              className="rounded-md bg-atlas-accent px-3 py-2 text-xs font-semibold text-[#0b1512] transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              Save
            </button>
          </div>
          <Separator />
          {!userPresets || userPresets.length === 0 ? (
            <p className="px-2.5 py-2 text-xs text-zinc-600">
              No saved views yet
            </p>
          ) : (
            userPresets.map((p) => (
              <div
                key={p.id}
                className="flex items-center rounded-md transition-colors hover:bg-atlas-hover"
              >
                <button
                  onClick={() => {
                    onApplyPreset?.(p)
                    onClose()
                  }}
                  title={
                    p.camera
                      ? `Apply "${p.name}" — jumps to ${Math.round(p.camera.cx)}, ${Math.round(p.camera.cz)}`
                      : `Apply "${p.name}"`
                  }
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
                <button
                  onClick={() => onDeletePreset?.(p.id)}
                  aria-label={`Delete ${p.name}`}
                  title="Delete"
                  className="px-2 text-zinc-600 transition-colors hover:text-atlas-danger"
                >
                  <X className="h-3.5 w-3.5" aria-hidden />
                </button>
              </div>
            ))
          )}
        </Dropdown>
      )}
    </div>
  )
}
