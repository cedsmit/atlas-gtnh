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
      setError(`Backend unavailable: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  return (
    <header className="flex items-center border-b border-gray-700 bg-gray-900">
      <div ref={menuRef} className="relative">
        <button
          onClick={() => setFileOpen((o) => !o)}
          className={`px-3 py-2 text-sm ${
            fileOpen ? 'bg-gray-700 text-white' : 'text-gray-300 hover:bg-gray-700 hover:text-white'
          }`}
        >
          File
        </button>

        {fileOpen && (
          <div className="absolute left-0 top-full z-50 min-w-48 rounded-b border border-t-0 border-gray-600 bg-gray-800 py-1 shadow-lg">
            <Item onClick={() => void openWorld()}>Open World…</Item>

            {recentWorlds.length > 0 && (
              <>
                <Separator />
                <p className="px-3 py-1 text-xs font-medium text-gray-500">Recent</p>
                {recentWorlds.map((p) => {
                  const name = p.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? p
                  return (
                    <Item key={p} onClick={() => void openWorld(p)} title={p}>
                      {name}
                    </Item>
                  )
                })}
              </>
            )}

            <Separator />
            <Item onClick={() => { setFileOpen(false); onCloseWorld() }} disabled={!worldPath}>
              Close World
            </Item>
          </div>
        )}
      </div>

      <span className="px-3 text-sm font-semibold text-white">Atlas GTNH</span>

      {worldPath && (
        <span className="flex-1 truncate px-1 text-sm text-gray-400">{worldPath}</span>
      )}

      {error && (
        <div className="ml-auto flex items-center gap-2 pr-3">
          <p className="text-xs text-red-400">{error}</p>
          <button
            onClick={() => setError(null)}
            className="text-gray-500 hover:text-white"
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
      className={`w-full px-3 py-1.5 text-left text-sm ${
        disabled ? 'cursor-default text-gray-600' : 'text-gray-200 hover:bg-gray-700'
      }`}
    >
      {children}
    </button>
  )
}

function Separator() {
  return <hr className="my-1 border-gray-700" />
}
