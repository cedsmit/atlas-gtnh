import { open } from '@tauri-apps/plugin-dialog'
import { useEffect, useRef, useState } from 'react'

import { validateWorld } from '../api/worlds'
import { addRecentWorld, getRecentWorlds } from '../lib/recentWorlds'

interface Props {
  worldPath: string | null
  onWorldSelected: (path: string) => void
  onCloseWorld: () => void
}

export function MenuBar({ worldPath, onWorldSelected, onCloseWorld }: Props) {
  const [fileOpen, setFileOpen] = useState(false)
  const [recentWorlds, setRecentWorlds] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (fileOpen) setRecentWorlds(getRecentWorlds())
  }, [fileOpen])

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setFileOpen(false)
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
            <Item onClick={() => void openWorld()}>Open World…</Item>

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

      {/* Error */}
      {error && (
        <div className="ml-auto flex items-center gap-2 border-l border-zinc-800 bg-red-950/40 px-3">
          <span className="text-xs text-red-400">{error}</span>
          <button
            onClick={() => setError(null)}
            className="text-zinc-600 transition-colors hover:text-zinc-300"
            aria-label="Dismiss"
          >
            ✕
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
