import { open } from '@tauri-apps/plugin-dialog'
import { FolderOpen } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Dropdown, Item, SectionLabel, Separator } from './primitives'
import { type MenuProps } from './types'
import { validateWorld } from '../../features/world/api/worlds'
import {
  addRecentWorld,
  getRecentWorlds,
} from '../../features/world/recentWorlds'

interface Props extends MenuProps {
  worldPath: string | null
  onWorldSelected: (path: string) => void
  onCloseWorld: () => void
  /** Surfaced by the bar itself, so the banner outlives this menu closing. */
  onError: (message: string | null) => void
}

export function FileMenu({
  open: isOpen,
  onToggle,
  onClose,
  worldPath,
  onWorldSelected,
  onCloseWorld,
  onError,
}: Props) {
  const [recentWorlds, setRecentWorlds] = useState<string[]>([])

  useEffect(() => {
    if (isOpen) setRecentWorlds(getRecentWorlds())
  }, [isOpen])

  async function openWorld(path?: string) {
    onClose()
    onError(null)

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
        onError(result.error ?? 'Invalid world folder')
      }
    } catch (e) {
      onError(
        `Backend unavailable: ${e instanceof Error ? e.message : String(e)}`
      )
    }
  }

  return (
    <div className="relative">
      <button
        onClick={onToggle}
        title="Open a world, reopen a recent one, or close this one"
        className={`rounded-md px-2.5 py-1 text-[13px] transition-colors ${
          isOpen
            ? 'bg-atlas-hover text-zinc-100'
            : 'text-zinc-400 hover:bg-atlas-hover hover:text-zinc-100'
        }`}
      >
        File
      </button>

      {isOpen && (
        <Dropdown className="left-0 min-w-[230px]">
          <Item onClick={() => void openWorld()} icon={<FolderOpen />}>
            Open World…
          </Item>

          {recentWorlds.length > 0 && (
            <>
              <SectionLabel>Recent</SectionLabel>
              {recentWorlds.map((p) => {
                const name =
                  p.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? p
                return (
                  <Item
                    key={p}
                    onClick={() => void openWorld(p)}
                    title={p}
                    mono
                  >
                    {name}
                  </Item>
                )
              })}
            </>
          )}

          <Separator />
          <Item
            onClick={() => {
              onClose()
              onCloseWorld()
            }}
            disabled={!worldPath}
          >
            Close World
          </Item>
        </Dropdown>
      )}
    </div>
  )
}
