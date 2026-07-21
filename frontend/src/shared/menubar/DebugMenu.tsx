import { open as openExternal } from '@tauri-apps/plugin-shell'
import {
  Bug,
  ExternalLink,
  Mountain,
  Search,
  TriangleAlert,
} from 'lucide-react'

import { Dropdown, Item, Separator } from './primitives'
import { type MenuProps } from './types'
import { API_BASE } from '../api'

export interface DebugConfig {
  inspectOpen?: boolean
  onToggleInspect?: () => void
  debugOpen?: boolean
  onToggleDebug?: () => void
  diagnosticRender?: boolean
  onToggleDiagnosticRender?: () => void
  heightMap?: boolean
  onToggleHeightMap?: () => void
}

interface Props extends MenuProps, DebugConfig {
  worldPath: string | null
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
  diagnosticRender,
  onToggleDiagnosticRender,
  heightMap,
  onToggleHeightMap,
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
          isOpen || debugOpen || inspectOpen || diagnosticRender || heightMap
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
          {onToggleDiagnosticRender && (
            <Item
              onClick={onToggleDiagnosticRender}
              icon={<TriangleAlert />}
              check={diagnosticRender}
              tone={diagnosticRender ? 'amber' : undefined}
              title="Flag blocks whose texture never resolved in magenta, and reveal debug-only blocks"
            >
              Diagnostic rendering
            </Item>
          )}
          {onToggleHeightMap && (
            <Item
              onClick={onToggleHeightMap}
              icon={<Mountain />}
              check={heightMap}
              tone={heightMap ? 'amber' : undefined}
              title="False-colour the terrain by height instead of shading it"
            >
              Height map
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
