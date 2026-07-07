import { open } from '@tauri-apps/plugin-dialog'
import { open as openExternal } from '@tauri-apps/plugin-shell'
import {
  Bug,
  Check,
  ChevronDown,
  ExternalLink,
  FolderOpen,
  Mountain,
  Palette,
  Search,
  TriangleAlert,
  X,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { API_BASE } from './api'
import { validateWorld } from '../features/world/api/worlds'
import {
  BUILT_IN_PRESETS,
  type TextureFilter,
} from '../features/blocks/renderPresets'
import { addRecentWorld, getRecentWorlds } from '../features/world/recentWorlds'

type ElevOverride =
  | 'preset'
  | 'off'
  | 'subtle'
  | 'strong'
  | 'relief'
  | 'heightmap'
  | 'contours'

interface Props {
  worldPath: string | null
  onWorldSelected: (path: string) => void
  onCloseWorld: () => void
  selectedPresetId?: string
  onSetPreset?: (id: string) => void
  elevOverride?: ElevOverride
  onSetElevOverride?: (v: ElevOverride) => void
  inspectOpen?: boolean
  onToggleInspect?: () => void
  debugOpen?: boolean
  onToggleDebug?: () => void
  textureFilter?: 'preset' | TextureFilter
  onSetTextureFilter?: (f: 'preset' | TextureFilter) => void
}

export function MenuBar({
  worldPath,
  onWorldSelected,
  onCloseWorld,
  selectedPresetId,
  onSetPreset,
  elevOverride,
  onSetElevOverride,
  inspectOpen,
  onToggleInspect,
  debugOpen,
  onToggleDebug,
  textureFilter,
  onSetTextureFilter,
}: Props) {
  const [fileOpen, setFileOpen] = useState(false)
  const [debugMenuOpen, setDebugMenuOpen] = useState(false)
  const [recentWorlds, setRecentWorlds] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const debugMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (fileOpen) setRecentWorlds(getRecentWorlds())
  }, [fileOpen])

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      const target = e.target as Node
      if (menuRef.current && !menuRef.current.contains(target)) {
        setFileOpen(false)
      }
      if (debugMenuRef.current && !debugMenuRef.current.contains(target)) {
        setDebugMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  async function openWorld(path?: string) {
    setFileOpen(false)
    setError(null)

    let targetPath = path
    if (!targetPath) {
      const picked = await open({ directory: true, multiple: false })
      if (!picked) return
      targetPath = picked
    }

    try {
      const result = await validateWorld(targetPath)
      if (result.valid) {
        addRecentWorld(targetPath)
        onWorldSelected(targetPath)
      } else {
        setError(result.error ?? 'Invalid world folder')
      }
    } catch (e) {
      setError(
        `Backend unavailable: ${e instanceof Error ? e.message : String(e)}`
      )
    }
  }

  return (
    <header className="flex h-9 items-stretch border-b border-zinc-800 bg-zinc-950">
      {/* File menu */}
      <div ref={menuRef} className="relative flex items-stretch">
        <button
          onClick={() => setFileOpen((o) => !o)}
          className={`flex items-center px-4 text-sm transition-colors ${
            fileOpen
              ? 'bg-zinc-800 text-zinc-100'
              : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100'
          }`}
        >
          File
        </button>

        {fileOpen && (
          <div className="absolute left-0 top-full z-50 min-w-52 border border-zinc-700 bg-zinc-900 py-1 shadow-2xl">
            <Item onClick={() => void openWorld()}>
              <span className="inline-flex items-center gap-1.5">
                <FolderOpen className="h-4 w-4 shrink-0" aria-hidden />
                Open World…
              </span>
            </Item>

            {recentWorlds.length > 0 && (
              <>
                <Separator />
                <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-widest text-zinc-500">
                  Recent
                </p>
                {recentWorlds.map((p) => {
                  const name =
                    p.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? p
                  return (
                    <Item key={p} onClick={() => void openWorld(p)} title={p}>
                      {name}
                    </Item>
                  )
                })}
              </>
            )}

            <Separator />
            <Item
              onClick={() => {
                setFileOpen(false)
                onCloseWorld()
              }}
              disabled={!worldPath}
            >
              Close World
            </Item>
          </div>
        )}
      </div>

      {/* Divider */}
      <div className="mx-1 my-2 w-px bg-zinc-800" />

      {/* App title */}
      <div className="flex items-center px-3">
        <span className="text-sm font-semibold tracking-wide text-zinc-300">
          Atlas GTNH
        </span>
      </div>

      {/* World path */}
      {worldPath && (
        <>
          <div className="mx-1 my-2 w-px bg-zinc-800" />
          <div className="flex min-w-0 flex-1 items-center gap-2 px-3">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
            <span className="truncate text-xs text-zinc-500">{worldPath}</span>
          </div>
        </>
      )}

      {/* Right-side toggles */}
      {worldPath && (
        <div className="ml-auto flex items-stretch">
          {onSetPreset && selectedPresetId && (
            <div className="flex items-center gap-1.5 border-l border-zinc-800 pl-2">
              <Palette className="h-4 w-4 shrink-0 text-zinc-500" aria-hidden />
              <select
                value={selectedPresetId}
                onChange={(e) => onSetPreset(e.target.value)}
                title={
                  BUILT_IN_PRESETS.find((p) => p.id === selectedPresetId)
                    ?.description
                }
                className="bg-zinc-900 px-2 font-mono text-xs text-zinc-300 focus:outline-none hover:bg-zinc-800 cursor-pointer"
              >
                {BUILT_IN_PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          {onSetElevOverride && (
            <div className="flex items-center gap-1.5 border-l border-zinc-800 pl-2">
              <Mountain
                className="h-4 w-4 shrink-0 text-zinc-500"
                aria-hidden
              />
              <select
                value={elevOverride ?? 'preset'}
                onChange={(e) =>
                  onSetElevOverride(e.target.value as ElevOverride)
                }
                title="Elevation mode override (overrides preset setting)"
                className={`bg-zinc-900 px-2 font-mono text-xs focus:outline-none hover:bg-zinc-800 cursor-pointer ${
                  elevOverride && elevOverride !== 'preset'
                    ? 'text-amber-300'
                    : 'text-zinc-300'
                }`}
              >
                <option value="preset">Elev: preset</option>
                <option value="off">Elev: off</option>
                <option value="subtle">Elev: subtle</option>
                <option value="strong">Elev: strong</option>
                <option value="relief">Elev: relief</option>
                <option value="heightmap">Elev: heightmap</option>
                <option value="contours">Contours only</option>
              </select>
            </div>
          )}
          {onSetTextureFilter && (
            <div className="flex items-stretch border-l border-zinc-800">
              <select
                value={textureFilter ?? 'preset'}
                onChange={(e) =>
                  onSetTextureFilter(e.target.value as 'preset' | TextureFilter)
                }
                title="Texture filtering mode (overrides preset default)"
                className={`bg-zinc-900 px-2 font-mono text-xs focus:outline-none hover:bg-zinc-800 cursor-pointer ${
                  textureFilter && textureFilter !== 'preset'
                    ? 'text-amber-300'
                    : 'text-zinc-300'
                }`}
              >
                <option value="preset">Filter: preset</option>
                <option value="pixel">Filter: pixel</option>
                <option value="smooth">Filter: smooth</option>
                <option value="journeymap">Filter: JM</option>
              </select>
            </div>
          )}
          {(onToggleDebug || onToggleInspect) && (
            <div
              ref={debugMenuRef}
              className="relative flex items-stretch border-l border-zinc-800"
            >
              <button
                onClick={() => setDebugMenuOpen((o) => !o)}
                className={`flex items-center gap-1.5 px-4 text-sm transition-colors ${
                  debugMenuOpen || debugOpen || inspectOpen
                    ? 'bg-zinc-800 text-zinc-100'
                    : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100'
                }`}
              >
                <Bug className="h-4 w-4 shrink-0" aria-hidden />
                Debug
                <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden />
              </button>

              {debugMenuOpen && (
                <div className="absolute right-0 top-full z-50 min-w-56 border border-zinc-700 bg-zinc-900 py-1 shadow-2xl">
                  {onToggleDebug && (
                    <Item
                      onClick={() => {
                        setDebugMenuOpen(false)
                        onToggleDebug()
                      }}
                    >
                      <span className="flex w-full items-center gap-1.5">
                        <Bug className="h-4 w-4 shrink-0" aria-hidden />
                        Texture Debug Panel
                        {debugOpen && (
                          <Check
                            className="ml-auto h-3.5 w-3.5 shrink-0 text-emerald-400"
                            aria-hidden
                          />
                        )}
                      </span>
                    </Item>
                  )}
                  {onToggleInspect && (
                    <Item
                      onClick={() => {
                        setDebugMenuOpen(false)
                        onToggleInspect()
                      }}
                    >
                      <span className="flex w-full items-center gap-1.5">
                        <Search className="h-4 w-4 shrink-0" aria-hidden />
                        Block Colors
                        {inspectOpen && (
                          <Check
                            className="ml-auto h-3.5 w-3.5 shrink-0 text-emerald-400"
                            aria-hidden
                          />
                        )}
                      </span>
                    </Item>
                  )}
                  <Separator />
                  <Item
                    onClick={() => {
                      setDebugMenuOpen(false)
                      if (worldPath) {
                        void openExternal(
                          `${API_BASE}/worlds/debug-texture-grid?world_path=${encodeURIComponent(worldPath)}`
                        )
                      }
                    }}
                  >
                    <span className="flex w-full items-center gap-1.5">
                      <ExternalLink className="h-4 w-4 shrink-0" aria-hidden />
                      Texture grid (browser)
                    </span>
                  </Item>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 border-l border-zinc-800 bg-red-950/40 px-3">
          <TriangleAlert
            className="h-4 w-4 shrink-0 text-red-400"
            aria-hidden
          />
          <span className="text-xs text-red-400">{error}</span>
          <button
            onClick={() => setError(null)}
            className="text-zinc-600 transition-colors hover:text-zinc-300"
            aria-label="Dismiss"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
      )}
    </header>
  )
}

function Item({
  onClick,
  disabled,
  title,
  children,
}: {
  onClick: () => void
  disabled?: boolean
  title?: string
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`w-full px-3 py-1.5 text-left text-sm transition-colors ${
        disabled
          ? 'cursor-default text-zinc-600'
          : 'text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100'
      }`}
    >
      {children}
    </button>
  )
}

function Separator() {
  return <hr className="my-1 border-zinc-800" />
}
