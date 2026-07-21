import { open as openExternal } from '@tauri-apps/plugin-shell'
import { Bug, ExternalLink, Search } from 'lucide-react'

import { Dropdown, Item, Separator } from './primitives'
import { type MenuProps } from './types'
import { API_BASE } from '../api'

interface Props extends MenuProps {
  worldPath: string | null
  inspectOpen?: boolean
  onToggleInspect?: () => void
  debugOpen?: boolean
  onToggleDebug?: () => void
}

export function DebugMenu({
  open: isOpen,
  onToggle,
  onClose,
  worldPath,
  inspectOpen,
  onToggleInspect,
  debugOpen,
  onToggleDebug,
}: Props) {
  const pick = (fn: () => void) => () => {
    onClose()
    fn()
  }

  return (
    <div className="relative">
      <button
        onClick={onToggle}
        aria-label="Debug tools"
        title="Debug tools"
        className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${
          isOpen || debugOpen || inspectOpen
            ? 'bg-atlas-hover text-zinc-100'
            : 'text-zinc-500 hover:bg-atlas-hover hover:text-zinc-100'
        }`}
      >
        <Bug className="h-4 w-4" aria-hidden />
      </button>

      {isOpen && (
        <Dropdown className="right-0 w-[236px]">
          {onToggleDebug && (
            <Item
              onClick={pick(onToggleDebug)}
              icon={<Bug />}
              check={debugOpen}
            >
              Texture Debug Panel
            </Item>
          )}
          {onToggleInspect && (
            <Item
              onClick={pick(onToggleInspect)}
              icon={<Search />}
              check={inspectOpen}
            >
              Block Colors
            </Item>
          )}
          <Separator />
          <Item
            onClick={() => {
              onClose()
              if (worldPath) {
                void openExternal(
                  `${API_BASE}/worlds/debug-texture-grid?world_path=${encodeURIComponent(worldPath)}`
                )
              }
            }}
            icon={<ExternalLink />}
          >
            Texture grid (browser)
          </Item>
        </Dropdown>
      )}
    </div>
  )
}
