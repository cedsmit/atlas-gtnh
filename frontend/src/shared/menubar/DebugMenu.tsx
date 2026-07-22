import { open as openExternal } from '@tauri-apps/plugin-shell'
import {
  Bug,
  ExternalLink,
  Mountain,
  Search,
  TriangleAlert,
} from 'lucide-react'

import { Dropdown, IconButton, Item, Separator } from './primitives'
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
      {/* Amber, not accent: the colour is what separates "a diagnostic is on"
          from an ordinary overlay, and it is the one thing here you would want
          to notice you left running. */}
      <IconButton
        open={isOpen}
        on={debugOpen || inspectOpen || diagnosticRender || heightMap}
        tone="amber"
        onClick={onToggle}
        icon={<Bug />}
        label="Debug tools"
      />

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
